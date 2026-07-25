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

        // 获取当前用户信息
        const user = await db.prepare(`
            SELECT id, version, daily_score, daily_score_date, 
                   today_warmup_score, today_rank_score, today_challenge_score,
                   total_score
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

        // 提取前端传来的今日各模式得分（若未传则使用当前数据库值）
        let todayWarmup = userData.todayWarmupScore !== undefined ? userData.todayWarmupScore : user.today_warmup_score;
        let todayRank = userData.todayRankScore !== undefined ? userData.todayRankScore : user.today_rank_score;
        let todayChallenge = userData.todayChallengeScore !== undefined ? userData.todayChallengeScore : user.today_challenge_score;

        // 计算新的每日积分
        const newDailyScore = todayWarmup + todayRank + todayChallenge;

        // 计算历史总积分增量
        let deltaTotal = 0;
        if (user.daily_score_date === today) {
            // 同一天内更新，增量 = 新每日积分 - 旧每日积分
            deltaTotal = newDailyScore - (user.daily_score || 0);
        } else {
            // 新的一天，直接累加
            deltaTotal = newDailyScore;
        }
        const newTotalScore = (user.total_score || 0) + deltaTotal;

        // 构建批量更新语句
        const statements = [];

        // 1. 更新用户主表（包含今日各模式得分和每日积分、总积分）
        statements.push(
            db.prepare(`
                UPDATE users SET
                    warmup_score = ?,
                    warmup_date = ?,
                    rank_score = ?,
                    challenge_score = ?,
                    challenge_date = ?,
                    challenge_used = ?,
                    today_warmup_score = ?,
                    today_rank_score = ?,
                    today_challenge_score = ?,
                    daily_score = ?,
                    daily_score_date = ?,
                    total_score = ?,
                    version = version + 1,
                    updated_at = ?
                WHERE name = ?
            `).bind(
                userData.warmupScore || 0,
                userData.warmupDate || '',
                userData.rankScore || 0,
                userData.challengeScore || 0,
                userData.challengeDate || '',
                userData.challengeUsed || 0,
                todayWarmup,
                todayRank,
                todayChallenge,
                newDailyScore,
                today,
                newTotalScore,
                now,
                name
            )
        );

        // 2. 更新排位赛每日记录
        if (userData.rankDaily && userData.rankDaily.used !== undefined) {
            const used = userData.rankDaily.used || 0;
            statements.push(
                db.prepare(`
                    INSERT INTO rank_daily (user_id, date, used) 
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id, date) DO UPDATE SET used = ?
                `).bind(userId, today, used, used)
            );
        }

        // 3. 保存排位赛历史记录
        if (userData.rankHistory && userData.rankHistory.length > 0) {
            statements.push(
                db.prepare(`
                    DELETE FROM quiz_history WHERE user_id = ? AND mode = 'ranked'
                `).bind(userId)
            );
            
            for (const entry of userData.rankHistory) {
                if (entry && entry.score !== undefined && entry.date) {
                    statements.push(
                        db.prepare(`
                            INSERT INTO quiz_history (user_id, mode, score, date) VALUES (?, 'ranked', ?, ?)
                        `).bind(userId, entry.score, entry.date)
                    );
                }
            }
        }

        // 4. 保存挑战赛历史记录
        if (userData.challengeHistory && userData.challengeHistory.length > 0) {
            statements.push(
                db.prepare(`
                    DELETE FROM quiz_history WHERE user_id = ? AND mode = 'challenge'
                `).bind(userId)
            );
            
            for (const entry of userData.challengeHistory) {
                if (entry && entry.score !== undefined && entry.date) {
                    statements.push(
                        db.prepare(`
                            INSERT INTO quiz_history (user_id, mode, score, date) VALUES (?, 'challenge', ?, ?)
                        `).bind(userId, entry.score, entry.date)
                    );
                }
            }
        }

        if (statements.length > 0) {
            await db.batch(statements);
        }

        // 返回更新后的用户数据
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