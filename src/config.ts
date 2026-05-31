// Configuration for the mobile app
import Constants from 'expo-constants';

// API Base URL - Vercel 배포 URL
export const API_BASE_URL = Constants.expoConfig?.extra?.apiBaseUrl || 'https://itam-vzun.vercel.app';

// Notion 설정 (서버측 환경변수 사용)
export const NOTION_API_KEY: string = ''; // Proxy server handles this
export const NOTION_DATABASE_ID = '2df17e12-9ccc-806b-8345-d3d840db15ca';
// Infrastructure / Companies — Phase B 신규 노션 DB
export const NOTION_INFRA_DB_ID = '37117e12-9ccc-81f0-b003-ede0778180c4';
export const NOTION_COMPANIES_DB_ID = '37117e12-9ccc-81cd-a452-e1dc0ca9ac1e';
export const GEMINI_API_KEY: string = ''; // Proxy server handles this
