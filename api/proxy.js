export default async function handler(req, res) {
    const { match } = req.query;
    const apiPath = Array.isArray(match) ? match.join('/') : match;
    const targetUrl = `https://api.notion.com/${apiPath}`;

    const apiKey = process.env.VITE_NOTION_KEY;
    const notionVersion = '2022-06-28';

    if (!apiKey) {
        return res.status(500).json({ error: 'Server Configuration Error: Missing VITE_NOTION_KEY' });
    }

    try {
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Notion-Version': notionVersion,
                'Content-Type': 'application/json',
            },
            body: req.method === 'POST' || req.method === 'PATCH' ? JSON.stringify(req.body) : undefined,
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Notion API Error:', response.status, data);
        }

        res.status(response.status).json(data);
    } catch (error) {
        console.error('Proxy Request Failed:', error);
        res.status(500).json({ error: 'Proxy Request Failed', details: error.message });
    }
}
