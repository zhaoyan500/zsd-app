// /functions/api/login.js
import { verifyPassword, hashPassword, generateSalt, getBeijingDate, getISOWeek, runWeeklyTransfer } from './_utils.js';

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
        const { name, pwd } = body;

        if (!name || !pwd) {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        const db = env.D1_DB;
        const today = getBeijingDate();

        let user;
        let hasNewFields = false;
        try {
            user = await db.prepare(`
                SELECT id, name, unit, pwd,
                       warmup_score, rank_score, challenge_score,
                       today_warmup_score, today_rank_score, today_challenge_score,
                       daily_score, daily_score_date,
                       warmup_date, challenge_date, challenge_used, version, created_at,
                       reward_date,
                       start_of_day_score, historical_score, last_transfer_week
                FROM users WHERE name = ?
            `).bind(name).first();
            if (user && user.historical_score !== undefined) hasNewFields = true;
        } catch (err) {
            if (err.message && err.message.includes('no such column')) {
                console.warn('[Login] 新字段不存在，降级处理');
                user = await db.prepare(`
                    SELECT id, name, unit, pwd,
                           warmup_score, rank_score, challenge_score,
                           today_warmup_score, today_rank_score, today_challenge_score,
                           daily_score, daily_score_date,
                           warmup_date, challenge_date, challenge_used, version, created_at
                    FROM users WHERE name = ?
                `).bind(name).first();
            } else {
                throw err;
            }
        }

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        // 验证密码
        const isValid = await verifyPassword(pwd, user.pwd);
        if (!isValid) {
            if (!user.pwd.includes(':')) {
                if (user.pwd === pwd) {
                    const salt = generateSalt();
                    const newHash = await hashPassword(pwd, salt);
                    const storedPwd = `${salt}:${newHash}`;
                    await db.prepare(`UPDATE users SET pwd = ? WHERE id = ?`).bind(storedPwd, user.id).run();
                } else {
                    return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
                }
            } else {
                return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
            }
        }

        // ===== 周转移检查（lazy）=====
        if (hasNewFields) {
            const currentWeek = getISOWeek(today);
            if (!user.last_transfer_week || user.last_transfer_week !== currentWeek) {
                await runWeeklyTransfer(db, currentWeek);
                const refreshed = await db.prepare(`
                    SELECT id, daily_score, start_of_day_score, daily_score_date,
                           reward_date, historical_score, last_transfer_week,
                           today_warmup_score, today_rank_score, today_challenge_score,
                           warmup_score, rank_score, challenge_score
                    FROM users WHERE id = ?
                `).bind(user.id).first();
                if (refreshed) Object.assign(user, refreshed);
            }
        }

        // ===== 每日跨天检查 =====
        if (user.daily_score_date !== today) {
            user.start_of_day_score = user.daily_score || 0;
            user.daily_score_date = today;
            user.today_warmup_score = 0;
            user.today_rank_score = 0;
            user.today_challenge_score = 0;
            if (hasNewFields) {
                await db.prepare(`
                    UPDATE users SET
                        start_of_day_score = ?,
                        daily_score_date = ?,
                        today_warmup_score = 0,
                        today_rank_score = 0,
                        today_challenge_score = 0
                    WHERE id = ?
                `).bind(user.start_of_day_score, today, user.id).run();
            } else {
                await db.prepare(`
                    UPDATE users SET
                        daily_score_date = ?,
                        today_warmup_score = 0,
                        today_rank_score = 0,
                        today_challenge_score = 0
                    WHERE id = ?
                `).bind(today, user.id).run();
            }
        }

        if (user.challenge_date !== today) {
            user.challenge_used = 0;
            user.challenge_date = today;
            await db.prepare(`
                UPDATE users SET
                    challenge_used = 0,
                    challenge_date = ?
                WHERE id = ?
            `).bind(today, user.id).run();
        }

        // ===== 每日登录奖励（按日突破式）=====
        // ✅ 修复：不再用 startOfDay + 2 直接覆盖，而是取 max(startOfDay, daily_score) + 2
        // 避免"先答题后登录"时把答题分覆盖掉
        if (user.reward_date !== today) {
            const startOfDay = user.start_of_day_score || 0;
            const currentDaily = user.daily_score || 0;
            const newDailyScore = Math.max(startOfDay, currentDaily) + 2;
            await db.prepare(`
                UPDATE users SET
                    daily_score = ?,
                    reward_date = ?,
                    version = version + 1
                WHERE id = ?
            `).bind(newDailyScore, today, user.id).run();
            user.daily_score = newDailyScore;
            user.reward_date = today;

            // 登录奖励同步写入 daily_score_history（含 net_score）
            // 否则"只登录不答题"的用户当天没有 history 记录，周/月榜会漏算登录奖励
            const netScore = Math.max(0, newDailyScore - startOfDay);
            await db.prepare(`
                INSERT INTO daily_score_history (user_id, date, daily_score, net_score)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, date) DO UPDATE SET
                    daily_score = excluded.daily_score,
                    net_score = excluded.net_score
            `).bind(user.id, today, newDailyScore, netScore).run();
        }

        // 排位赛今日记录
        let rankDaily = await db.prepare(`
            SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
        `).bind(user.id, today).first();
        if (!rankDaily) {
            await db.prepare(`
                INSERT INTO rank_daily (user_id, date, used) VALUES (?, ?, 0)
            `).bind(user.id, today).run();
            rankDaily = { used: 0 };
        }
        const used = rankDaily.used || 0;
        user.rank_remain = Math.max(0, 3 - used);
        user.rankDaily = { date: today, used: used };

        // 字段补齐
        if (user.historical_score === undefined) user.historical_score = 0;
        if (user.start_of_day_score === undefined) user.start_of_day_score = 0;
        if (user.today_warmup_score === undefined) user.today_warmup_score = 0;
        if (user.today_rank_score === undefined) user.today_rank_score = 0;
        if (user.today_challenge_score === undefined) user.today_challenge_score = 0;
        if (user.daily_score === undefined) user.daily_score = 0;

        // 后端权威 total_score
        user.total_score = (user.daily_score || 0) + (user.historical_score || 0);

        delete user.pwd;
        return new Response(JSON.stringify({ success: true, user: user }), { headers });
    } catch (err) {
        console.error('[Login] 错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}