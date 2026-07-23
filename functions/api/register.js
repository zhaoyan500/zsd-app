// /functions/api/register.js
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
        const { name, unit, pwd } = body;

        if (!name || !unit || !pwd) {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        const db = env.D1_DB;

        const existing = await db.prepare('SELECT name FROM users WHERE name = ?').bind(name).first();
        if (existing) {
            return new Response(JSON.stringify({ error: '用户名已存在' }), { status: 409, headers });
        }

        const id = Date.now().toString();
        const now = new Date().toISOString();

        await db.prepare(`
            INSERT INTO users (id, name, unit, pwd, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).bind(id, name, unit, pwd, now, now).run();

        const user = await db.prepare(`
            SELECT id, name, unit, warmup_score, rank_score, challenge_score, total_score,
                   warmup_date, rank_remain, challenge_date, challenge_used, created_at
            FROM users WHERE id = ?
        `).bind(id).first();

        return new Response(JSON.stringify({ success: true, user: user }), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}