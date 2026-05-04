/**
 * Notion DB에 같이 들어가 있지만 앱 사용자에게는 보이면 안 되는 행(설정 페이지, 템플릿 행 등).
 * loadSettings/saveSettings 는 별도 쿼리로 동작하므로 여기서 제외해도 설정 기능은 유지된다.
 */
export const NEXUS_SETTINGS_TITLE_MARKER = '🔧_NEXUS_SETTINGS_';

const GHOST_NAME_EXACT = 'Instructions';

export function isGhostAssetTitle(titleValue: string): boolean {
    const t = String(titleValue ?? '').trim();
    if (!t) return false;
    if (t === GHOST_NAME_EXACT) return true;
    if (t.includes(NEXUS_SETTINGS_TITLE_MARKER)) return true;
    return false;
}

export function filterUserFacingAssets<T extends { values: Record<string, string> }>(
    rows: T[],
    titlePropName: string
): T[] {
    return rows.filter(r => !isGhostAssetTitle(String(r.values[titlePropName] ?? '')));
}
