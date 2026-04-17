import Constants from 'expo-constants';
import { BUILD_GIT_SHA, BUILD_TIME_ISO } from './buildInfo';

// 표시용 버전 문자열
// - 앱에서 "새로고침만으로 최신 여부 확인"을 쉽게 하기 위해 Git 커밋(short sha)을 함께 노출합니다.
const baseVersion = Constants.expoConfig?.version || 'dev';

export const APP_VERSION = `v${baseVersion} (${BUILD_GIT_SHA})`;
export const BUILD_DATE = BUILD_TIME_ISO.slice(0, 10);
