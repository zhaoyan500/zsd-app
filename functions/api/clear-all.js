// /functions/api/clear-all.js
export async function onRequest(context) {
    const { request, env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    try {
        const body = await request.json();
        const { adminKey } = body;

        if (adminKey !== 'zsdcr123') {
            return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
        }

        const db = env.D1_DB;

        await db.prepare('DELETE FROM quiz_history').run();
        await db.prepare('DELETE FROM rank_daily').run();
        await db.prepare('DELETE FROM users').run();

        return new Response(JSON.stringify({ success: true }), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}