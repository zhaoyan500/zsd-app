// /functions/api/save.js
// 降级接口：仅用于同步非分数字段（如日期），分数一律走 /submit-score
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

        const user = await db.prepare(`
            SELECT id, name, unit,
                   warmup_score, rank_score, challenge_score,
                   today_warmup_score, today_rank_score, today_challenge_score,
                   daily_score, daily_score_date,
                   reward_date, start_of_day_score, historical_score, last_transfer_week,
                   challenge_date, challenge_used, version
            FROM users WHERE name = ?
        `).bind(name).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        const userId = user.id;

        // ===== 周转移（lazy）=====
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

        // ===== 跨天检查 =====
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

        // ===== 仅允许同步日期字段（不接收分数）=====
        const warmupDate = userData.warmupDate || user.warmup_date || '';
        const challengeDate = userData.challengeDate || user.challenge_date || today;

        await db.prepare(`
            UPDATE users SET
                warmup_date = ?,
                challenge_date = ?,
                version = version + 1,
                updated_at = ?
            WHERE id = ?
        `).bind(warmupDate, challengeDate, now, userId).run();

        // ===== 返回最新完整用户数据 =====
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
            user: updated
        }), { headers });

    } catch (err) {
        console.error('[Save] 错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}