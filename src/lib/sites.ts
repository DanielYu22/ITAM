/**
 * Sites (장소) — 자산을 사이트별로 자동 분류
 *
 * 분류 우선순위:
 *   1. L)건물 컬럼이 buildingExactMatches 중 하나 → 해당 사이트
 *   2. L)건물 컬럼이 buildingContains 중 하나를 포함 → 해당 사이트
 *   3. QA)네트워크 IP 가 ipPrefixes 중 하나로 시작 → 해당 사이트
 *   4. 위 어디에도 안 맞음 → unclassified
 *
 * 건물 단서를 IP보다 우선시함. 자산이 이동했을 때 IP 정보가 옛 사이트
 * 기준으로 남아 있을 수 있으나, 건물은 현재 위치가 정확함.
 *
 * 사용자 정의:
 *   - 용인 건물: 바이오센터, 경영관, 창조관, 혁신관
 *   - 향남: 건물명에 "향남" 포함되거나 시작
 *   - 마곡: 일단 IP만. 추후 실험실/건물명 알려주시면 추가
 */

import { Asset } from './notion';

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

// ---------------------------------------------------------------------------
// 사이트 정의 — 여기만 손보면 됨
// ---------------------------------------------------------------------------

export const SITES: SiteDef[] = [
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
        // 이모지 없음
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
        // 마곡 건물/실험실명은 차후 추가
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

// ---------------------------------------------------------------------------
// 자산 → 사이트 분류
// ---------------------------------------------------------------------------

/**
 * 자산이 어느 사이트에 속하는지 판단.
 * 건물 단서가 IP보다 우선.
 */
export const getAssetSite = (asset: Asset): SiteId => {
    const values = asset.values as any;
    const ip = String(values['QA)네트워크 IP'] ?? '').trim();
    const building = String(values['L)건물'] ?? '').trim();

    for (const site of SITES) {
        if (site.id === 'all' || site.id === 'unclassified') continue;

        // 1순위: 건물 정확 일치
        if (building && site.buildingExactMatches?.some(b => building === b)) {
            return site.id;
        }
        // 2순위: 건물 키워드 포함
        if (building && site.buildingContains?.some(k => building.includes(k))) {
            return site.id;
        }
        // 3순위: IP prefix
        if (ip && site.ipPrefixes.some(p => ip.startsWith(p))) {
            return site.id;
        }
    }
    return 'unclassified';
};

/** 자산 배열을 사이트로 필터링. 'all'이면 그대로 반환. */
export const filterAssetsBySite = (assets: Asset[], siteId: SiteId): Asset[] => {
    if (siteId === 'all') return assets;
    return assets.filter(a => getAssetSite(a) === siteId);
};

/** 각 사이트별 자산 수 계산 */
export const getSiteCounts = (assets: Asset[]): Record<SiteId, number> => {
    const counts: Record<SiteId, number> = {
        all: assets.length,
        yongin: 0,
        magok: 0,
        hyangnam: 0,
        unclassified: 0,
    };
    for (const a of assets) {
        const site = getAssetSite(a);
        counts[site]++;
    }
    return counts;
};
