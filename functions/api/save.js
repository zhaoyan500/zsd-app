// /functions/api/save.js
import { getBeijingDate } from './_utils.js';

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
        const today = getBeijingDate();

        // 1. 获取用户现有数据
        const existingUser = await db.prepare(`
            SELECT id, total_score, daily_score, warmup_score, rank_score, challenge_score 
            FROM users WHERE name = ?
        `).bind(name).first();

        if (!existingUser) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        const userId = existingUser.id;
        const dailyScoreDate = userData.dailyScoreDate || today;

        // 2. 更新各模式历史最高分
        const newWarmupScore = Math.max(existingUser.warmup_score || 0, userData.warmupScore || 0);
        const newRankScore = Math.max(existingUser.rank_score || 0, userData.rankScore || 0);
        const newChallengeScore = Math.max(existingUser.challenge_score || 0, userData.challengeScore || 0);

        // 3. 计算新的当日积分（三项今日最高分之和，仅用于展示和记录）
        const newDailyScore = (userData.todayWarmup || 0) + (userData.todayRank || 0) + (userData.todayChallenge || 0);

        // 4. 总积分 = 三项模式最高分之和（不再累计）
        const newTotalScore = newWarmupScore + newRankScore + newChallengeScore;

        console.log(`📊 用户 ${name}: 最高分 热身=${newWarmupScore}, 排位=${newRankScore}, 挑战=${newChallengeScore}, 总积分=${newTotalScore}`);

        // 5. 更新 users 表
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
            newDailyScore,
            dailyScoreDate,
            newTotalScore,
            userData.challengeUsed || 0,
            userData.challengeDate || '',
            (userData.version || 1) + 1,
            name
        ).run();

        // 6. 写入 daily_score_history（记录每日最终值，用于周/月榜）
        await db.prepare(`
            INSERT INTO daily_score_history (user_id, date, daily_score)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET daily_score = excluded.daily_score
        `).bind(userId, dailyScoreDate, newDailyScore).run();

        // 7. 返回更新后的用户数据
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