// /functions/api/sync-rank.js
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
        
        // ✅ 使用 UTC 日期
        const today = new Date().toISOString().split('T')[0];

        // 获取用户ID
        const user = await db.prepare(`
            SELECT id FROM users WHERE name = ?
        `).bind(name).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        const userId = user.id;

        // 查询今日排位赛已用次数
        let rankDaily = await db.prepare(`
            SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
        `).bind(userId, today).first();

        let used = 0;

        if (rankDaily) {
            used = rankDaily.used || 0;
        } else {
            // 没有记录则创建一条（used = 0），确保用户有记录
            await db.prepare(`
                INSERT INTO rank_daily (user_id, date, used) VALUES (?, ?, 0)
            `).bind(userId, today).run();
        }

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