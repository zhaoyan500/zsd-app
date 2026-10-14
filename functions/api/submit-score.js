// /functions/api/submit-score.js
// 前端只上报本次答题结果，后端重算所有分数
import { getBeijingDate, getISOWeek, runWeeklyTransfer } from './_utils.js';

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
        const { name, mode, score, detail } = body;

        if (!name || !mode || typeof score !== 'number') {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        // ===== 1. 分数上限校验（防篡改）=====
        const MAX_SCORE = { warmup: 100, ranked: 150, challenge: 200 };
        const maxAllowed = MAX_SCORE[mode];
        if (!maxAllowed) {
            return new Response(JSON.stringify({ error: '未知模式' }), { status: 400, headers });
        }
        if (score < 0 || score > maxAllowed) {
            return new Response(JSON.stringify({ error: `分数超出范围 (0~${maxAllowed})` }), { status: 400, headers });
        }
        const finalScore = Math.floor(score);

        const db = env.D1_DB;
        const now = new Date().toISOString();
        const today = getBeijingDate();

        // ===== 2. 查询用户 =====
        const user = await db.prepare(`
            SELECT id, name, unit,
                   warmup_score, rank_score, challenge_score,
                   today_warmup_score, today_rank_score, today_challenge_score,
                   daily_score, daily_score_date,
                   reward_date, start_of_day_score, historical_score, last_transfer_week,
                   challenge_date, challenge_used
            FROM users WHERE name = ?
        `).bind(name).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        const userId = user.id;

        // ===== 3. 周转移（lazy）=====
        const currentWeek = getISOWeek(today);
        if (!user.last_transfer_week || user.last_transfer_week !== currentWeek) {
            await runWeeklyTransfer(db, currentWeek);
            const refreshed = await db.prepare(`
                SELECT daily_score, start_of_day_score, daily_score_date,
                       reward_date, historical_score, last_transfer_week,
                       challenge_date, challenge_used,
                       today_warmup_score, today_rank_score, today_challenge_score,
                       warmup_score, rank_score, challenge_score
                FROM users WHERE id = ?
            `).bind(userId).first();
            if (refreshed) Object.assign(user, refreshed);
        }

        // ===== 4. 跨天检查 =====
        let startOfDay = user.start_of_day_score || 0;
        if (user.daily_score_date !== today) {
            startOfDay = user.daily_score || 0;
            await db.prepare(`
                UPDATE users SET
                    start_of_day_score = ?,
                    daily_score_date = ?,
                    today_warmup_score = 0,
                    today_rank_score = 0,
                    today_challenge_score = 0
                WHERE id = ?
            `).bind(startOfDay, today, userId).run();
            user.start_of_day_score = startOfDay;
            user.daily_score_date = today;
            user.today_warmup_score = 0;
            user.today_rank_score = 0;
            user.today_challenge_score = 0;
        }

        // ===== 5. 各模式次数校验 =====
        if (mode === 'ranked') {
            const rankRow = await db.prepare(`
                SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
            `).bind(userId, today).first();
            const used = rankRow ? (rankRow.used || 0) : 0;
            if (used >= 3) {
                return new Response(JSON.stringify({ error: '今日排位赛次数已用完' }), { status: 400, headers });
            }
            await db.prepare(`
                INSERT INTO rank_daily (user_id, date, used) VALUES (?, ?, ?)
                ON CONFLICT(user_id, date) DO UPDATE SET used = ?
            `).bind(userId, today, used + 1, used + 1).run();
        } else if (mode === 'challenge') {
            if (user.challenge_date === today && (user.challenge_used || 0) >= 1) {
                return new Response(JSON.stringify({ error: '今日挑战赛已参加' }), { status: 400, headers });
            }
            await db.prepare(`
                UPDATE users SET challenge_used = 1, challenge_date = ? WHERE id = ?
            `).bind(today, userId).run();
        }

        // ===== 6. 后端重算所有 today_* 和 daily_score =====
        const newTodayWarmup = mode === 'warmup'
            ? Math.max(user.today_warmup_score || 0, finalScore)
            : (user.today_warmup_score || 0);
        const newTodayRank = mode === 'ranked'
            ? Math.max(user.today_rank_score || 0, finalScore)
            : (user.today_rank_score || 0);
        const newTodayChallenge = mode === 'challenge'
            ? Math.max(user.today_challenge_score || 0, finalScore)
            : (user.today_challenge_score || 0);

        const newWarmupScore = mode === 'warmup'
            ? Math.max(user.warmup_score || 0, finalScore)
            : (user.warmup_score || 0);
        const newRankScore = mode === 'ranked'
            ? Math.max(user.rank_score || 0, finalScore)
            : (user.rank_score || 0);
        const newChallengeScore = mode === 'challenge'
            ? Math.max(user.challenge_score || 0, finalScore)
            : (user.challenge_score || 0);

        // 登录奖励：save 时若今天未登录，补 +2
        const loginBonus = (user.reward_date === today) ? 2 : 0;

        // 按日突破式
        const todayQuizMax = newTodayWarmup + newTodayRank + newTodayChallenge;
        const newDailyScore = Math.max(startOfDay, todayQuizMax) + loginBonus;

        // ===== 7. 写入所有表 =====
        await db.prepare(`
            UPDATE users SET
                warmup_score = ?, rank_score = ?, challenge_score = ?,
                today_warmup_score = ?, today_rank_score = ?, today_challenge_score = ?,
                daily_score = ?, daily_score_date = ?,
                reward_date = ?,
                version = version + 1,
                updated_at = ?
            WHERE id = ?
        `).bind(
            newWarmupScore, newRankScore, newChallengeScore,
            newTodayWarmup, newTodayRank, newTodayChallenge,
            newDailyScore, today,
            today,
            now,
            userId
        ).run();

        await db.prepare(`
            INSERT OR REPLACE INTO daily_scores (user_id, date, warmup_score, rank_score, challenge_score)
            VALUES (?, ?, ?, ?, ?)
        `).bind(userId, today, newTodayWarmup, newTodayRank, newTodayChallenge).run();

        await db.prepare(`
            INSERT OR REPLACE INTO daily_score_history (user_id, date, daily_score)
            VALUES (?, ?, ?)
        `).bind(userId, today, newDailyScore).run();

        // ===== 8. 返回最新完整用户数据 =====
        const updated = await db.prepare(`
            SELECT id, name, unit,
                   warmup_score, rank_score, challenge_score,
                   today_warmup_score, today_rank_score, today_challenge_score,
                   daily_score, daily_score_date,
                   reward_date, start_of_day_score, historical_score,
                   challenge_date, challenge_used,
                   version, created_at, updated_at
            FROM users WHERE id = ?
        `).bind(userId).first();

        const rankRow = await db.prepare(`
            SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
        `).bind(userId, today).first();
        const used = rankRow ? (rankRow.used || 0) : 0;

        updated.rank_remain = Math.max(0, 3 - used);
        updated.rankDaily = { date: today, used: used };
        updated.total_score = (updated.daily_score || 0) + (updated.historical_score || 0);

        return new Response(JSON.stringify({
            success: true,
            user: updated,
            thisRound: { mode, score: finalScore }
        }), { headers });

    } catch (err) {
        console.error('[SubmitScore] 错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}