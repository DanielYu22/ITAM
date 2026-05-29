/**
 * Sites (장소) — 자산을 사이트별로 자동 분류
 *
 * IP 대역 기반 자동 분류. 사용자 정의에 따라 prefix만 수정하면 됨.
 *
 * 메인 화면 상단 토글에서 사이트를 선택하면, 전 앱(통계/Quick Task/
 * 대시보드/임포트)이 그 사이트 컨텍스트로 좁혀짐.
 *
 * 마곡/향남 IP 대역은 사용자가 알려주시면 한 줄 추가하면 끝.
 */

import { Asset } from './notion';

export type SiteId = 'all' | 'yongin' | 'magok' | 'hyangnam' | 'unclassified';

export interface SiteDef {
    id: SiteId;
    name: string;
    emoji: string;
    color: string;
    bgColor: string;
    // 이 사이트로 분류하는 IP prefix 목록 (startsWith)
    ipPrefixes: string[];
    // 사이트 description
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
        ipPrefixes: [], // 전체는 prefix 무시
    },
    {
        id: 'yongin',
        name: '용인',
        emoji: '🏭',
        color: '#0369a1',
        bgColor: '#e0f2fe',
        ipPrefixes: ['10.5.', '192.168.'],
        description: '실험기기 주력 대역',
    },
    {
        id: 'magok',
        name: '마곡',
        emoji: '🏢',
        color: '#9333ea',
        bgColor: '#f3e8ff',
        ipPrefixes: [
            // TODO: 마곡 IP 대역. 사용자 확정되면 추가.
        ],
    },
    {
        id: 'hyangnam',
        name: '향남',
        emoji: '🌳',
        color: '#16a34a',
        bgColor: '#dcfce7',
        ipPrefixes: [
            // TODO: 향남 IP 대역. 사용자 확정되면 추가.
        ],
    },
    {
        id: 'unclassified',
        name: '미분류',
        emoji: '❓',
        color: '#64748b',
        bgColor: '#f1f5f9',
        ipPrefixes: [], // 위 사이트 어디에도 안 맞는 자산들
    },
];

// ---------------------------------------------------------------------------
// 자산 → 사이트 분류
// ---------------------------------------------------------------------------

/** 자산의 IP를 읽어 어떤 사이트인지 판단 */
export const getAssetSite = (asset: Asset): SiteId => {
    const ip = String((asset.values as any)['QA)네트워크 IP'] ?? '').trim();
    if (!ip) return 'unclassified';
    for (const site of SITES) {
        if (site.id === 'all' || site.id === 'unclassified') continue;
        if (site.ipPrefixes.some(p => ip.startsWith(p))) {
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

/** 각 사이트별 자산 수 계산 (전체, 용인, 마곡, 향남, 미분류) */
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
