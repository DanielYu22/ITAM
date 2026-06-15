// Configuration for the mobile app
import Constants from 'expo-constants';

// API Base URL - Vercel 배포 URL
export const API_BASE_URL = Constants.expoConfig?.extra?.apiBaseUrl || 'https://itam-vzun.vercel.app';

// Notion 설정 (서버측 환경변수 사용)
export const NOTION_API_KEY: string = ''; // Proxy server handles this
export const NOTION_DATABASE_ID = '380ee0d6-d000-81e7-9fad-ca0b2fa95dda';
// Infrastructure / Companies — Phase B 신규 노션 DB
export const NOTION_INFRA_DB_ID = '380ee0d6-d000-8129-bb18-c75919ea2ac2';
export const NOTION_COMPANIES_DB_ID = '380ee0d6-d000-810b-b962-f42242c885a0';
export const NOTION_INFRA_ASSETS_DB_ID = '380ee0d6-d000-8150-993e-e7db49f91771';
export const NOTION_CHANGELOG_DB_ID = '380ee0d6-d000-81e1-824d-ee792f6cefed';
export const GEMINI_API_KEY: string = ''; // Proxy server handles this
