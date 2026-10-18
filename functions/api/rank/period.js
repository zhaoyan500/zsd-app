// /functions/api/rank/period.js
// 周榜 / 月榜
// 优先用 daily_score_history.net_score 聚合；
// 若 net_score 列不存在（v8 迁移未执行），自动降级为"相邻日差分"计算。
import { getBeijingDate } from '../_utils.js';

function getWeekRange(todayStr) {
    const [y, m, d] = todayStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay();
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

function getMonthRange(todayStr) {
    const [y, m] = todayStr.split('-').map(Number);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const endDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { startDate, endDate };
}

function jsonResp(obj, status = 200) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
        },
    });
}

export async function onRequest(context) {
    const { request, env } = context;

    try {
        const url = new URL(request.url);
        const period = (url.searchParams.get('period') || 'week').toLowerCase();
        if (period !== 'week' && period !== 'month') {
            return jsonResp({ error: 'period 参数必须为 week 或 month' }, 400);
        }

        if (!env || !env.D1_DB) {
            return jsonResp({ error: 'D1_DB 绑定缺失' }, 500);
        }
        if (typeof getBeijingDate !== 'function') {
            return jsonResp({ error: 'getBeijingDate 未从 _utils.js 正确导出' }, 500);
        }

        const db = env.D1_DB;
        const today = getBeijingDate();
        const { startDate, endDate } = period === 'week' ? getWeekRange(today) : getMonthRange(today);

        // 1. 检测 net_score 列是否存在
        let hasNetScore = false;
        try {
            const info = await db.prepare(`PRAGMA table_info(daily_score_history)`).all();
            const cols = (info.results || []).map(c => c.name);
            hasNetScore = cols.includes('net_score');
        } catch (_) {
            hasNetScore = false;
        }

        let rows;
        if (hasNetScore) {
            // 方案 B：直接 SUM(net_score)
            rows = await db.prepare(`
                SELECT
                    u.id, u.name, u.unit,
                    SUM(COALESCE(h.net_score, 0)) AS period_score,
                    COUNT(h.date) AS active_days
                FROM daily_score_history h
                JOIN users u ON u.id = h.user_id
                WHERE h.date >= ? AND h.date <= ?
                GROUP BY u.id, u.name, u.unit
                HAVING period_score > 0
                ORDER BY period_score DESC, u.name ASC
            `).bind(startDate, endDate).all();
        } else {
            // 方案 A 降级：相邻日差分
            rows = await db.prepare(`
                WITH base AS (
                    SELECT h.user_id, h.date, h.daily_score,
                           LAG(h.daily_score) OVER (
                               PARTITION BY h.user_id ORDER BY h.date
                           ) AS prev_daily_score
                    FROM daily_score_history h
                    WHERE h.date >= ? AND h.date <= ?
                ),
                with_prev AS (
                    SELECT b.user_id, b.date, b.daily_score,
                           COALESCE(
                               b.prev_daily_score,
                               (SELECT h2.daily_score FROM daily_score_history h2
                                WHERE h2.user_id = b.user_id AND h2.date < b.date
                                ORDER BY h2.date DESC LIMIT 1)
                           ) AS prev_score
                    FROM base b
                ),
                net AS (
                    SELECT user_id,
                           SUM(CASE WHEN prev_score IS NULL THEN daily_score
                                    ELSE MAX(0, daily_score - prev_score) END) AS period_score,
                           COUNT(*) AS active_days
                    FROM with_prev GROUP BY user_id
                )
                SELECT u.id, u.name, u.unit, n.period_score, n.active_days
                FROM net n JOIN users u ON u.id = n.user_id
                WHERE n.period_score > 0
                ORDER BY n.period_score DESC, u.name ASC
            `).bind(startDate, endDate).all();
        }

        const ranking = (rows.results || []).map((r, idx) => ({
            rank: idx + 1,
            name: r.name,
            unit: r.unit || '未分配',
            period_score: Number(r.period_score) || 0,
            active_days: Number(r.active_days) || 0,
        }));

        return jsonResp({
            success: true,
            period,
            startDate,
            endDate,
            mode: hasNetScore ? 'net_score' : 'diff_fallback',
            updatedAt: new Date().toISOString(),
            ranking,
        });

    } catch (err) {
        console.error('[RankPeriod] 错误:', err);
        return jsonResp({ error: err.message || String(err), stack: err.stack || '' }, 500);
    }
}