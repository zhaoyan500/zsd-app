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
        const today = new Date().toDateString();

        const user = await db.prepare(`
            SELECT id, version, daily_score, daily_score_date FROM users WHERE name = ?
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

        // 计算本次新增的积分（从各个模式获得的总分）
        let newDailyScore = 0;
        let newTotalScore = 0;

        // 计算各模式得分
        const warmupScore = userData.warmupScore || 0;
        const rankScore = userData.rankScore || 0;
        const challengeScore = userData.challengeScore || 0;
        
        // 当日总积分 = 热身 + 排位 + 挑战
        newDailyScore = warmupScore + rankScore + challengeScore;
        
        // 计算历史累计总积分
        // 获取当前用户的总积分
        const currentUser = await db.prepare(`
            SELECT total_score FROM users WHERE id = ?
        `).bind(userId).first();
        
        // 如果今日积分已重置，则新的总积分 = 原有总积分 + 今日得分
        // 否则总积分不变（因为已经累加过了）
        if (userData.daily_score_date === today) {
            // 如果当前存储的每日积分日期与请求一致，说明是同一日内的更新
            // 计算增量
            const oldDailyScore = user.daily_score || 0;
            const deltaScore = newDailyScore - oldDailyScore;
            newTotalScore = (currentUser.total_score || 0) + deltaScore;
        } else {
            // 新的一天，直接累加
            newTotalScore = (currentUser.total_score || 0) + newDailyScore;
        }

        const statements = [];

        // 1. 更新用户主表 - 包含每日积分和历史累计积分
        statements.push(
            db.prepare(`
                UPDATE users SET
                    warmup_score = ?,
                    warmup_date = ?,
                    rank_score = ?,
                    challenge_score = ?,
                    challenge_date = ?,
                    daily_score = ?,
                    daily_score_date = ?,
                    total_score = ?,
                    challenge_used = ?,
                    version = version + 1,
                    updated_at = ?
                WHERE name = ?
            `).bind(
                warmupScore,
                userData.warmupDate || '',
                rankScore,
                challengeScore,
                userData.challengeDate || '',
                newDailyScore,
                today,
                newTotalScore,
                userData.challengeUsed || 0,
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

        const updatedUser = await db.prepare(`
            SELECT id, name, unit, warmup_score, rank_score, challenge_score, 
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