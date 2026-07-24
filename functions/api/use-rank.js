// /functions/api/use-rank.js
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
        const { name } = body;

        if (!name) {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        const db = env.D1_DB;
        const today = new Date().toDateString();

        // 获取用户ID
        const user = await db.prepare(`
            SELECT id FROM users WHERE name = ?
        `).bind(name).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        // 先查询当前使用次数
        let rankDaily = await db.prepare(`
            SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
        `).bind(user.id, today).first();

        let used = rankDaily ? (rankDaily.used || 0) : 0;

        if (used >= 3) {
            return new Response(JSON.stringify({
                success: false,
                error: '今日排位赛次数已用完'
            }), { status: 400, headers });
        }

        // 增加使用次数
        used += 1;
        await db.prepare(`
            INSERT INTO rank_daily (user_id, date, used) 
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET used = ?
        `).bind(user.id, today, used, used).run();

        const remain = Math.max(0, 3 - used);

        return new Response(JSON.stringify({
            success: true,
            rankDaily: { date: today, used: used },
            remain: remain
        }), { headers });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}