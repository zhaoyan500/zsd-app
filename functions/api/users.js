// /functions/api/users.js
export async function onRequest(context) {
    const { env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    try {
        const db = env.D1_DB;

        const users = await db.prepare(`
            SELECT id, name, unit, 
                   daily_warmup_score, daily_rank_score, daily_challenge_score, daily_total_score, daily_date,
                   total_warmup_score, total_rank_score, total_challenge_score, total_total_score,
                   warmup_score, warmup_date, rank_score, challenge_score, challenge_date,
                   total_score, challenge_used, version, created_at
            FROM users
            ORDER BY (daily_total_score + total_total_score) DESC
        `).all();

        const results = users.results || [];
        const today = new Date().toISOString().split('T')[0];

        for (const user of results) {
            // 处理每日积分重置（只重置每日积分）
            if (user.daily_date !== today) {
                user.daily_warmup_score = 0;
                user.daily_rank_score = 0;
                user.daily_challenge_score = 0;
                user.daily_total_score = 0;
                user.daily_date = today;
            }
            
            // 计算显示总积分 = 每日积分 + 历史总积分
            user.total_score = (user.daily_total_score || 0) + (user.total_total_score || 0);

            // 从云端查询今日排位赛已用次数
            let rankDaily = await db.prepare(`
                SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
            `).bind(user.id, today).first();
            
            if (!rankDaily) {
                await db.prepare(`
                    INSERT INTO rank_daily (user_id, date, used) VALUES (?, ?, 0)
                `).bind(user.id, today).run();
                rankDaily = { used: 0 };
            }
            
            const used = rankDaily.used || 0;
            user.rank_remain = Math.max(0, 3 - used);
            user.rankDaily = { date: today, used: used };
        }

        return new Response(JSON.stringify(results), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}