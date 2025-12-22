module.exports = async (req, res) => {
    const { path } = req.query;

    // path is string[] or string
    const apiPath = Array.isArray(path) ? path.join('/') : path;

    // Ensure we don't have double slashes
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
        res.status(500).json({ error: 'Proxy Request Failed', details: error.message });
    }
};
