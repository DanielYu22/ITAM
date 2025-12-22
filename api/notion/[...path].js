module.exports = async (req, res) => {
    const { path } = req.query;
    const apiPath = Array.isArray(path) ? path.join('/') : path;
    const targetUrl = `https://api.notion.com/${apiPath}`;

    // Use server-side environment variable for security and reliability
    const apiKey = process.env.VITE_NOTION_KEY;
    const notionVersion = '2022-06-28'; // Ensure version matches or use env

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

        // Log error for debugging (Vercel logs)
        if (!response.ok) {
            console.error('Notion API Error:', response.status, data);
        }

        res.status(response.status).json(data);
    } catch (error) {
        console.error('Proxy Request Failed:', error);
        res.status(500).json({ error: 'Proxy Request Failed', details: error.message });
    }
};
