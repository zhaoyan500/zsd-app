// /functions/api/rank/period.js
import { getBeijingDate, getBeijingWeekStart, getBeijingMonthStart, getBeijingMonthEnd } from '../_utils.js';

export async function onRequest(context) {
    const { request, env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    try {
        const url = new URL(request.url);
        const period = url.searchParams.get('period') || 'week';
        const db = env.D1_DB;

        const today = getBeijingDate();

        if (period === 'week') {
            // 周榜：本自然周（周一到周日）每日高分之和
            const weekStart = getBeijingWeekStart(today);
            const rows = await db.prepare(`
                SELECT
                    u.id,
                    u.name,
                    u.unit,
                    COALESCE(MAX(ds.warmup_score), 0) AS warmup_max,
                    COALESCE(MAX(ds.rank_score), 0) AS rank_max,
                    COALESCE(MAX(ds.challenge_score), 0) AS challenge_max,
                    (COALESCE(MAX(ds.warmup_score), 0) +
                     COALESCE(MAX(ds.rank_score), 0) +
                     COALESCE(MAX(ds.challenge_score), 0)) AS period_score
                FROM users u
                LEFT JOIN daily_scores ds ON u.id = ds.user_id AND ds.date >= ?
                GROUP BY u.id, u.name, u.unit
                HAVING period_score > 0
                ORDER BY period_score DESC
            `).bind(weekStart).all();

            const results = rows.results || [];
            return new Response(JSON.stringify({
                period: 'week',
                startDate: weekStart,
                endDate: today,
                ranking: results
            }), { headers });
        }

        if (period === 'month') {
            // 月榜：本自然月（1 号到月底）每日高分之和
            const monthStart = getBeijingMonthStart(today);
            const monthEnd = getBeijingMonthEnd(today);
            const rows = await db.prepare(`
                SELECT
                    u.id,
                    u.name,
                    u.unit,
                    COALESCE(MAX(ds.warmup_score), 0) AS warmup_max,
                    COALESCE(MAX(ds.rank_score), 0) AS rank_max,
                    COALESCE(MAX(ds.challenge_score), 0) AS challenge_max,
                    (COALESCE(MAX(ds.warmup_score), 0) +
                     COALESCE(MAX(ds.rank_score), 0) +
                     COALESCE(MAX(ds.challenge_score), 0)) AS period_score
                FROM users u
                LEFT JOIN daily_scores ds ON u.id = ds.user_id
                    AND ds.date >= ? AND ds.date <= ?
                GROUP BY u.id, u.name, u.unit
                HAVING period_score > 0
                ORDER BY period_score DESC
            `).bind(monthStart, monthEnd).all();

            const results = rows.results || [];
            return new Response(JSON.stringify({
                period: 'month',
                startDate: monthStart,
                endDate: monthEnd,
                ranking: results
            }), { headers });
        }

        // 兼容旧版字段：兜底返回错误
        return new Response(JSON.stringify({
            error: 'period 参数必须是 week 或 month'
        }), { status: 400, headers });

    } catch (err) {
        console.error('period 接口错误:', err);
        return new Response(JSON.stringify({
            error: err.message,
            stack: err.stack
        }), { status: 500, headers });
    }
}