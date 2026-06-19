/**
 * kpiTargets — Daniel 의 2대 KPI(백신업데이트 / 분기데이터백업) 타겟 분류 + 다음 액션.
 * (2026-06-17) 거버넌스 권위값을 입력으로, 각 자산을 타겟군으로 분류하고 필요한 조치를 산출.
 *   status: ok(완료) / action(조치필요) / unknown(미확인) / na(대상아님)
 */
import {
  classifyBackup, type BackupClass, NAS_BACKUP_CLASSES,
  SCHED_MODE_TO_CLASS, isLabEquipCode, normalizeOnlineKind, manifestFresh,
} from './assetGovernance';

type V = Record<string, any>;
const g = (v: V, ...keys: string[]): string => {
  for (const k of keys) { const x = v[k]; if (x != null && String(x).trim()) return String(x).trim(); }
  return '';
};

export interface KpiResult {
  targetClass: string;
  targetLabel: string;
  status: 'ok' | 'action' | 'unknown' | 'na';
  action: string;
}

const BK_LABEL: Record<string, string> = {
  realtime: '실시간(1)', client: '백업Client(4)', 'it-field': 'IT현장(2)', 'usb-user': 'USB사용자(3)',
};
const BK_PENDING: Record<BackupClass, string> = {
  realtime: 'STAT 스케줄러·07시 로그 확인', client: 'COPY 스케줄러·07시 로그 확인',
  'it-field': '현장 방문 로보카피(USB) 수행', 'usb-user': '연구원에게 USB 백업 제출 요청',
  none: '—', unknown: '—',
};

/** 분기데이터백업 KPI — 타겟 분류 + 액션 */
export const classifyBackupTarget = (v: V): KpiResult => {
  const method = g(v, 'B)백업방법', 'QA)백업 방법');
  const mode = g(v, 'B)스케줄러모드').toUpperCase();
  const bkStatus = g(v, 'B)분기백업상태', 'M)분기백업 상태').toUpperCase();
  const name = g(v, 'Name');
  let cls = classifyBackup(method);
  if (SCHED_MODE_TO_CLASS[mode]) cls = SCHED_MODE_TO_CLASS[mode]; // 스케줄러모드(실제)로 1↔4 확정

  if (cls === 'none') return { targetClass: 'none', targetLabel: '백업대상아님', status: 'na', action: '—' };
  if (cls === 'unknown') return { targetClass: 'unknown', targetLabel: '백업분류 미정', status: 'action', action: '백업방식 분류 필요(현장확인)' };
  const label = BK_LABEL[cls] || cls;

  if (bkStatus.startsWith('FAIL')) {
    const act = NAS_BACKUP_CLASSES.includes(cls)
      ? 'NAS 백업 실패 — 스케줄러/synologydrive·네트워크 점검 후 재실행'
      : (cls === 'it-field' ? '현장 방문 로보카피 재실행' : 'USB 백업 재수집(연구원 제출)');
    return { targetClass: cls, targetLabel: label, status: 'action', action: `정합성 ${bkStatus} → ${act}` };
  }
  if (bkStatus === 'PASS') return { targetClass: cls, targetLabel: label, status: 'ok', action: '정합성 PASS' };

  let action = BK_PENDING[cls];
  if (cls === 'client' && isLabEquipCode(name) && !SCHED_MODE_TO_CLASS[mode]) {
    action += ' · (실험기기→실시간(1) 가능성 확인)';
  }
  return { targetClass: cls, targetLabel: label, status: 'unknown', action };
};

/** 백신업데이트 KPI(알약 + V3 PoC) — 타겟 분류 + 액션 */
export const classifyVaccineTarget = (v: V): KpiResult => {
  const online = normalizeOnlineKind(g(v, 'M)알약 온라인구분', 'M)온라인구분')); // 구 '폐쇄망'→'단독형'
  const v3 = g(v, 'V3 POC', 'M)V3PoC대상', 'V3 PoC 대상 PC');
  const push = g(v, 'M)ASM Push');
  const field = g(v, 'M)알약 현장조치');
  const isV3 = /대상|poc|^y|^o|예|true/i.test(v3) && !/아님|^n|no|false/i.test(v3);
  const v3suffix = isV3 ? ' · V3 PoC 설치/검증' : '';

  if (!online) return { targetClass: 'unknown', targetLabel: '온라인구분 미정', status: 'action', action: '온라인구분 필수확인(온라인/단독형/알약대상아님)' };
  if (online === '알약대상아님') return { targetClass: 'none', targetLabel: '알약대상아님', status: isV3 ? 'action' : 'na', action: isV3 ? 'V3 PoC 대상 — V3 설치/검증' : '—' };

  if (online === '단독형') {
    const done = /성공|완료|조치완료|배포/.test(field);
    // [2026-06-18] '단독형'(구 폐쇄망)은 권위값 아님(미확정·변동가능). 현장서 온라인 설치 가능하면 온라인 전환.
    //   조치: 보안패치 파일을 사이트에서 받아 USB 지참 → 현장 수동 설치. ('온라인'만 권위값)
    return { targetClass: 'closed', targetLabel: '단독형(미확정·변동가능)', status: done && !isV3 ? 'ok' : 'action', action: (done ? '현장조치 완료' : '보안패치 USB 지참(사이트 다운로드)·현장 수동 설치 / 온라인 설치 가능하면 온라인 전환') + v3suffix };
  }
  // 온라인 — ASM 최근 1달 사용이력 = 네트워크 가용 = '온라인' 타입 권위값
  // [2026-06-18] online 만 권위, 단독형은 변동가능 — 위 분기에서 미확정 처리.
  const pushOk = /성공|완료/.test(push);
  return { targetClass: 'online', targetLabel: '온라인(알약 관리)', status: pushOk && !isV3 ? 'ok' : (pushOk ? 'action' : 'action'), action: (pushOk ? '정책 푸시 성공' : '정책 재푸시 필요') + v3suffix };
};

/**
 * [2026-06-19] 작업스케줄러(07시 manifest) 설치/확인 타겟 분류.
 *   smb://nas1.daewoong.co.kr/<기기명>/Manifest_SynologyDriveRoot.txt 최근 30일 생성 = 설치+가동.
 *   없으면: NAS백업기기 → 설치필요(높음) / 온라인이지만 미분류 → 확인필요 / 단독형·대상아님 → 비대상.
 *   ⚠️ SMB 폴더·파일만 존재 ≠ 설치(수동폴더 가능성) — manifest 만 신뢰.
 */
export const classifySchedulerTarget = (v: V): KpiResult => {
  const online = normalizeOnlineKind(g(v, 'M)알약 온라인구분', 'M)온라인구분'));
  const backup = g(v, 'QA)백업 방법', 'B)백업방법');
  const nasActive = g(v, 'B)NAS가동', 'M)Synology Client 설치');
  const cls = classifyBackup(backup);
  const isNas = NAS_BACKUP_CLASSES.includes(cls);

  if (manifestFresh(nasActive)) return { targetClass: 'sched-ok', targetLabel: '스케줄러 정상', status: 'ok', action: '최근 manifest 확인(설치+가동)' };
  if (isNas) return { targetClass: 'sched-install', targetLabel: '스케줄러 설치/확인', status: 'action', action: 'NAS백업기기인데 최근 manifest 없음 — 07시 작업스케줄러 설치/확인(현장)' };
  if (online === '온라인' && (cls === 'unknown' || cls === 'none')) return { targetClass: 'sched-verify', targetLabel: '스케줄러 확인', status: 'action', action: '온라인 PC — 백업 대상이면 스케줄러 설치 필요. 현장 확인' };
  return { targetClass: 'na', targetLabel: '스케줄러 비대상', status: 'na', action: '—' };
};
