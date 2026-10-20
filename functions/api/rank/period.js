// /functions/api/rank/period.js
// 周榜 / 月榜：按 daily_scores 各赛制当日最高分累计
// 口径：period_score = Σ(区间内每日 warmup_score + rank_score + challenge_score)
// 说明：热身赛、排位赛、挑战赛均计入；同一天同一赛制只计当日最高分（由 submit-score 的 INSERT OR REPLACE 保证）
import { getBeijingDate } from '../_utils.js';

/**
 * 计算某日期所在 ISO 周的周一和周日（YYYY-MM-DD）
 */
function getWeekRange(todayStr) {
    const [y, m, d] = todayStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const dow = dt.getUTCDay(); // 0=周日, 1=周一...
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
 * 计算某日期所在自然月的月初和月末（YYYY-MM-DD）
 */
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

        // 检查 daily_scores 表是否存在，避免 no such table 直接 500
        let hasDailyScores = false;
        try {
            const t = await db.prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name='daily_scores'`
            ).first();
            hasDailyScores = !!t;
        } catch (_) {
            hasDailyScores = false;
        }

        if (!hasDailyScores) {
            return jsonResp({
                success: true,
                period,
                startDate,
                endDate,
                mode: 'daily_scores_sum',
                warning: 'daily_scores 表不存在，暂无周/月榜数据',
                updatedAt: new Date().toISOString(),
                ranking: [],
            });
        }

        // 按用户聚合区间内 daily_scores 三赛制最高分
        const rows = await db.prepare(`
            SELECT
                u.id,
                u.name,
                u.unit,
                SUM(COALESCE(d.warmup_score, 0))    AS warmup_total,
                SUM(COALESCE(d.rank_score, 0))      AS rank_total,
                SUM(COALESCE(d.challenge_score, 0)) AS challenge_total,
                SUM(
                    COALESCE(d.warmup_score, 0)
                  + COALESCE(d.rank_score, 0)
                  + COALESCE(d.challenge_score, 0)
                ) AS period_score,
                COUNT(d.date) AS active_days
            FROM daily_scores d
            JOIN users u ON u.id = d.user_id
            WHERE d.date >= ? AND d.date <= ?
            GROUP BY u.id, u.name, u.unit
            HAVING period_score > 0
            ORDER BY period_score DESC, u.name ASC
        `).bind(startDate, endDate).all();

        const ranking = (rows.results || []).map((r, idx) => ({
            rank: idx + 1,
            name: r.name,
            unit: r.unit || '未分配',
            period_score: Number(r.period_score) || 0,
            warmup_total: Number(r.warmup_total) || 0,
            rank_total: Number(r.rank_total) || 0,
            challenge_total: Number(r.challenge_total) || 0,
            active_days: Number(r.active_days) || 0,
        }));

        return jsonResp({
            success: true,
            period,
            startDate,
            endDate,
            mode: 'daily_scores_sum',
            updatedAt: new Date().toISOString(),
            ranking,
        });

    } catch (err) {
        console.error('[RankPeriod] 错误:', err);
        return jsonResp({ error: err.message || String(err), stack: err.stack || '' }, 500);
    }
}