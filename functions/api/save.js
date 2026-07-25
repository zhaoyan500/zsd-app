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

        // 获取用户ID和版本号
        const user = await db.prepare(`
            SELECT id, version FROM users WHERE name = ?
        `).bind(name).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        const userId = user.id;
        const currentVersion = user.version || 1;

        // 检查版本号
        if (userData.version && userData.version !== currentVersion) {
            return new Response(JSON.stringify({ 
                error: '数据已被其他操作修改，请刷新后重试',
                code: 'CONFLICT'
            }), { status: 409, headers });
        }

        // ✅ 从 userData 获取所有积分值（前端已正确累加）
        const dailyWarmup = userData.dailyWarmupScore || 0;
        const dailyRank = userData.dailyRankScore || 0;
        const dailyChallenge = userData.dailyChallengeScore || 0;
        const dailyTotal = userData.dailyTotalScore || 0;
        const dailyDate = userData.dailyDate || today;
        
        const totalWarmup = userData.totalWarmupScore || 0;
        const totalRank = userData.totalRankScore || 0;
        const totalChallenge = userData.totalChallengeScore || 0;
        const totalTotal = userData.totalTotalScore || 0;
        
        // ✅ 显示总积分 = 每日积分 + 历史总积分
        const displayTotal = dailyTotal + totalTotal;

        // ✅ 构建事务语句
        const statements = [];

        // ✅ 1. 更新用户主表 - 每日积分和历史积分独立存储
        statements.push(
            db.prepare(`
                UPDATE users SET
                    -- 📅 每日积分（每日重置）
                    daily_warmup_score = ?,
                    daily_rank_score = ?,
                    daily_challenge_score = ?,
                    daily_total_score = ?,
                    daily_date = ?,
                    
                    -- 🏛️ 历史总积分（永久累加，永不重置）
                    total_warmup_score = ?,
                    total_rank_score = ?,
                    total_challenge_score = ?,
                    total_total_score = ?,
                    
                    -- ✅ 兼容字段：存储每日积分（用于旧版查询和显示）
                    warmup_score = ?,
                    warmup_date = ?,
                    rank_score = ?,
                    challenge_score = ?,
                    challenge_date = ?,
                    
                    -- ✅ 显示总积分
                    total_score = ?,
                    challenge_used = ?,
                    version = version + 1,
                    updated_at = ?
                WHERE name = ?
            `).bind(
                // 📅 每日积分
                dailyWarmup,
                dailyRank,
                dailyChallenge,
                dailyTotal,
                dailyDate,
                
                // 🏛️ 历史总积分
                totalWarmup,
                totalRank,
                totalChallenge,
                totalTotal,
                
                // ✅ 兼容字段：存储每日积分
                dailyWarmup,   // warmup_score = 每日热身积分
                dailyDate,     // warmup_date = 当前日期
                dailyRank,     // rank_score = 每日排位积分
                dailyChallenge,// challenge_score = 每日挑战积分
                dailyDate,     // challenge_date = 当前日期
                
                // ✅ 显示总积分
                displayTotal,
                userData.challengeUsed || 0,
                now,
                name
            )
        );

        // 2. 更新排位赛每日记录
        if (userData.rankDaily && userData.rankDaily.used !== undefined) {
            const used = userData.rankDaily.used || 0;
            const dailyDate2 = userData.rankDaily.date || today;
            statements.push(
                db.prepare(`
                    INSERT INTO rank_daily (user_id, date, used) 
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id, date) DO UPDATE SET used = ?
                `).bind(userId, dailyDate2, used, used)
            );
        }

        // 3. 保存排位赛历史记录（限制最近30条）
        if (userData.rankHistory && userData.rankHistory.length > 0) {
            // 先删除旧记录，保留最近30条
            statements.push(
                db.prepare(`
                    DELETE FROM quiz_history WHERE user_id = ? AND mode = 'ranked'
                `).bind(userId)
            );
            
            // 只保留最近30条
            const historyToSave = userData.rankHistory.slice(-30);
            for (const entry of historyToSave) {
                if (entry && entry.score !== undefined && entry.date) {
                    statements.push(
                        db.prepare(`
                            INSERT INTO quiz_history (user_id, mode, score, date) VALUES (?, 'ranked', ?, ?)
                        `).bind(userId, entry.score, entry.date)
                    );
                }
            }
        }

        // 4. 保存挑战赛历史记录（限制最近30条）
        if (userData.challengeHistory && userData.challengeHistory.length > 0) {
            statements.push(
                db.prepare(`
                    DELETE FROM quiz_history WHERE user_id = ? AND mode = 'challenge'
                `).bind(userId)
            );
            
            const historyToSave = userData.challengeHistory.slice(-30);
            for (const entry of historyToSave) {
                if (entry && entry.score !== undefined && entry.date) {
                    statements.push(
                        db.prepare(`
                            INSERT INTO quiz_history (user_id, mode, score, date) VALUES (?, 'challenge', ?, ?)
                        `).bind(userId, entry.score, entry.date)
                    );
                }
            }
        }

        // 执行事务
        if (statements.length > 0) {
            await db.batch(statements);
        }

        // ✅ 获取更新后的用户数据
        const updatedUser = await db.prepare(`
            SELECT id, name, unit, 
                   daily_warmup_score, daily_rank_score, daily_challenge_score, daily_total_score, daily_date,
                   total_warmup_score, total_rank_score, total_challenge_score, total_total_score,
                   warmup_score, warmup_date, rank_score, challenge_score, challenge_date,
                   total_score, challenge_used, version, created_at, updated_at
            FROM users WHERE name = ?
        `).bind(name).first();

        // 获取最新的排位赛数据
        const rankDaily = await db.prepare(`
            SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
        `).bind(userId, today).first();
        
        const used = rankDaily ? rankDaily.used : 0;
        updatedUser.rank_remain = Math.max(0, 3 - used);
        updatedUser.rankDaily = { date: today, used: used };
        
        // ✅ 计算显示总积分 = 每日积分 + 历史总积分
        updatedUser.total_score = (updatedUser.daily_total_score || 0) + (updatedUser.total_total_score || 0);

        return new Response(JSON.stringify({ 
            success: true, 
            user: updatedUser 
        }), { headers });

    } catch (err) {
        console.error('Save error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}