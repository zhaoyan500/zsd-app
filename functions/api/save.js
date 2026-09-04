// /functions/api/save.js
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
        const { name, userData } = body;

        if (!name || !userData) {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        const db = env.D1_DB;
        const now = new Date().toISOString();
        const today = new Date().toISOString().split('T')[0];

        // 获取用户当前数据
        const user = await db.prepare(`
            SELECT id, version, total_score, daily_score_date
            FROM users WHERE name = ?
        `).bind(name).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        const userId = user.id;
        const currentVersion = user.version || 1;

        if (userData.version && userData.version !== currentVersion) {
            return new Response(JSON.stringify({
                error: '数据已被其他操作修改，请刷新后重试',
                code: 'CONFLICT'
            }), { status: 409, headers });
        }

        const todayWarmup = userData.todayWarmup || 0;
        const todayRank = userData.todayRank || 0;
        const todayChallenge = userData.todayChallenge || 0;
        const todayTotal = userData.todayTotal || 0;

        const warmupScore = userData.warmupScore || 0;
        const rankScore = userData.rankScore || 0;
        const challengeScore = userData.challengeScore || 0;

        // 更新 users 表
        await db.prepare(`
            UPDATE users SET
                warmup_score = ?,
                warmup_date = ?,
                rank_score = ?,
                challenge_score = ?,
                today_warmup_score = ?,
                today_rank_score = ?,
                today_challenge_score = ?,
                daily_score = ?,
                daily_score_date = ?,
                challenge_used = ?,
                challenge_date = ?,
                version = version + 1,
                updated_at = ?
            WHERE name = ?
        `).bind(
            warmupScore,
            userData.warmupDate || '',
            rankScore,
            challengeScore,
            todayWarmup,
            todayRank,
            todayChallenge,
            todayTotal,
            today,
            userData.challengeUsed || 0,
            userData.challengeDate || today,
            now,
            name
        ).run();

        // 更新排位赛每日记录
        if (userData.rankDaily && userData.rankDaily.used !== undefined) {
            const used = userData.rankDaily.used || 0;
            await db.prepare(`
                INSERT INTO rank_daily (user_id, date, used) 
                VALUES (?, ?, ?)
                ON CONFLICT(user_id, date) DO UPDATE SET used = ?
            `).bind(userId, today, used, used).run();
        }

        // ===== 新增：写入 daily_scores 表（每日各赛制最高分） =====
        await db.prepare(`
            INSERT INTO daily_scores (user_id, date, warmup_score, rank_score, challenge_score)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET
                warmup_score = excluded.warmup_score,
                rank_score = excluded.rank_score,
                challenge_score = excluded.challenge_score
        `).bind(userId, today, todayWarmup, todayRank, todayChallenge).run();

        // 处理每日积分历史（total_score 累计）
        const existingDaily = await db.prepare(`
            SELECT daily_score FROM daily_score_history WHERE user_id = ? AND date = ?
        `).bind(userId, today).first();

        let totalScore = user.total_score || 0;
        if (!existingDaily) {
            await db.prepare(`
                INSERT INTO daily_score_history (user_id, date, daily_score) VALUES (?, ?, ?)
            `).bind(userId, today, todayTotal).run();
            totalScore += todayTotal;
        } else {
            const oldDaily = existingDaily.daily_score || 0;
            if (todayTotal > oldDaily) {
                const delta = todayTotal - oldDaily;
                await db.prepare(`
                    UPDATE daily_score_history SET daily_score = ? WHERE user_id = ? AND date = ?
                `).bind(todayTotal, userId, today).run();
                totalScore += delta;
            }
        }

        await db.prepare(`
            UPDATE users SET total_score = ? WHERE name = ?
        `).bind(totalScore, name).run();

        // 查询最新用户数据
        const updatedUser = await db.prepare(`
            SELECT id, name, unit, 
                   warmup_score, rank_score, challenge_score,
                   today_warmup_score, today_rank_score, today_challenge_score,
                   daily_score, daily_score_date, total_score,
                   warmup_date, challenge_date, challenge_used, version, created_at, updated_at
            FROM users WHERE name = ?
        `).bind(name).first();

        const rankDaily = await db.prepare(`
            SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
        `).bind(userId, today).first();
        const used = rankDaily ? rankDaily.used : 0;
        updatedUser.rank_remain = Math.max(0, 3 - used);
        updatedUser.rankDaily = { date: today, used: used };

        return new Response(JSON.stringify({
            success: true,
            user: updatedUser
        }), { headers });

    } catch (err) {
        console.error('Save error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}