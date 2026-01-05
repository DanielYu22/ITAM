// Configuration for the mobile app
import Constants from 'expo-constants';

// API Base URL - 로컬 백엔드 서버 (server.js)
// 같은 컴퓨터에서 테스트: http://localhost:3001
// 같은 네트워크에서 iPad 테스트: http://<PC IP>:3001
// 다른 네트워크에서 테스트: ngrok URL 사용
export const API_BASE_URL = Constants.expoConfig?.extra?.apiBaseUrl || 'http://localhost:3001';

// Notion 설정 (하드코딩 - 개발용)
export const NOTION_API_KEY = 'ntn_J64101163006UO3bpj09kzvX9XeQSQhHuV15OYnEzCK0YP';
export const NOTION_DATABASE_ID = '2d017e12-9ccc-81bb-8b07-c8b41547bcd9';
export const GEMINI_API_KEY = Constants.expoConfig?.extra?.geminiApiKey || '';
