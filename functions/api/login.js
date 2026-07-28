// /functions/api/login.js
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
        const { name, pwd } = body;

        if (!name || !pwd) {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        const db = env.D1_DB;

        const user = await db.prepare(`
            SELECT 
                id, name, unit, pwd, 
                COALESCE(warmup_score, 0) as warmup_score,
                COALESCE(rank_score, 0) as rank_score,
                COALESCE(challenge_score, 0) as challenge_score,
                COALESCE(today_warmup_score, 0) as today_warmup_score,
                COALESCE(today_rank_score, 0) as today_rank_score,
                COALESCE(today_challenge_score, 0) as today_challenge_score,
                COALESCE(daily_score, 0) as daily_score,
                daily_score_date,
                COALESCE(total_score, 0) as total_score,
                warmup_date, challenge_date, challenge_used, version, created_at, updated_at
            FROM users WHERE name = ?
        `).bind(name).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        if (user.pwd !== pwd) {
            return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
        }

        // ========== 核心修复：强制按三项最高分之和重算 total_score ==========
        const calculatedTotal = (user.warmup_score || 0) + (user.rank_score || 0) + (user.challenge_score || 0);
        if (calculatedTotal !== user.total_score) {
            console.log(`🔧 修复用户 ${name} 的 total_score: ${user.total_score} -> ${calculatedTotal}`);
            await db.prepare(`UPDATE users SET total_score = ? WHERE id = ?`).bind(calculatedTotal, user.id).run();
            user.total_score = calculatedTotal;
        }

        const today = new Date().toISOString().split('T')[0];

        // 如果 daily_score_date 为空，设置今天
        if (!user.daily_score_date) {
            user.daily_score_date = today;
            await db.prepare(`UPDATE users SET daily_score_date = ? WHERE id = ?`).bind(today, user.id).run();
        }

        // 如果日期不同，重置今日数据
        if (user.daily_score_date !== today) {
            console.log(`🔄 用户 ${name}: daily_score_date 从 ${user.daily_score_date} 更新为 ${today}`);
            await db.prepare(`
                UPDATE users SET 
                    daily_score = 0, 
                    daily_score_date = ?,
                    today_warmup_score = 0,
                    today_rank_score = 0,
                    today_challenge_score = 0,
                    updated_at = datetime('now')
                WHERE id = ?
            `).bind(today, user.id).run();

            user.daily_score = 0;
            user.daily_score_date = today;
            user.today_warmup_score = 0;
            user.today_rank_score = 0;
            user.today_challenge_score = 0;
        }

        // 重置挑战赛使用次数
        if (user.challenge_date !== today) {
            await db.prepare(`
                UPDATE users SET 
                    challenge_used = 0, 
                    challenge_date = ?,
                    updated_at = datetime('now')
                WHERE id = ?
            `).bind(today, user.id).run();
            user.challenge_used = 0;
            user.challenge_date = today;
        }

        // 排位赛每日记录
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
        const rankRemain = Math.max(0, 3 - used);

        delete user.pwd;

        return new Response(JSON.stringify({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                unit: user.unit || '',
                warmup_score: user.warmup_score || 0,
                rank_score: user.rank_score || 0,
                challenge_score: user.challenge_score || 0,
                today_warmup_score: user.today_warmup_score || 0,
                today_rank_score: user.today_rank_score || 0,
                today_challenge_score: user.today_challenge_score || 0,
                daily_score: user.daily_score || 0,
                daily_score_date: user.daily_score_date || today,
                total_score: user.total_score || 0,
                warmup_date: user.warmup_date || '',
                challenge_date: user.challenge_date || '',
                challenge_used: user.challenge_used || 0,
                version: user.version || 1,
                created_at: user.created_at,
                updated_at: user.updated_at,
                rank_remain: rankRemain,
                rankDaily: { date: today, used: used },
                // 驼峰命名兼容
                totalScore: user.total_score || 0,
                dailyScoreDate: user.daily_score_date || today,
                warmupScore: user.warmup_score || 0,
                rankScore: user.rank_score || 0,
                challengeScore: user.challenge_score || 0,
                todayWarmup: user.today_warmup_score || 0,
                todayRank: user.today_rank_score || 0,
                todayChallenge: user.today_challenge_score || 0
            }
        }), { headers });

    } catch (err) {
        console.error('login.js error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}