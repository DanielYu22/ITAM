// Configuration for the mobile app
import Constants from 'expo-constants';

// API Base URL - Vercel 배포 URL
export const API_BASE_URL = Constants.expoConfig?.extra?.apiBaseUrl || 'https://itam-vzun.vercel.app';

// Notion 설정 (하드코딩 - 개발용)
export const NOTION_API_KEY = 'ntn_J64101163006UO3bpj09kzvX9XeQSQhHuV15OYnEzCK0YP';
export const NOTION_DATABASE_ID = '2d017e12-9ccc-81bb-8b07-c8b41547bcd9';
export const GEMINI_API_KEY = Constants.expoConfig?.extra?.geminiApiKey || '';
