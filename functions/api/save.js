// /functions/api/save.js
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
        const { name, userData } = body;

        if (!name || !userData) {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        const db = env.D1_DB;
        const now = new Date().toISOString();
        const today = getBeijingDate();

        // 查询用户（兼容新旧字段）
        let user;
        let hasNewFields = false;
        try {
            user = await db.prepare(`
                SELECT id, name, unit,
                       warmup_score, rank_score, challenge_score,
                       today_warmup_score, today_rank_score, today_challenge_score,
                       daily_score, daily_score_date,
                       warmup_date, challenge_date, challenge_used, version, created_at, updated_at,
                       reward_date,
                       start_of_day_score, historical_score, last_transfer_week
                FROM users WHERE name = ?
            `).bind(name).first();
            if (user && user.historical_score !== undefined) hasNewFields = true;
        } catch (err) {
            if (err.message && err.message.includes('no such column')) {
                console.warn('[Save] 新字段不存在，降级处理');
                user = await db.prepare(`
                    SELECT id, name, unit,
                           warmup_score, rank_score, challenge_score,
                           today_warmup_score, today_rank_score, today_challenge_score,
                           daily_score, daily_score_date,
                           warmup_date, challenge_date, challenge_used, version, created_at, updated_at
                    FROM users WHERE name = ?
                `).bind(name).first();
            } else {
                throw err;
            }
        }

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        const userId = user.id;

        // ===== 周日 24:00 转存检查（lazy transfer） =====
        if (hasNewFields) {
            const currentWeek = getISOWeek(today);
            if (!user.last_transfer_week || user.last_transfer_week !== currentWeek) {
                await runWeeklyTransfer(db, currentWeek);
                const refreshed = await db.prepare(`
                    SELECT daily_score, start_of_day_score, daily_score_date,
                           reward_date, historical_score, last_transfer_week
                    FROM users WHERE id = ?
                `).bind(userId).first();
                if (refreshed) Object.assign(user, refreshed);
            }
        }

        // 提取前端提交的数据
        const todayWarmup = parseInt(userData.todayWarmup) || 0;
        const todayRank = parseInt(userData.todayRank) || 0;
        const todayChallenge = parseInt(userData.todayChallenge) || 0;
        // 注：todayTotal 由前端 = todayWarmup + todayRank + todayChallenge
        // 这里直接用 todayQuizMax 替代

        const warmupDate = userData.warmupDate || '';
        const challengeUsed = parseInt(userData.challengeUsed) || 0;
        const challengeDate = userData.challengeDate || today;

        // ===== 跨天检查：保留昨日 daily_score 作为 start_of_day_score =====
        let startOfDay = user.start_of_day_score || 0;
        if (user.daily_score_date !== today) {
            // 新的一天：昨日的 daily_score 作为今日起点
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
        }

        // ===== 按日突破式 daily_score =====
        // new_daily = max(start_of_day, 今日三赛制max) + login_bonus(2)
        // 注：login_bonus 表示"今天是否已经加过登录 +2 分"，已经加过则纳入公式（防丢失）
        //     没加过则不加（save 不擅自代 login 加分，留给 login 接口加）
        const loginBonus = (user.reward_date === today) ? 2 : 0;
        const todayQuizMax = todayWarmup + todayRank + todayChallenge;
        const newDailyScore = Math.max(startOfDay, todayQuizMax) + loginBonus;

        // 写 rank_daily
        if (userData.rankDaily && userData.rankDaily.used !== undefined) {
            const used = parseInt(userData.rankDaily.used) || 0;
            await db.prepare(`
                INSERT INTO rank_daily (user_id, date, used)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id, date) DO UPDATE SET used = ?
            `).bind(userId, today, used, used).run();
        }

        // 写 daily_scores（每日各赛制最高分，用于周/月榜统计）
        await db.prepare(`
            INSERT OR REPLACE INTO daily_scores (user_id, date, warmup_score, rank_score, challenge_score)
            VALUES (?, ?, ?, ?, ?)
        `).bind(userId, today, todayWarmup, todayRank, todayChallenge).run();

        // 写 daily_score_history（记录每日的 daily_score 值，用于历史回溯）
        await db.prepare(`
            INSERT OR REPLACE INTO daily_score_history (user_id, date, daily_score)
            VALUES (?, ?, ?)
        `).bind(userId, today, newDailyScore).run();

        // 更新 users 表
        const updateFields = [
            'warmup_score = ?', 'warmup_date = ?',
            'rank_score = ?',
            'challenge_score = ?',
            'today_warmup_score = ?',
            'today_rank_score = ?',
            'today_challenge_score = ?',
            'daily_score = ?',
            'daily_score_date = ?',
            'challenge_used = ?',
            'challenge_date = ?',
            'version = version + 1',
            'updated_at = ?'
        ];
        const updateValues = [
            todayWarmup, warmupDate,
            todayRank,
            todayChallenge,
            todayWarmup, todayRank, todayChallenge,
            newDailyScore,
            today,
            challengeUsed,
            challengeDate,
            now
        ];

        // 如果 reward_date 没转（说明今天没登录过，save 是第一次），自动补登录
        if (user.reward_date !== today) {
            updateFields.push('reward_date = ?');
            updateValues.push(today);
        }

        updateFields.push('WHERE name = ?');
        updateValues.push(name);

        await db.prepare(`UPDATE users SET ${updateFields.join(', ')}`).bind(...updateValues).run();

        // 查询最新用户数据并返回
        const updatedUser = await db.prepare(`
            SELECT id, name, unit,
                   warmup_score, rank_score, challenge_score,
                   today_warmup_score, today_rank_score, today_challenge_score,
                   daily_score, daily_score_date,
                   warmup_date, challenge_date, challenge_used, version, created_at, updated_at,
                   reward_date,
                   start_of_day_score, historical_score, last_transfer_week
            FROM users WHERE name = ?
        `).bind(name).first();

        const rankDaily = await db.prepare(`
            SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
        `).bind(userId, today).first();
        const used = rankDaily ? parseInt(rankDaily.used) : 0;
        updatedUser.rank_remain = Math.max(0, 3 - used);
        updatedUser.rankDaily = { date: today, used: used };

        // 字段补齐
        if (updatedUser.historical_score === undefined) updatedUser.historical_score = 0;
        if (updatedUser.start_of_day_score === undefined) updatedUser.start_of_day_score = 0;
        updatedUser.total_score = (updatedUser.daily_score || 0) + (updatedUser.historical_score || 0);

        return new Response(JSON.stringify({
            success: true,
            user: updatedUser
        }), { headers });

    } catch (err) {
        console.error('[Save] 错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}