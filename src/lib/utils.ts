// Notion-style filter operators
export type FilterOperator =
    // Text/Select: is, is not
    | 'equals'
    | 'does_not_equal'
    // Text/Multi-select: contains, does not contain  
    | 'contains'
    | 'does_not_contain'
    // Text: starts with, ends with
    | 'starts_with'
    | 'ends_with'
    // Number comparisons
    | 'number_equals'
    | 'number_does_not_equal'
    | 'greater_than'
    | 'less_than'
    | 'greater_than_or_equal_to'
    | 'less_than_or_equal_to'
    // Empty checks
    | 'is_empty'
    | 'is_not_empty'
    // Legacy (for backwards compatibility)
    | 'not_equals'
    | 'is_in'
    | 'is_not_in';

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
    sorts?: SortRule[];
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

    const value = String(asset.values[filter.field] ?? '').toLowerCase();
    const target = String(filter.value ?? '').toLowerCase();

    switch (filter.operator) {
        case 'equals': return value === target;
        case 'not_equals': return value !== target;
        case 'contains': return value.includes(target);
        case 'does_not_contain': return !value.includes(target);
        case 'starts_with': return value.startsWith(target);
        case 'ends_with': return value.endsWith(target);
        case 'is_empty': return !value || value === '';
        case 'is_not_empty': return !!value && value !== '';
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
    const result = toNotionFilterInternal(filter, schemaTypes);
    console.log('[toNotionFilter] Input:', JSON.stringify(filter, null, 2));
    console.log('[toNotionFilter] Output:', JSON.stringify(result, null, 2));
    return result;
};

const toNotionFilterInternal = (filter: FilterCondition, schemaTypes: Record<string, string>): any => {
    if (filter.logic) {
        if (!filter.conditions || filter.conditions.length === 0) return undefined;
        const validConditions = filter.conditions
            .map(c => toNotionFilterInternal(c, schemaTypes))
            .filter(Boolean);

        if (validConditions.length === 0) return undefined;
        return { [filter.logic.toLowerCase()]: validConditions };
    }

    if (!filter.field || !filter.operator) return undefined;
    if (!filter.value && filter.operator !== 'is_empty' && filter.operator !== 'is_not_empty') return undefined;

    const type = schemaTypes[filter.field] || 'rich_text';
    const val = filter.value;

    // Select / Status
    if (type === 'select' || type === 'status') {
        if (filter.operator === 'equals') return { property: filter.field, [type]: { equals: val } };
        if (filter.operator === 'does_not_equal') return { property: filter.field, [type]: { does_not_equal: val } };
        if (filter.operator === 'not_equals') return { property: filter.field, [type]: { does_not_equal: val } };
        if (filter.operator === 'is_empty') return { property: filter.field, [type]: { is_empty: true } };
        if (filter.operator === 'is_not_empty') return { property: filter.field, [type]: { is_not_empty: true } };

        if (filter.operator === 'contains' && val) {
            const values = val.split('|').filter(Boolean);
            if (values.length === 0) return undefined;
            if (values.length === 1) {
                return { property: filter.field, [type]: { equals: values[0] } };
            }
            return { or: values.map(v => ({ property: filter.field, [type]: { equals: v } })) };
        }

        if (filter.operator === 'does_not_contain' && val) {
            const values = val.split('|').filter(Boolean);
            if (values.length === 0) return undefined;
            const notEqualConditions = values.map(v => ({ property: filter.field, [type]: { does_not_equal: v } }));
            const emptyCondition = { property: filter.field, [type]: { is_empty: true } };
            return { or: [{ and: notEqualConditions }, emptyCondition] };
        }

        if (filter.operator === 'is_in' && val) {
            const values = val.split('|').filter(Boolean);
            if (values.length === 0) return undefined;
            return { or: values.map(v => ({ property: filter.field, [type]: { equals: v } })) };
        }
        if (filter.operator === 'is_not_in' && val) {
            const values = val.split('|').filter(Boolean);
            if (values.length === 0) return undefined;
            return { and: values.map(v => ({ property: filter.field, [type]: { does_not_equal: v } })) };
        }
        return { property: filter.field, [type]: { equals: val } };
    }

    if (type === 'multi_select') {
        if (filter.operator === 'contains' && val) {
            const values = val.split('|').filter(Boolean);
            if (values.length === 0) return undefined;
            if (values.length === 1) {
                return { property: filter.field, [type]: { contains: values[0] } };
            }
            return { or: values.map(v => ({ property: filter.field, [type]: { contains: v } })) };
        }

        if (filter.operator === 'does_not_contain' && val) {
            const values = val.split('|').filter(Boolean);
            if (values.length === 0) return undefined;
            const notContainConditions = values.map(v => ({ property: filter.field, [type]: { does_not_contain: v } }));
            const emptyCondition = { property: filter.field, [type]: { is_empty: true } };
            return { or: [{ and: notContainConditions }, emptyCondition] };
        }

        if (filter.operator === 'is_empty') return { property: filter.field, [type]: { is_empty: true } };
        if (filter.operator === 'is_not_empty') return { property: filter.field, [type]: { is_not_empty: true } };

        if (filter.operator === 'is_in' && val) {
            const values = val.split('|').filter(Boolean);
            if (values.length === 0) return undefined;
            return { or: values.map(v => ({ property: filter.field, [type]: { contains: v } })) };
        }
        if (filter.operator === 'is_not_in' && val) {
            const values = val.split('|').filter(Boolean);
            if (values.length === 0) return undefined;
            return { and: values.map(v => ({ property: filter.field, [type]: { does_not_contain: v } })) };
        }
    }

    // Number type
    if (type === 'number') {
        const numVal = parseFloat(val || '0');
        switch (filter.operator) {
            case 'number_equals': return { property: filter.field, number: { equals: numVal } };
            case 'number_does_not_equal': return { property: filter.field, number: { does_not_equal: numVal } };
            case 'greater_than': return { property: filter.field, number: { greater_than: numVal } };
            case 'less_than': return { property: filter.field, number: { less_than: numVal } };
            case 'greater_than_or_equal_to': return { property: filter.field, number: { greater_than_or_equal_to: numVal } };
            case 'less_than_or_equal_to': return { property: filter.field, number: { less_than_or_equal_to: numVal } };
            case 'is_empty': return { property: filter.field, number: { is_empty: true } };
            case 'is_not_empty': return { property: filter.field, number: { is_not_empty: true } };
            default: return { property: filter.field, number: { equals: numVal } };
        }
    }

    // Default (Rich Text, Title, URL, Email, Phone)
    const textCondition: any = {};
    switch (filter.operator) {
        case 'equals': textCondition.equals = val; break;
        case 'does_not_equal': textCondition.does_not_equal = val; break;
        case 'not_equals': textCondition.does_not_equal = val; break;
        case 'contains': textCondition.contains = val; break;
        case 'does_not_contain': textCondition.does_not_contain = val; break;
        case 'starts_with': textCondition.starts_with = val; break;
        case 'ends_with': textCondition.ends_with = val; break;
        case 'is_empty': textCondition.is_empty = true; break;
        case 'is_not_empty': textCondition.is_not_empty = true; break;
        default: textCondition.contains = val;
    }

    return { property: filter.field, [type === 'title' ? 'title' : 'rich_text']: textCondition };
};

export const toNotionSorts = (sorts: SortRule[]): any[] => {
    return sorts.map(s => ({
        property: s.property,
        direction: s.direction
    }));
};
