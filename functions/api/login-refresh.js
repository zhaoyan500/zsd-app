// /functions/api/login-refresh.js
// 仅根据姓名刷新用户数据（用于前端定时同步）
// ⚠️ 生产环境建议加签名/token 校验
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
        const { name } = body;
        if (!name) {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        const db = env.D1_DB;
        const today = getBeijingDate();

        let user = await db.prepare(`
            SELECT id, name, unit,
                   warmup_score, rank_score, challenge_score,
                   today_warmup_score, today_rank_score, today_challenge_score,
                   daily_score, daily_score_date,
                   warmup_date, challenge_date, challenge_used, version, created_at,
                   reward_date, start_of_day_score, historical_score, last_transfer_week
            FROM users WHERE name = ?
        `).bind(name).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        // ===== 周转移检查 =====
        const currentWeek = getISOWeek(today);
        if (!user.last_transfer_week || user.last_transfer_week !== currentWeek) {
            await runWeeklyTransfer(db, currentWeek);
            const refreshed = await db.prepare(`
                SELECT daily_score, start_of_day_score, daily_score_date,
                       reward_date, historical_score, last_transfer_week,
                       today_warmup_score, today_rank_score, today_challenge_score,
                       warmup_score, rank_score, challenge_score,
                       challenge_date, challenge_used
                FROM users WHERE id = ?
            `).bind(user.id).first();
            if (refreshed) Object.assign(user, refreshed);
        }

        // ===== 每日跨天检查 =====
        if (user.daily_score_date !== today) {
            user.start_of_day_score = user.daily_score || 0;
            user.daily_score_date = today;
            user.today_warmup_score = 0;
            user.today_rank_score = 0;
            user.today_challenge_score = 0;
            await db.prepare(`
                UPDATE users SET
                    start_of_day_score = ?,
                    daily_score_date = ?,
                    today_warmup_score = 0,
                    today_rank_score = 0,
                    today_challenge_score = 0
                WHERE id = ?
            `).bind(user.start_of_day_score, today, user.id).run();
        }

        if (user.challenge_date !== today) {
            user.challenge_used = 0;
            user.challenge_date = today;
            await db.prepare(`
                UPDATE users SET challenge_used = 0, challenge_date = ? WHERE id = ?
            `).bind(today, user.id).run();
        }

        // 排位今日记录
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

        // 字段兜底
        if (user.historical_score === undefined) user.historical_score = 0;
        if (user.start_of_day_score === undefined) user.start_of_day_score = 0;
        if (user.daily_score === undefined) user.daily_score = 0;
        if (user.today_warmup_score === undefined) user.today_warmup_score = 0;
        if (user.today_rank_score === undefined) user.today_rank_score = 0;
        if (user.today_challenge_score === undefined) user.today_challenge_score = 0;

        user.total_score = (user.daily_score || 0) + (user.historical_score || 0);

        return new Response(JSON.stringify({ success: true, user: user }), { headers });
    } catch (err) {
        console.error('[LoginRefresh] 错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}