import { API_BASE_URL } from '../config';

export interface Asset {
    id: string;
    url: string;
    values: Record<string, string>;
    raw: Record<string, any>;
}

export interface NotionConfig {
    apiKey: string;
    databaseId: string;
}

export interface NotionProperty {
    id: string;
    type: string;
    name: string;
    options?: { id: string; name: string; color: string }[];
}

export class NotionClient {
    private apiKey: string;
    private databaseId: string;

    constructor(config: NotionConfig) {
        this.apiKey = config.apiKey;
        this.databaseId = config.databaseId;
    }

    private extractStringValue(prop: any): string {
        if (!prop) return '';
        try {
            switch (prop.type) {
                case 'title':
                    return prop.title?.map((t: any) => t.plain_text).join('') || '';
                case 'rich_text':
                    return prop.rich_text?.map((t: any) => t.plain_text).join('') || '';
                case 'select':
                    return prop.select?.name || '';
                case 'multi_select':
                    return prop.multi_select?.map((s: any) => s.name).join(', ') || '';
                case 'status':
                    return prop.status?.name || '';
                case 'number':
                    return prop.number?.toString() || '';
                case 'date':
                    if (!prop.date) return '';
                    const start = prop.date.start || '';
                    const end = prop.date.end ? ` -> ${prop.date.end}` : '';
                    return start + end;
                case 'checkbox':
                    return prop.checkbox ? 'Yes' : 'No';
                case 'url':
                    return prop.url || '';
                case 'email':
                    return prop.email || '';
                case 'phone_number':
                    return prop.phone_number || '';
                case 'formula':
                    if (prop.formula.type === 'string') return prop.formula.string || '';
                    if (prop.formula.type === 'number') return prop.formula.number?.toString() || '';
                    if (prop.formula.type === 'boolean') return prop.formula.boolean ? 'True' : 'False';
                    if (prop.formula.type === 'date') return prop.formula.date?.start || '';
                    return '';
                case 'relation':
                    return `🔗 ${prop.relation?.length || 0} items`;
                case 'rollup':
                    if (prop.rollup.type === 'number') return prop.rollup.number?.toString() || '';
                    if (prop.rollup.type === 'date') return prop.rollup.date?.start || '';
                    if (prop.rollup.type === 'array') {
                        return prop.rollup.array?.map((item: any) => this.extractStringValue(item)).join(', ') || '';
                    }
                    return '';
                case 'people':
                    return prop.people?.map((p: any) => p.name).join(', ') || '';
                case 'files':
                    return prop.files?.map((f: any) => f.name).join(', ') || '';
                case 'created_time':
                    return prop.created_time || '';
                case 'last_edited_time':
                    return prop.last_edited_time || '';
                default:
                    return JSON.stringify(prop);
            }
        } catch (e) {
            console.warn('Error parsing property:', prop, e);
            return 'Error';
        }
    }

    private getHeaders(): any {
        const headers: any = {
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
        };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }
        return headers;
    }

    async getDatabaseSchema(): Promise<Record<string, NotionProperty>> {
        if (!this.databaseId) return {};

        try {
            const targetUrl = `${API_BASE_URL}/api/notion/v1/databases/${this.databaseId}`;
            const response = await fetch(targetUrl, {
                headers: this.getHeaders()
            });

            if (response.ok) {
                const data = await response.json();
                if (data.properties) {
                    const schema: Record<string, NotionProperty> = {};
                    Object.entries(data.properties).forEach(([key, val]: [string, any]) => {
                        schema[key] = {
                            id: val.id,
                            type: val.type,
                            name: val.name,
                            options: val[val.type]?.options
                        };
                    });
                    return schema;
                }
            }
            return {};
        } catch (error) {
            console.error("Failed to fetch DB schema:", error);
            return {};
        }
    }

    async queryDatabase(filter?: any, sorts?: any[], pageSize = 100, cursor?: string): Promise<{ assets: Asset[], nextCursor?: string | null, hasMore: boolean, schema: string[] }> {
        if (!this.databaseId) return { assets: [], nextCursor: null, hasMore: false, schema: [] };

        try {
            const targetUrl = `${API_BASE_URL}/api/notion/v1/databases/${this.databaseId}/query`;
            const schemaWithTypes = await this.getDatabaseSchema();

            const body: any = { page_size: pageSize };
            if (cursor) body.start_cursor = cursor;
            if (filter) body.filter = filter;
            if (sorts && sorts.length > 0) body.sorts = sorts;

            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(body)
            });

            if (response.ok) {
                const data = await response.json();
                const results = data.results || [];
                const assets: Asset[] = results.map((page: any) => {
                    const values: Record<string, string> = {};
                    Object.entries(page.properties).forEach(([key, prop]: [string, any]) => {
                        values[key] = this.extractStringValue(prop);
                    });

                    return {
                        id: page.id,
                        url: page.url,
                        values: values,
                        raw: page.properties
                    };
                });

                return {
                    assets,
                    nextCursor: data.next_cursor || null,
                    hasMore: data.has_more,
                    schema: Object.keys(schemaWithTypes)
                };
            } else {
                console.error("Notion Query Error:", await response.text());
                return { assets: [], schema: [], nextCursor: null, hasMore: false };
            }
        } catch (error) {
            console.error("Failed to query database:", error);
            return { assets: [], schema: [], nextCursor: null, hasMore: false };
        }
    }

    async fetchAllDatabase(filter?: any, sorts?: any[]): Promise<{ assets: Asset[], schema: string[] }> {
        let allAssets: Asset[] = [];
        let cursor: string | undefined = undefined;
        let hasMore = true;
        let schema: string[] = [];

        while (hasMore) {
            const result = await this.queryDatabase(filter, sorts, 100, cursor);
            if (result.assets.length > 0) {
                allAssets = [...allAssets, ...result.assets];
                if (schema.length === 0) schema = result.schema;
            }

            if (result.hasMore && result.nextCursor) {
                cursor = result.nextCursor;
            } else {
                hasMore = false;
            }
        }

        return { assets: allAssets, schema };
    }

    async updatePage(pageId: string, propertyName: string, value: string, type: string): Promise<void> {
        try {
            const targetUrl = `${API_BASE_URL}/api/notion/v1/pages/${pageId}`;
            const properties: any = {};
            if (type === 'select') {
                properties[propertyName] = { select: { name: value } };
            } else if (type === 'date') {
                properties[propertyName] = { date: { start: value } };
            } else if (type === 'status') {
                properties[propertyName] = { status: { name: value } };
            } else if (type === 'multi_select') {
                const names = value.split(',').map(v => v.trim()).filter(Boolean);
                properties[propertyName] = { multi_select: names.map(n => ({ name: n })) };
            } else if (type === 'title') {
                properties[propertyName] = { title: [{ text: { content: value } }] };
            } else if (type === 'rich_text') {
                properties[propertyName] = { rich_text: [{ text: { content: value } }] };
            } else if (type === 'number') {
                properties[propertyName] = { number: parseFloat(value) || null };
            } else {
                properties[propertyName] = { rich_text: [{ text: { content: value } }] };
            }

            if (Object.keys(properties).length === 0) return;

            const response = await fetch(targetUrl, {
                method: 'PATCH',
                headers: this.getHeaders(),
                body: JSON.stringify({ properties })
            });

            if (!response.ok) {
                console.error(`[Notion] Update failed: ${response.status}`, await response.text());
            }
        } catch (error) {
            console.error("Notion Update Error:", error);
        }
    }

    // 신규 페이지 생성
    async createPage(values: Record<string, string>, schemaProperties: Record<string, NotionProperty>): Promise<string | null> {
        try {
            const targetUrl = `${API_BASE_URL}/api/notion/v1/pages`;
            const properties: any = {};

            for (const [propName, value] of Object.entries(values)) {
                if (!value || value === '신규등록') continue; // 빈 값이나 기본값은 스킵

                const propInfo = schemaProperties[propName];
                const type = propInfo?.type || 'rich_text';

                if (type === 'select') {
                    properties[propName] = { select: { name: value } };
                } else if (type === 'date') {
                    properties[propName] = { date: { start: value } };
                } else if (type === 'status') {
                    properties[propName] = { status: { name: value } };
                } else if (type === 'multi_select') {
                    const names = value.split(',').map(v => v.trim()).filter(Boolean);
                    properties[propName] = { multi_select: names.map(n => ({ name: n })) };
                } else if (type === 'title') {
                    properties[propName] = { title: [{ text: { content: value } }] };
                } else if (type === 'rich_text') {
                    properties[propName] = { rich_text: [{ text: { content: value } }] };
                } else if (type === 'number') {
                    properties[propName] = { number: parseFloat(value) || null };
                } else if (type === 'checkbox') {
                    properties[propName] = { checkbox: value.toLowerCase() === 'yes' || value === 'true' };
                } else if (type === 'url') {
                    properties[propName] = { url: value };
                } else if (type === 'email') {
                    properties[propName] = { email: value };
                } else if (type === 'phone_number') {
                    properties[propName] = { phone_number: value };
                } else {
                    properties[propName] = { rich_text: [{ text: { content: value } }] };
                }
            }

            if (Object.keys(properties).length === 0) {
                console.warn('[Notion] No properties to create');
                return null;
            }

            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    parent: { database_id: this.databaseId },
                    properties
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[Notion] Create page failed: ${response.status}`, errorText);
                throw new Error(`Create failed: ${response.status}`);
            }

            const data = await response.json();
            return data.id;
        } catch (error) {
            console.error("Notion Create Page Error:", error);
            throw error;
        }
    }

    private readonly SETTINGS_MARKER = '🔧_NEXUS_SETTINGS_';

    async loadSettings(): Promise<{ templates?: any[], fieldConfig?: string } | null> {
        try {
            const schemaProps = await this.getDatabaseSchema();
            const titlePropName = Object.keys(schemaProps).find(k => schemaProps[k].type === 'title') || 'Name';
            const targetUrl = `${API_BASE_URL}/api/notion/v1/databases/${this.databaseId}/query`;

            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    filter: {
                        property: titlePropName,
                        title: { contains: this.SETTINGS_MARKER }
                    },
                    page_size: 1
                })
            });

            if (!response.ok) return null;

            const data = await response.json();
            if (!data.results || data.results.length === 0) return null;

            const page = data.results[0];
            const props = page.properties;
            let settingsJson = '';

            for (const [key, prop] of Object.entries(props) as [string, any][]) {
                if (prop.type === 'rich_text') {
                    const text = prop.rich_text?.map((t: any) => t.plain_text).join('') || '';
                    if (text.startsWith('{')) {
                        settingsJson = text;
                        break;
                    }
                }
            }

            if (!settingsJson || !settingsJson.startsWith('{')) return null;
            return JSON.parse(settingsJson);
        } catch (error) {
            console.warn('[Notion Settings] Load error (corrupted data detected). Resetting settings to defaults...', error);
            // Auto-repair: overwrite bad data with empty settings to fix future loads
            this.saveSettings({}).catch(e => console.error('[Notion Settings] Auto-repair failed:', e));
            return null;
        }
    }

    async saveSettings(settings: { templates?: any[], fieldConfig?: string }): Promise<boolean> {
        try {
            const settingsJson = JSON.stringify(settings);
            const schemaProps = await this.getDatabaseSchema();
            const titlePropName = Object.keys(schemaProps).find(k => schemaProps[k].type === 'title') || 'Name';
            const textPropName = Object.keys(schemaProps).find(k => schemaProps[k].type === 'rich_text');

            if (!textPropName) return false;

            const targetUrl = `${API_BASE_URL}/api/notion/v1/databases/${this.databaseId}/query`;
            const searchResponse = await fetch(targetUrl, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    filter: {
                        property: titlePropName,
                        title: { contains: this.SETTINGS_MARKER }
                    },
                    page_size: 1
                })
            });

            const searchData = await searchResponse.json();
            const existingPage = searchData.results?.[0];

            const chunks = [];
            for (let i = 0; i < settingsJson.length; i += 2000) {
                chunks.push({ text: { content: settingsJson.slice(i, i + 2000) } });
            }

            const properties: any = {
                [titlePropName]: { title: [{ text: { content: this.SETTINGS_MARKER + new Date().toISOString().slice(0, 10) } }] },
                [textPropName]: { rich_text: chunks }
            };

            if (existingPage) {
                const updateUrl = `${API_BASE_URL}/api/notion/v1/pages/${existingPage.id}`;
                const updateResponse = await fetch(updateUrl, {
                    method: 'PATCH',
                    headers: this.getHeaders(),
                    body: JSON.stringify({ properties })
                });
                return updateResponse.ok;
            } else {
                const createUrl = `${API_BASE_URL}/api/notion/v1/pages`;
                const createResponse = await fetch(createUrl, {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        parent: { database_id: this.databaseId },
                        properties
                    })
                });
                return createResponse.ok;
            }
        } catch (error) {
            console.error('[Notion Settings] Save error:', error);
            return false;
        }
    }
}
