// /functions/api/save.js
export async function onRequest(context) {
    const { request, env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    try {
        const body = await request.json();
        const { name, userData } = body;

        if (!name || !userData) {
            return new Response(JSON.stringify({ error: '缺少必要参数' }), { status: 400, headers });
        }

        const db = env.D1_DB;
        const today = new Date().toISOString().split('T')[0];

        // 1. 获取用户ID
        const user = await db.prepare('SELECT id FROM users WHERE name = ?').bind(name).first();
        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        const userId = user.id;
        
        // ⭐ 修复：使用传入的 dailyScoreDate，如果没有则使用今天
        const dailyScoreDate = userData.dailyScoreDate || today;

        // ⭐ 修复：计算总积分
        let totalScore = userData.totalScore || 0;
        if (totalScore === 0) {
            const warmupScore = userData.warmupScore || 0;
            const rankScore = userData.rankScore || 0;
            const challengeScore = userData.challengeScore || 0;
            totalScore = warmupScore + rankScore + challengeScore;
        }

        // ⭐ 获取当前用户数据以保留历史最高分
        const currentUser = await db.prepare(`
            SELECT warmup_score, rank_score, challenge_score 
            FROM users WHERE id = ?
        `).bind(userId).first();

        // ⭐ 只更新今日数据，不覆盖历史最高分（除非新的分数更高）
        const newWarmupScore = Math.max(currentUser.warmup_score || 0, userData.warmupScore || 0);
        const newRankScore = Math.max(currentUser.rank_score || 0, userData.rankScore || 0);
        const newChallengeScore = Math.max(currentUser.challenge_score || 0, userData.challengeScore || 0);

        // 2. 更新 users 表
        const rankDailyJson = JSON.stringify(userData.rankDaily || { date: dailyScoreDate, used: 0 });
        
        console.log(`📤 保存用户 ${name}: totalScore=${totalScore}, dailyScoreDate=${dailyScoreDate}`);
        console.log(`📊 历史最高: 热身=${newWarmupScore}, 排位=${newRankScore}, 挑战=${newChallengeScore}`);
        console.log(`📊 今日数据: 热身=${userData.todayWarmup || 0}, 排位=${userData.todayRank || 0}, 挑战=${userData.todayChallenge || 0}`);
        
        await db.prepare(`
            UPDATE users SET
                unit = ?,
                warmup_score = ?,
                warmup_date = ?,
                rank_score = ?,
                challenge_score = ?,
                today_warmup_score = ?,
                today_rank_score = ?,
                today_challenge_score = ?,
                daily_score = ?,
                daily_score_date = ?,
                total_score = ?,
                challenge_used = ?,
                challenge_date = ?,
                rank_daily = ?,
                version = ?,
                updated_at = datetime('now')
            WHERE name = ?
        `).bind(
            userData.unit || '',
            newWarmupScore,
            userData.warmupDate || '',
            newRankScore,
            newChallengeScore,
            userData.todayWarmup || 0,
            userData.todayRank || 0,
            userData.todayChallenge || 0,
            userData.todayTotal || 0,
            dailyScoreDate,
            totalScore,
            userData.challengeUsed || 0,
            userData.challengeDate || '',
            rankDailyJson,
            (userData.version || 1) + 1,
            name
        ).run();

        // 3. 写入 daily_score_history 表（用于周/月榜）
        const dailyScore = userData.todayTotal || 0;
        await db.prepare(`
            INSERT INTO daily_score_history (user_id, date, daily_score)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET daily_score = excluded.daily_score
        `).bind(userId, dailyScoreDate, dailyScore).run();

        // 4. 返回更新后的用户数据
        const updatedUser = await db.prepare(`
            SELECT 
                id, name, unit, 
                warmup_score, rank_score, challenge_score,
                today_warmup_score, today_rank_score, today_challenge_score,
                daily_score, daily_score_date, total_score,
                warmup_date, challenge_date, challenge_used, version, created_at, updated_at
            FROM users WHERE name = ?
        `).bind(name).first();

        // ⭐ 添加 rankDaily 信息
        if (updatedUser) {
            const rankD = await db.prepare(`
                SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
            `).bind(updatedUser.id, dailyScoreDate).first();
            updatedUser.rank_remain = rankD ? Math.max(0, 3 - (rankD.used || 0)) : 3;
            updatedUser.rankDaily = { date: dailyScoreDate, used: rankD ? (rankD.used || 0) : 0 };
        }

        return new Response(JSON.stringify({
            success: true,
            user: updatedUser
        }), { headers });

    } catch (err) {
        console.error('save.js error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}