// /functions/api/save.js
import { getBeijingDate } from './_utils.js';

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
        const today = getBeijingDate();

        // 1. 获取用户
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

        // 提取数据（确保有默认值）
        const todayWarmup = parseInt(userData.todayWarmup) || 0;
        const todayRank = parseInt(userData.todayRank) || 0;
        const todayChallenge = parseInt(userData.todayChallenge) || 0;
        const todayTotal = parseInt(userData.todayTotal) || 0;

        const warmupScore = parseInt(userData.warmupScore) || 0;
        const rankScore = parseInt(userData.rankScore) || 0;
        const challengeScore = parseInt(userData.challengeScore) || 0;

        const warmupDate = userData.warmupDate || '';
        const challengeUsed = parseInt(userData.challengeUsed) || 0;
        const challengeDate = userData.challengeDate || today;

        console.log('[Save] 今日数据:', { todayWarmup, todayRank, todayChallenge, todayTotal });

        // 2. 更新 users 表
        try {
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
                warmupDate,
                rankScore,
                challengeScore,
                todayWarmup,
                todayRank,
                todayChallenge,
                todayTotal,
                today,
                challengeUsed,
                challengeDate,
                now,
                name
            ).run();
        } catch (e) {
            console.error('[Save] users 更新失败:', e);
            return new Response(JSON.stringify({ error: '更新用户数据失败: ' + e.message }), { status: 500, headers });
        }

        // 3. 更新排位赛每日记录
        if (userData.rankDaily && userData.rankDaily.used !== undefined) {
            try {
                const used = parseInt(userData.rankDaily.used) || 0;
                await db.prepare(`
                    INSERT INTO rank_daily (user_id, date, used)
                    VALUES (?, ?, ?)
                    ON CONFLICT(user_id, date) DO UPDATE SET used = ?
                `).bind(userId, today, used, used).run();
            } catch (e) {
                console.error('[Save] rank_daily 更新失败:', e);
                return new Response(JSON.stringify({ error: '更新排位记录失败: ' + e.message }), { status: 500, headers });
            }
        }

        // 4. 写入 daily_scores
        try {
            await db.prepare(`
                INSERT OR REPLACE INTO daily_scores (user_id, date, warmup_score, rank_score, challenge_score)
                VALUES (?, ?, ?, ?, ?)
            `).bind(userId, today, todayWarmup, todayRank, todayChallenge).run();
        } catch (e) {
            console.error('[Save] daily_scores 写入失败:', e);
            return new Response(JSON.stringify({ error: '写入 daily_scores 失败: ' + e.message }), { status: 500, headers });
        }

        // 5. 处理 daily_score_history 和 total_score
        try {
            const existingDaily = await db.prepare(`
                SELECT daily_score FROM daily_score_history WHERE user_id = ? AND date = ?
            `).bind(userId, today).first();

            let totalScore = parseInt(user.total_score) || 0;
            if (!existingDaily) {
                await db.prepare(`
                    INSERT INTO daily_score_history (user_id, date, daily_score) VALUES (?, ?, ?)
                `).bind(userId, today, todayTotal).run();
                totalScore += todayTotal;
            } else {
                const oldDaily = parseInt(existingDaily.daily_score) || 0;
                if (todayTotal > oldDaily) {
                    const delta = todayTotal - oldDaily;
                    await db.prepare(`
                        UPDATE daily_score_history SET daily_score = ? WHERE user_id = ? AND date = ?
                    `).bind(todayTotal, userId, today).run();
                    totalScore += delta;
                }
            }

            // 更新总积分
            await db.prepare(`
                UPDATE users SET total_score = ? WHERE name = ?
            `).bind(totalScore, name).run();
            console.log('[Save] 总积分更新为:', totalScore);
        } catch (e) {
            console.error('[Save] daily_score_history 处理失败:', e);
            return new Response(JSON.stringify({ error: '更新总积分失败: ' + e.message }), { status: 500, headers });
        }

        // 6. 查询最新用户数据并返回
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
        const used = rankDaily ? parseInt(rankDaily.used) : 0;
        updatedUser.rank_remain = Math.max(0, 3 - used);
        updatedUser.rankDaily = { date: today, used: used };

        return new Response(JSON.stringify({
            success: true,
            user: updatedUser
        }), { headers });

    } catch (err) {
        console.error('[Save] 未捕获错误:', err);
        return new Response(JSON.stringify({ error: '服务器内部错误: ' + err.message }), { status: 500, headers });
    }
}