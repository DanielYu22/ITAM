
export interface Asset {
    id: string;
    url: string;
    values: Record<string, string>; // Display values
    raw: Record<string, any>; // Raw values for updates
}

export interface NotionConfig {
    apiKey: string;
    databaseId: string;
}

export interface NotionProperty {
    id: string;
    type: string;
    name: string;
    options?: { id: string; name: string; color: string }[]; // For select, multi_select, status
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



    async getDatabaseSchema(): Promise<Record<string, NotionProperty>> {
        if (!this.apiKey || !this.databaseId) return {};

        try {
            const targetUrl = `/api/notion/v1/databases/${this.databaseId}`;
            const response = await fetch(targetUrl, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Notion-Version': '2022-06-28'
                }
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
        if (!this.apiKey || !this.databaseId) return { assets: [], nextCursor: null, hasMore: false, schema: [] };

        try {
            const targetUrl = `/api/notion/v1/databases/${this.databaseId}/query`;
            console.log(`Fetching from Local Proxy: ${targetUrl}`);

            // 1. Fetch Schema First (to ensure we have all columns)
            // We ignore types here for the basic schema list, but we could cache them
            const schemaWithTypes = await this.getDatabaseSchema();


            // 2. Fetch One Page
            const body: any = { page_size: pageSize };
            if (cursor) body.start_cursor = cursor;
            if (filter) body.filter = filter;
            if (sorts && sorts.length > 0) body.sorts = sorts;

            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Notion-Version': '2022-06-28',
                    'Content-Type': 'application/json'
                },
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
                    schema: Object.keys(schemaWithTypes) // Return schema
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
            const targetUrl = `/api/notion/v1/pages/${pageId}`;

            const properties: any = {};
            if (type === 'select') {
                properties[propertyName] = { select: { name: value } };
            } else if (type === 'date') {
                properties[propertyName] = { date: { start: value } };
            } else if (type === 'status') {
                properties[propertyName] = { status: { name: value } };
            } else if (type === 'multi_select') {
                // Split by comma and create array of select objects
                const names = value.split(',').map(v => v.trim()).filter(Boolean);
                properties[propertyName] = { multi_select: names.map(n => ({ name: n })) };
            } else if (type === 'title') {
                properties[propertyName] = { title: [{ text: { content: value } }] };
            } else if (type === 'rich_text') {
                properties[propertyName] = { rich_text: [{ text: { content: value } }] };
            } else if (type === 'number') {
                properties[propertyName] = { number: parseFloat(value) || null };
            }

            await fetch(targetUrl, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Notion-Version': '2022-06-28',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ properties })
            });
        } catch (error) {
            console.error("Notion Update Error:", error);
        }
    }
}
