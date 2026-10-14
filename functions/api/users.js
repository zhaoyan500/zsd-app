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
            // 一次 JOIN 查出所有用户 + 今日 rank_daily
            users = await db.prepare(`
                SELECT
                    u.id, u.name, u.unit,
                    u.warmup_score, u.rank_score, u.challenge_score,
                    u.daily_score, u.historical_score, u.start_of_day_score,
                    u.today_warmup_score, u.today_rank_score, u.today_challenge_score,
                    u.warmup_date, u.challenge_date, u.challenge_used,
                    u.version, u.created_at,
                    COALESCE(rd.used, 0) AS rank_used
                FROM users u
                LEFT JOIN rank_daily rd ON rd.user_id = u.id AND rd.date = ?
                ORDER BY (COALESCE(u.historical_score,0) + COALESCE(u.daily_score,0)) DESC
            `).bind(today).all();
            hasNewFields = true;
        } catch (err) {
            if (err.message && err.message.includes('no such column')) {
                console.warn('[Users] 新字段不存在，降级处理');
                users = await db.prepare(`
                    SELECT
                        u.id, u.name, u.unit,
                        u.warmup_score, u.rank_score, u.challenge_score, u.total_score,
                        u.warmup_date, u.challenge_date, u.challenge_used,
                        u.version, u.created_at,
                        COALESCE(rd.used, 0) AS rank_used
                    FROM users u
                    LEFT JOIN rank_daily rd ON rd.user_id = u.id AND rd.date = ?
                    ORDER BY u.total_score DESC
                `).bind(today).all();
            } else {
                throw err;
            }
        }

        const results = users.results || [];

        for (const user of results) {
            if (user.historical_score === undefined) user.historical_score = 0;
            if (user.daily_score === undefined) user.daily_score = 0;
            if (user.start_of_day_score === undefined) user.start_of_day_score = 0;
            if (user.today_warmup_score === undefined) user.today_warmup_score = 0;
            if (user.today_rank_score === undefined) user.today_rank_score = 0;
            if (user.today_challenge_score === undefined) user.today_challenge_score = 0;

            // 后端权威 total_score
            user.total_score = (user.daily_score || 0) + (user.historical_score || 0);

            const used = user.rank_used || 0;
            user.rank_remain = Math.max(0, 3 - used);
            user.rankDaily = { date: today, used: used };
            delete user.rank_used;
        }

        return new Response(JSON.stringify(results), { headers });
    } catch (err) {
        console.error('[Users] 错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}