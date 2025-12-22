
export type FilterOperator = 'equals' | 'contains' | 'not_equals' | 'is_empty' | 'is_not_empty';

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
        case 'is_empty': return !value || value === '';
        case 'is_not_empty': return !!value && value !== '';
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
        // fallback for contains: typically select doesn't support contains, but we can try equals
        return { property: filter.field, [type]: { equals: val } };
    }

    if (type === 'multi_select') {
    }

    // Default (Rich Text, Title, URL, Email, Phone)
    const textCondition: any = {};
    switch (filter.operator) {
        case 'equals': textCondition.equals = val; break;
        case 'not_equals': textCondition.does_not_equal = val; break;
        case 'contains': textCondition.contains = val; break;
        case 'is_empty': textCondition.is_empty = true; break;
        case 'is_not_empty': textCondition.is_not_empty = true; break;
        default: textCondition.contains = val;
    }

    // Specialized types might need adjustments (e.g. number, date). 
    // For now, assume most searchable fields are text-like or handled as text.
    // If type is 'number', we might need number parsing.

    return {
        property: filter.field,
        [type === 'title' ? 'title' : 'rich_text']: textCondition
    };
};
