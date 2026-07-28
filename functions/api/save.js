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

        // 1. 获取用户完整数据
        const existingUser = await db.prepare(`
                SELECT id, total_score, warmup_score, rank_score, challenge_score 
                FROM users WHERE name = ?
            `).bind(name).first();

        if (!existingUser) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        const userId = existingUser.id;
        const dailyScoreDate = userData.dailyScoreDate || today;

        // ⭐ 关键修复：从数据库中读取现有的总积分
        let totalScore = existingUser.total_score || 0;

        // 获取用户传入的积分
        const incomingWarmup = userData.warmupScore || 0;
        const incomingRank = userData.rankScore || 0;
        const incomingChallenge = userData.challengeScore || 0;

        // ⭐ 取最大值（历史最高分）
        const newWarmupScore = Math.max(existingUser.warmup_score || 0, incomingWarmup);
        const newRankScore = Math.max(existingUser.rank_score || 0, incomingRank);
        const newChallengeScore = Math.max(existingUser.challenge_score || 0, incomingChallenge);

        // ⭐ 重新计算总积分
        const calculatedTotal = newWarmupScore + newRankScore + newChallengeScore;

        // ⭐ 如果计算出的总积分大于当前总积分，则更新
        if (calculatedTotal > totalScore) {
            totalScore = calculatedTotal;
            console.log(`📊 总积分更新: ${existingUser.total_score || 0} -> ${totalScore}`);
        }

        console.log(`📤 保存用户 ${name}: totalScore=${totalScore}, dailyScoreDate=${dailyScoreDate}`);

        // 2. 更新 users 表
        const rankDailyJson = JSON.stringify(userData.rankDaily || { date: dailyScoreDate, used: 0 });

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

        // 3. 写入 daily_score_history 表
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