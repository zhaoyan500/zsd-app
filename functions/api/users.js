// /functions/api/users.js
import { getBeijingDate } from './_utils.js';

export async function onRequest(context) {
    const { env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    try {
        const db = env.D1_DB;
        const today = getBeijingDate();

        let users;
        let hasNewFields = false;
        try {
            users = await db.prepare(`
                SELECT id, name, unit,
                       warmup_score, rank_score, challenge_score,
                       daily_score, historical_score, start_of_day_score,
                       warmup_date, challenge_date, challenge_used, version, created_at
                FROM users
                ORDER BY (COALESCE(historical_score,0) + COALESCE(daily_score,0)) DESC
            `).all();
            hasNewFields = true;
        } catch (err) {
            if (err.message && err.message.includes('no such column')) {
                console.warn('[Users] 新字段不存在，降级处理');
                users = await db.prepare(`
                    SELECT id, name, unit,
                           warmup_score, rank_score, challenge_score, total_score,
                           warmup_date, challenge_date, challenge_used, version, created_at
                    FROM users
                    ORDER BY total_score DESC
                `).all();
            } else {
                throw err;
            }
        }

        const results = users.results || [];

        for (const user of results) {
            // 字段兜底
            if (user.historical_score === undefined) user.historical_score = 0;
            if (user.daily_score === undefined) user.daily_score = 0;
            if (user.start_of_day_score === undefined) user.start_of_day_score = 0;
            // total_score 兜底：实时分 + 历史分
            user.total_score = (user.daily_score || 0) + (user.historical_score || 0);

            let rankDaily = await db.prepare(`
                SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
            `).bind(user.id, today).first();
            if (!rankDaily) rankDaily = { used: 0 };
            user.rank_remain = Math.max(0, 3 - (rankDaily.used || 0));
            user.rankDaily = { date: today, used: rankDaily.used };
        }

        return new Response(JSON.stringify(results), { headers });
    } catch (err) {
        console.error('[Users] 错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}