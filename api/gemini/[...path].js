// Gemini API Proxy for Vercel Edge Functions
// This proxies requests to Google's Gemini API

export const config = {
    runtime: 'edge'
};

export default async function handler(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace('/api/gemini/', '');

    const targetUrl = `https://generativelanguage.googleapis.com/${path}`;

    // Get API key from header or environment
    const apiKey = request.headers.get('x-goog-api-key') || process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'API key required' }), {
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

        if (request.method !== 'GET') {
            fetchOptions.body = await request.text();
        }

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
