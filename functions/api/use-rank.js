// /functions/api/use-rank.js
import { getBeijingDate } from './_utils.js';

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
        const today = getBeijingDate();

        const user = await db.prepare(`SELECT id FROM users WHERE name = ?`).bind(name).first();
        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        // 原子更新：used < 3 时才加 1
        const result = await db.prepare(`
            UPDATE rank_daily 
            SET used = used + 1 
            WHERE user_id = ? AND date = ? AND used < 3
        `).bind(user.id, today).run();

        if (result.meta.changes === 0) {
            return new Response(JSON.stringify({
                success: false,
                error: '今日排位赛次数已用完'
            }), { status: 400, headers });
        }

        // 查询更新后的 used
        const newRank = await db.prepare(`
            SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
        `).bind(user.id, today).first();

        const used = newRank ? newRank.used : 0;
        const remain = Math.max(0, 3 - used);

        return new Response(JSON.stringify({
            success: true,
            rankDaily: { date: today, used },
            remain
        }), { headers });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}