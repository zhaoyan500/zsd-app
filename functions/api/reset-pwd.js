// /functions/api/reset-pwd.js
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
        const { name, newPwd } = body;

        if (!name || !newPwd) {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        const db = env.D1_DB;

        const result = await db.prepare(`
            UPDATE users SET pwd = ?, updated_at = datetime('now') WHERE name = ?
        `).bind(newPwd, name).run();

        if (result.changes === 0) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        return new Response(JSON.stringify({ success: true }), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}