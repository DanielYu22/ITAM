/**
 * Sites (장소) — 자산을 사이트별로 자동 분류
 *
 * 분류 우선순위:
 *   1. L)건물 컬럼이 buildingExactMatches 중 하나 → 해당 사이트
 *   2. L)건물 컬럼이 buildingContains 중 하나를 포함 → 해당 사이트
 *   3. QA)네트워크 IP 가 ipPrefixes 중 하나로 시작 → 해당 사이트
 *   4. 위 어디에도 안 맞음 → unclassified
 *
 * 건물 단서가 IP보다 우선. 자산이 이동했을 때 IP 정보가 옛 사이트
 * 기준으로 남아있을 수 있으나, 건물은 현재 위치가 정확함.
 *
 * 사이트 정의는 SITES_DEFAULTS 에 기본값이 박혀있고, 사용자가 앱에서
 * 편집한 오버라이드는 Notion 설정 페이지에 저장됩니다. effectiveSites()
 * 가 둘을 합쳐 최종 정의를 만듭니다.
 */

import { Asset } from './notion';
import { FilterConfig, TargetCondition } from '../components/FieldWorkFilter';

export type SiteId = 'all' | 'yongin' | 'magok' | 'hyangnam' | 'unclassified';

export interface SiteDef {
    id: SiteId;
    name: string;
    /** 칩 앞에 붙는 이모지. 안 쓰면 비워두기. */
    emoji?: string;
    color: string;
    bgColor: string;
    /** QA)네트워크 IP 가 이 prefix로 시작하면 사이트 매칭 */
    ipPrefixes: string[];
    /** L)건물 값이 정확히 이 중 하나면 사이트 매칭 */
    buildingExactMatches?: string[];
    /** L)건물 값에 이 키워드가 포함되어 있으면 사이트 매칭 */
    buildingContains?: string[];
    description?: string;
}

/** 사용자가 앱에서 편집하는 부분만 추출한 가벼운 타입 (Notion에 저장) */
export interface SiteOverride {
    ipPrefixes?: string[];
    buildingExactMatches?: string[];
    buildingContains?: string[];
}

export type SitesOverrides = Partial<Record<SiteId, SiteOverride>>;

// ---------------------------------------------------------------------------
// 기본 사이트 정의 (코드에 박힌 default)
// ---------------------------------------------------------------------------

export const SITES_DEFAULTS: SiteDef[] = [
    {
        id: 'all',
        name: '전체',
        emoji: '🌐',
        color: '#475569',
        bgColor: '#f1f5f9',
        ipPrefixes: [],
    },
    {
        id: 'yongin',
        name: '용인',
        color: '#0369a1',
        bgColor: '#e0f2fe',
        ipPrefixes: ['10.5.', '192.168.'],
        buildingExactMatches: ['바이오센터', '경영관', '창조관', '혁신관'],
        description: '실험기기 주력',
    },
    {
        id: 'magok',
        name: '마곡',
        color: '#9333ea',
        bgColor: '#f3e8ff',
        ipPrefixes: ['10.9.'],
        // [2026-06-17] 마곡 건물 명시 — 용인→마곡 이동 자산이 stale 10.5 IP로 용인에 오분류되던 문제.
        buildingExactMatches: ['동측', '서측', '마곡', '(지하)연결공간'],
        description: '마곡 본사',
    },
    {
        id: 'hyangnam',
        name: '향남',
        color: '#16a34a',
        bgColor: '#dcfce7',
        ipPrefixes: ['10.4.'],
        buildingContains: ['향남'],
        description: '향남 공장',
    },
    {
        id: 'unclassified',
        name: '미분류',
        emoji: '❓',
        color: '#64748b',
        bgColor: '#f1f5f9',
        ipPrefixes: [],
    },
];

// 후방 호환 (기존 import 깨지지 않게)
export const SITES = SITES_DEFAULTS;

// ---------------------------------------------------------------------------
// 오버라이드 적용
// ---------------------------------------------------------------------------

/** SITES_DEFAULTS 에 사용자 오버라이드를 합성해 최종 사이트 정의를 반환 */
export const applySitesOverrides = (overrides: SitesOverrides | null | undefined): SiteDef[] => {
    if (!overrides) return SITES_DEFAULTS;
    return SITES_DEFAULTS.map(site => {
        const ov = overrides[site.id];
        if (!ov) return site;
        return {
            ...site,
            ipPrefixes: ov.ipPrefixes ?? site.ipPrefixes,
            buildingExactMatches: ov.buildingExactMatches ?? site.buildingExactMatches,
            buildingContains: ov.buildingContains ?? site.buildingContains,
        };
    });
};

/** 사이트의 사용자 편집 가능한 부분만 SiteOverride로 추출 */
export const siteToOverride = (site: SiteDef): SiteOverride => ({
    ipPrefixes: site.ipPrefixes,
    buildingExactMatches: site.buildingExactMatches,
    buildingContains: site.buildingContains,
});

// ---------------------------------------------------------------------------
// 자산 → 사이트 분류 (effectiveSites 받음)
// ---------------------------------------------------------------------------

export const getAssetSite = (asset: Asset, effective?: SiteDef[]): SiteId => {
    const sites = effective || SITES_DEFAULTS;
    const values = asset.values as any;
    const ip = String(values['QA)네트워크 IP'] ?? '').trim();
    const building = String(values['L)건물'] ?? '').trim();
    const real = sites.filter(s => s.id !== 'all' && s.id !== 'unclassified');

    // [2026-06-17] 1순위: 명시적 '사이트' 컬럼 (사용자가 큐레이션한 권위 데이터).
    //   배경: 자산이 용인→마곡 물리 이동 시 건물은 갱신되나 IP(10.5=용인)가 stale → 오분류.
    //   사용자가 직접 태깅한 '사이트' 값을 최우선으로 신뢰.
    const explicit = String(values['사이트'] ?? '').trim();
    if (explicit) {
        const m = real.find(s => s.name === explicit || s.id === explicit);
        if (m) return m.id;
    }
    // 2순위: 건물 매칭 — 실제 현재 위치. IP보다 우선(이동 시 IP는 신뢰 불가).
    if (building) {
        for (const site of real) {
            if (site.buildingExactMatches?.some(b => building === b)) return site.id;
            if (site.buildingContains?.some(k => building.includes(k))) return site.id;
        }
    }
    // 3순위: IP 프리픽스 — 건물 정보가 없을 때만 보조 추정.
    if (ip) {
        for (const site of real) {
            if (site.ipPrefixes.some(p => ip.startsWith(p))) return site.id;
        }
    }
    return 'unclassified';
};

export const filterAssetsBySite = (
    assets: Asset[],
    siteId: SiteId,
    effective?: SiteDef[],
): Asset[] => {
    if (siteId === 'all') return assets;
    return assets.filter(a => getAssetSite(a, effective) === siteId);
};

// ---------------------------------------------------------------------------
// 사이트 정의 → FilterConfig 프리셋
// ---------------------------------------------------------------------------

export const buildSiteFilterConfig = (
    siteId: SiteId,
    effective?: SiteDef[],
): FilterConfig | null => {
    if (siteId === 'all' || siteId === 'unclassified') return null;
    const sites = effective || SITES_DEFAULTS;
    const site = sites.find(s => s.id === siteId);
    if (!site) return null;

    const stamp = Date.now();
    let idx = 0;
    const mkId = () => `site-${siteId}-${stamp}-${idx++}`;
    const conds: TargetCondition[] = [];

    for (const b of site.buildingExactMatches || []) {
        conds.push({ id: mkId(), column: 'L)건물', type: 'equals', values: [b] });
    }
    for (const k of site.buildingContains || []) {
        conds.push({ id: mkId(), column: 'L)건물', type: 'text_contains', values: [k] });
    }
    for (const ip of site.ipPrefixes) {
        conds.push({ id: mkId(), column: 'QA)네트워크 IP', type: 'text_contains', values: [ip] });
    }

    if (conds.length === 0) return null;

    return {
        locationHierarchy: ['L)건물', 'L)층', 'L)연구실'],
        sortColumn: 'L)연구실',
        sortDirection: 'asc',
        globalLogicalOperator: 'or',
        targetGroups: [
            {
                id: `site-${siteId}-group-${stamp}`,
                operator: 'or',
                conditions: conds,
            },
        ],
        editableFields: [],
    };
};

export const getSiteCounts = (
    assets: Asset[],
    effective?: SiteDef[],
): Record<SiteId, number> => {
    const counts: Record<SiteId, number> = {
        all: assets.length,
        yongin: 0,
        magok: 0,
        hyangnam: 0,
        unclassified: 0,
    };
    for (const a of assets) {
        const site = getAssetSite(a, effective);
        counts[site]++;
    }
    return counts;
};
