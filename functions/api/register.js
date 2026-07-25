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

        const id = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6);
        const now = new Date().toISOString();
        const today = new Date().toISOString().split('T')[0];

        await db.prepare(`
            INSERT INTO users (
                id, name, unit, pwd, 
                daily_warmup_score, daily_rank_score, daily_challenge_score, daily_total_score, daily_date,
                total_warmup_score, total_rank_score, total_challenge_score, total_total_score,
                warmup_score, warmup_date, rank_score, challenge_score, challenge_date,
                total_score, challenge_used, version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, 0, 0, 0, 0, 0, '', 0, 0, '', 0, 0, 1, ?, ?)
        `).bind(id, name, unit, pwd, today, now, now).run();

        const user = await db.prepare(`
            SELECT id, name, unit, 
                   daily_warmup_score, daily_rank_score, daily_challenge_score, daily_total_score, daily_date,
                   total_warmup_score, total_rank_score, total_challenge_score, total_total_score,
                   warmup_score, warmup_date, rank_score, challenge_score, challenge_date,
                   total_score, challenge_used, version, created_at
            FROM users WHERE id = ?
        `).bind(id).first();

        // 设置显示用的总积分
        user.total_score = (user.daily_total_score || 0) + (user.total_total_score || 0);
        user.rank_remain = 3;

        return new Response(JSON.stringify({ success: true, user: user }), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}