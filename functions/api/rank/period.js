// /functions/api/rank/period.js
// 周榜 / 月榜：按"当日净增分"(net_score) 聚合
// 口径：period_score = Σ(区间内每日 net_score)
// net_score 由 submit-score.js / login.js 在写入 daily_score_history 时计算：
//   net_score = max(0, 当天最终 daily_score - 当天 start_of_day_score)
import { getBeijingDate } from '../_utils.js';

/**
 * 计算某日期所在 ISO 周的周一和周日（北京时间日期字符串 YYYY-MM-DD）
 * ISO 周：周一为一周第一天，周日为最后一天
 */
function getWeekRange(todayStr) {
    const [y, m, d] = todayStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay(); // 0=周日, 1=周一, ..., 6=周六
    const diffToMonday = (dow === 0 ? -6 : 1 - dow);
    const monday = new Date(dt);
    monday.setUTCDate(dt.getUTCDate() + diffToMonday);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return {
        startDate: monday.toISOString().split('T')[0],
        endDate: sunday.toISOString().split('T')[0],
    };
}

/**
 * 计算某日期所在自然月的月初和月末
 */
function getMonthRange(todayStr) {
    const [y, m] = todayStr.split('-').map(Number);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m 月 0 日 = 上月末
    const endDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { startDate, endDate };
}

export async function onRequest(context) {
    const { request, env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    try {
        const url = new URL(request.url);
        const period = (url.searchParams.get('period') || 'week').toLowerCase();
        if (period !== 'week' && period !== 'month') {
            return new Response(JSON.stringify({ error: 'period 参数必须为 week 或 month' }), {
                status: 400, headers,
            });
        }

        const db = env.D1_DB;
        const today = getBeijingDate(); // 北京时间 YYYY-MM-DD

        const range = period === 'week' ? getWeekRange(today) : getMonthRange(today);
        const { startDate, endDate } = range;

        // 按用户聚合区间内净增分
        // COALESCE 兜底：net_score 为 NULL 的老数据视为 0（v8 迁移已回填近似值）
        const rows = await db.prepare(`
            SELECT
                u.id,
                u.name,
                u.unit,
                SUM(COALESCE(h.net_score, 0)) AS period_score,
                COUNT(h.date)                 AS active_days
            FROM daily_score_history h
            JOIN users u ON u.id = h.user_id
            WHERE h.date >= ? AND h.date <= ?
            GROUP BY u.id, u.name, u.unit
            HAVING period_score > 0
            ORDER BY period_score DESC, u.name ASC
        `).bind(startDate, endDate).all();

        const ranking = (rows.results || []).map((r, idx) => ({
            rank: idx + 1,
            name: r.name,
            unit: r.unit || '未分配',
            period_score: Number(r.period_score) || 0,
            active_days: Number(r.active_days) || 0,
        }));

        return new Response(JSON.stringify({
            success: true,
            period,
            startDate,
            endDate,
            updatedAt: new Date().toISOString(),
            ranking,
        }), { headers });

    } catch (err) {
        console.error('[RankPeriod] 错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}