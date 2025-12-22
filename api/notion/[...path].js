export default async function handler(req, res) {
    // Get the path from the query parameter (handled by Vercel routing)
    const { path } = req.query;

    // Construct the target URL
    // path is an array: ['v1', 'databases', '...']
    const apiPath = Array.isArray(path) ? path.join('/') : path;
    const targetUrl = `https://api.notion.com/${apiPath}`;

    try {
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'Authorization': req.headers.authorization,
                'Notion-Version': req.headers['notion-version'],
                'Content-Type': 'application/json',
            },
            body: req.method === 'POST' || req.method === 'PATCH' ? JSON.stringify(req.body) : undefined,
        });

        const data = await response.json();

        res.status(response.status).json(data);
    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).json({ error: 'Proxy Request Failed' });
    }
}
