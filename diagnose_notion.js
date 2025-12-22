import https from 'https';

const API_KEY = 'ntn_J64101163006UO3bpj09kzvX9XeQSQhHuV15OYnEzCK0YP';
// User confirmed this is the correct ID:
const DB_ID = '2d017e12-9ccc-81bb-8b07-c8b41547bcd9';
// Using OLD version to inspect metadata (since new version failed with invalid URL)
const NOTION_VERSION = '2022-06-28';

function request(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.notion.com',
            port: 443,
            path: '/v1' + path,
            method: method,
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Notion-Version': NOTION_VERSION,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode,
                        data: JSON.parse(data)
                    });
                } catch (e) {
                    resolve({
                        status: res.statusCode,
                        data: { raw: data }
                    });
                }
            });
        });

        req.on('error', (e) => reject(e));
        if (body) req.write(JSON.stringify(body));
        req.end();
    });
}

async function diagnose() {
    console.log(`=== 🔍 Diagnosing Target ID: ${DB_ID} ===\n`);

    // 1. GET Metadata (to see if it's a DB, Page, or View)
    console.log(`1️⃣  Fetching GET /v1/databases/${DB_ID}`);
    try {
        const res = await request(`/databases/${DB_ID}`);
        console.log(`   Status: ${res.status}`);
        if (res.status === 200) {
            console.log("   ✅ SUCCESS: It IS a Database object.");
            console.log("   Title:", res.data.title?.[0]?.plain_text || "Untitled");
            console.log("   --- Properties (First 3) ---");
            const props = Object.keys(res.data.properties || {}).slice(0, 3);
            console.log("   " + props.join(", "));

            // Check descriptions or sources?
            // console.log("   Full Data:", JSON.stringify(res.data, null, 2));
        } else {
            console.log("   ❌ FAILED.");
            console.log("   Message:", res.data.message);
        }
    } catch (e) {
        console.error("   Error:", e);
    }

    console.log("\n------------------------------------------------\n");

    // 2. QUERY (to see if we can fetch data)
    console.log(`2️⃣  Querying POST /v1/databases/${DB_ID}/query`);
    try {
        const res = await request(`/databases/${DB_ID}/query`, 'POST', { page_size: 1 });
        console.log(`   Status: ${res.status}`);
        if (res.status === 200) {
            console.log("   ✅ QUERY SUCCESS!");
            console.log(`   Fetched ${res.data.results.length} rows.`);
        } else {
            console.log("   ❌ QUERY FAILED.");
            console.log("   Message:", res.data.message);

            // If it fails with "multiple data sources", we know it's a Linked View
            if (res.data.code === 'validation_error') {
                console.log("   -> CONFIRMED: This is a Linked Database View (Collection).");
            }
        }
    } catch (e) {
        console.error("   Error:", e);
    }
}

diagnose();
