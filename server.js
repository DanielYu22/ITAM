// Simple Express server to proxy Notion API requests
// Run with: node server.js
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3001;

// CORS - 모든 origin 허용 (개발용)
app.use(cors());
app.use(express.json());

// Notion API 키 (하드코딩 - 개발용)
const NOTION_KEY = 'ntn_J64101163006UO3bpj09kzvX9XeQSQhHuV15OYnEzCK0YP';

// Notion API Proxy - Express 5 문법
app.use('/api/notion', async (req, res) => {
    const path = req.url; // /v1/databases/xxx 형태
    const targetUrl = `https://api.notion.com${path}`;

    console.log(`[Notion] ${req.method} ${targetUrl}`);

    try {
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'Authorization': `Bearer ${NOTION_KEY}`,
                'Notion-Version': '2022-06-28',
                'Content-Type': 'application/json',
            },
            body: ['POST', 'PATCH', 'PUT'].includes(req.method)
                ? JSON.stringify(req.body)
                : undefined,
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('[Notion] Error:', error);
        res.status(500).json({ error: 'Proxy error', message: error.message });
    }
});

// Gemini API Proxy
app.use('/api/gemini', async (req, res) => {
    const path = req.url;
    const apiKey = req.headers['x-goog-api-key'];
    const targetUrl = `https://generativelanguage.googleapis.com${path}`;

    console.log(`[Gemini] ${req.method} ${targetUrl}`);

    try {
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey && { 'x-goog-api-key': apiKey }),
            },
            body: ['POST', 'PATCH', 'PUT'].includes(req.method)
                ? JSON.stringify(req.body)
                : undefined,
        });

        const data = await response.json();
        res.status(response.status).json(data);
    } catch (error) {
        console.error('[Gemini] Error:', error);
        res.status(500).json({ error: 'Proxy error', message: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('🚀 NEXUS-ITAM API Server');
    console.log('========================');
    console.log(`Local:   http://localhost:${PORT}`);
    console.log(`Network: http://<your-ip>:${PORT}`);
    console.log('');
    console.log('모바일 앱에서 이 서버 주소를 API Base URL로 사용하세요.');
    console.log('다른 네트워크에서 접속하려면 ngrok을 사용하세요:');
    console.log(`  npx ngrok http ${PORT}`);
    console.log('');
});
