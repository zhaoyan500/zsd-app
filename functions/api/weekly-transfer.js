// /functions/api/weekly-transfer.js
// 周日 24:00 (北京时间) 周转存接口
// 把每个用户的 daily_score 加到 historical_score，并清零
// 用 last_transfer_week 防重复转存
// 可由 cron-job.org / Cloudflare Cron Triggers / 任意定时器调用
import { getBeijingDate, getISOWeek, runWeeklyTransfer } from './_utils.js';

export async function onRequest(context) {
    const { request, env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    try {
        // 接受 GET（外部 cron 调用）和 POST（手动触发）
        if (request.method === 'POST') {
            // POST 走手动触发，无需鉴权（仅管理员调用）
        } else if (request.method !== 'GET') {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
        }

        const db = env.D1_DB;
        const today = getBeijingDate();
        const currentWeek = getISOWeek(today);

        // 干跑（dry run）：先查会转存多少
        const dryRun = await db.prepare(`
            SELECT COUNT(*) as cnt,
                   COALESCE(SUM(COALESCE(daily_score, 0)), 0) as total_to_transfer
            FROM users
            WHERE COALESCE(last_transfer_week, '') != ?
              AND COALESCE(last_transfer_week, '') < ?
              AND COALESCE(daily_score, 0) > 0
        `).bind(currentWeek, currentWeek).first();

        // 执行转存
        await runWeeklyTransfer(db, currentWeek);

        // 转存后查实况
        const result = await db.prepare(`
            SELECT
                COUNT(*) as users_total,
                SUM(CASE WHEN COALESCE(historical_score, 0) > 0 THEN 1 ELSE 0 END) as users_with_history,
                SUM(COALESCE(historical_score, 0)) as total_historical,
                SUM(COALESCE(daily_score, 0)) as total_daily
            FROM users
        `).first();

        return new Response(JSON.stringify({
            success: true,
            week: currentWeek,
            transferred: {
                users: dryRun?.cnt || 0,
                total: dryRun?.total_to_transfer || 0
            },
            after: result
        }), { headers });
    } catch (err) {
        console.error('[WeeklyTransfer] 错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}