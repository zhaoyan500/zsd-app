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

        // 先获取用户ID和当前版本号
        const user = await db.prepare(`
            SELECT id, version FROM users WHERE name = ?
        `).bind(name).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        const userId = user.id;
        const currentVersion = user.version || 1;

        // 检查版本号，防止并发覆盖
        if (userData.version && userData.version !== currentVersion) {
            return new Response(JSON.stringify({ 
                error: '数据已被其他操作修改，请刷新后重试',
                code: 'CONFLICT'
            }), { status: 409, headers });
        }

        // 使用事务批量更新
        const statements = [];

        // 1. 更新用户主表
        statements.push(
            db.prepare(`
                UPDATE users SET
                    warmup_score = ?,
                    warmup_date = ?,
                    rank_score = ?,
                    challenge_score = ?,
                    challenge_date = ?,
                    total_score = ?,
                    challenge_used = ?,
                    version = version + 1,
                    updated_at = ?
                WHERE name = ? AND version = ?
            `).bind(
                userData.warmupScore || 0,
                userData.warmupDate || '',
                userData.rankScore || 0,
                userData.challengeScore || 0,
                userData.challengeDate || '',
                userData.totalScore || 0,
                userData.challengeUsed || 0,
                now,
                name,
                currentVersion
            )
        );

        // 2. 更新排位赛每日记录
        if (userData.rankDaily && userData.rankDaily.date) {
            const today = new Date().toDateString();
            // 使用 INSERT OR REPLACE 避免并发冲突
            statements.push(
                db.prepare(`
                    INSERT INTO rank_daily (user_id, date, used) 
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id, date) DO UPDATE SET used = ?
                `).bind(userId, today, userData.rankDaily.used, userData.rankDaily.used)
            );
        }

        // 3. 保存排位赛历史记录
        if (userData.rankHistory && userData.rankHistory.length > 0) {
            // 先删除旧的排位赛历史
            statements.push(
                db.prepare(`
                    DELETE FROM quiz_history WHERE user_id = ? AND mode = 'ranked'
                `).bind(userId)
            );
            
            // 插入所有历史记录
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
            // 先删除旧的挑战赛历史
            statements.push(
                db.prepare(`
                    DELETE FROM quiz_history WHERE user_id = ? AND mode = 'challenge'
                `).bind(userId)
            );
            
            // 插入所有历史记录
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

        // 执行事务
        const results = await db.batch(statements);

        // 检查主表更新是否成功（防止并发覆盖）
        const updateResult = results[0];
        if (updateResult.changes === 0) {
            return new Response(JSON.stringify({ 
                error: '数据已被其他操作修改，请刷新后重试',
                code: 'CONFLICT'
            }), { status: 409, headers });
        }

        // 返回更新后的用户数据
        const updatedUser = await db.prepare(`
            SELECT id, name, unit, warmup_score, rank_score, challenge_score, total_score,
                   warmup_date, challenge_date, challenge_used, version, created_at, updated_at
            FROM users WHERE name = ?
        `).bind(name).first();

        return new Response(JSON.stringify({ 
            success: true, 
            user: updatedUser 
        }), { headers });

    } catch (err) {
        console.error('Save error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}