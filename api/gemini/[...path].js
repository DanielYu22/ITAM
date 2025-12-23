// Gemini API Proxy for Vercel Edge Functions
// This proxies requests to Google's Gemini API

export const config = {
    runtime: 'edge'
};

export default async function handler(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, x-goog-api-key'
            }
        });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace('/api/gemini/', '');

    const targetUrl = `https://generativelanguage.googleapis.com/${path}`;

    // Get API key from header or environment (check both VITE_ and non-VITE versions)
    const apiKey = request.headers.get('x-goog-api-key') ||
        process.env.VITE_GEMINI_API_KEY ||
        process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'API key required. Please set VITE_GEMINI_API_KEY in Vercel.' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const headers = {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        };

        const fetchOptions = {
            method: request.method,
            headers
        };

        if (request.method === 'POST') {
            fetchOptions.body = await request.text();
        }

        console.log('[Gemini Proxy] Forwarding to:', targetUrl);
        const response = await fetch(targetUrl, fetchOptions);
        const data = await response.text();

        return new Response(data, {
            status: response.status,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            }
        });
    } catch (error) {
        console.error('[Gemini Proxy] Error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
