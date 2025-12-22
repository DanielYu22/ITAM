export type FilterOperator = 'equals' | 'contains' | 'does_not_contain' | 'not_equals' | 'is_empty' | 'is_not_empty' | 'is_in' | 'is_not_in' | 'starts_with' | 'ends_with';

export type SortDirection = 'ascending' | 'descending';

export interface SortRule {
    id: string;
    property: string;
    direction: SortDirection;
}

export interface FilterCondition {
    id: string;
    field?: string;
    operator?: FilterOperator;
    value?: string;
    logic?: 'AND' | 'OR';
    conditions?: FilterCondition[];
}

export interface FilterTemplate {
    id: string;
    name: string;
    filter: FilterCondition;
    sorts?: SortRule[]; // Add sort support
    visibleColumns?: string[];
}

import { Asset } from './notion';

export const evaluateFilter = (asset: Asset, filter: FilterCondition): boolean => {
    if (!filter) return true;
    if (filter.logic) {
        if (!filter.conditions || filter.conditions.length === 0) return true;
        if (filter.logic === 'AND') {
            return filter.conditions.every(c => evaluateFilter(asset, c));
        } else {
            return filter.conditions.some(c => evaluateFilter(asset, c));
        }
    }

    if (!filter.field || !filter.operator) return true;

    const value = String(asset.values[filter.field] || '').toLowerCase();
    const target = String(filter.value || '').toLowerCase();

    switch (filter.operator) {
        case 'equals': return value === target;
        case 'not_equals': return value !== target;
        case 'contains': return value.includes(target);
        case 'does_not_contain': return !value.includes(target);
        case 'starts_with': return value.startsWith(target);
        case 'ends_with': return value.endsWith(target);
        case 'is_empty': return !value || value === '';
        case 'is_not_empty': return !!value && value !== '';
        // Is In / Is Not In (for simple text check, usually not used but supported)
        case 'is_in':
            return (target.split('|').filter(Boolean) || []).some(t => value === t);
        case 'is_not_in':
            return !(target.split('|').filter(Boolean) || []).some(t => value === t);
        default: return true;
    }
};

export const DEFAULT_FILTER: FilterCondition = {
    id: 'root',
    logic: 'AND',
    conditions: []
};


export const toNotionFilter = (filter: FilterCondition, schemaTypes: Record<string, string>): any => {
    if (filter.logic) {
        if (!filter.conditions || filter.conditions.length === 0) return undefined;
        const validConditions = filter.conditions
            .map(c => toNotionFilter(c, schemaTypes))
            .filter(Boolean);

        if (validConditions.length === 0) return undefined;
        return { [filter.logic.toLowerCase()]: validConditions };
    }

    if (!filter.field || !filter.operator) return undefined;
    // Value is required unless it's an existence check
    if (!filter.value && filter.operator !== 'is_empty' && filter.operator !== 'is_not_empty') return undefined;

    const type = schemaTypes[filter.field] || 'rich_text';
    const val = filter.value;

    // Select / Status / Multi-select
    if (type === 'select' || type === 'status') {
        if (filter.operator === 'equals') return { property: filter.field, [type]: { equals: val } };
        if (filter.operator === 'not_equals') return { property: filter.field, [type]: { does_not_equal: val } };
        if (filter.operator === 'is_empty') return { property: filter.field, [type]: { is_empty: true } };
        if (filter.operator === 'is_not_empty') return { property: filter.field, [type]: { is_not_empty: true } };

        // "Is One Of" for single select -> OR with equals
        if (filter.operator === 'is_in' && val) {
            const values = val.split('|').filter(Boolean);
            if (values.length === 0) return undefined;
            return { or: values.map(v => ({ property: filter.field, [type]: { equals: v } })) };
        }
        if (filter.operator === 'is_not_in' && val) {
            const values = val.split('|').filter(Boolean);
            if (values.length === 0) return undefined;
            // AND with does_not_equal
            return { and: values.map(v => ({ property: filter.field, [type]: { does_not_equal: v } })) };
        }
        // fallback for contains: typically select doesn't support contains, but we can try equals
        return { property: filter.field, [type]: { equals: val } };
    }

    if (type === 'multi_select') {
        if (filter.operator === 'contains') return { property: filter.field, [type]: { contains: val } };
        if (filter.operator === 'does_not_contain') return { property: filter.field, [type]: { does_not_contain: val } };
        if (filter.operator === 'is_empty') return { property: filter.field, [type]: { is_empty: true } };
        if (filter.operator === 'is_not_empty') return { property: filter.field, [type]: { is_not_empty: true } };
        if (filter.operator === 'is_in' && val) {
            const values = val.split('|').filter(Boolean);
            if (values.length === 0) return undefined;
            // OR with contains for "Multi-Select Is One Of"
            return { or: values.map(v => ({ property: filter.field, [type]: { contains: v } })) };
        }
        if (filter.operator === 'is_not_in' && val) {
            const values = val.split('|').filter(Boolean);
            if (values.length === 0) return undefined;
            // AND with does_not_contain for "Multi-Select Is Not One Of"
            return { and: values.map(v => ({ property: filter.field, [type]: { does_not_contain: v } })) };
        }
    }

    // Default (Rich Text, Title, URL, Email, Phone)
    const textCondition: any = {};
    switch (filter.operator) {
        case 'equals': textCondition.equals = val; break;
        case 'not_equals': textCondition.does_not_equal = val; break;
        case 'contains': textCondition.contains = val; break;
        case 'does_not_contain': textCondition.does_not_contain = val; break;
        case 'starts_with': textCondition.starts_with = val; break;
        case 'ends_with': textCondition.ends_with = val; break;
        case 'is_empty': textCondition.is_empty = true; break;
        case 'is_not_empty': textCondition.is_not_empty = true; break;
        default: textCondition.contains = val;
    }

    // Specialized types might need adjustments (e.g. number, date).
    // For now, assume most searchable fields are text-like or handled as text.
    // If type is 'number', we might need number parsing.

    // Check if type actually supports these? Rich Text supports all.
    return { property: filter.field, [type === 'title' ? 'title' : 'rich_text']: textCondition };
};

export const toNotionSorts = (sorts: SortRule[]): any[] => {
    return sorts.map(s => ({
        property: s.property,
        direction: s.direction
    }));
};
