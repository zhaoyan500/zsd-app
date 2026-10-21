// /functions/api/rank/period.js
// 周榜 / 月榜：按 daily_score_history.net_score 聚合（与 daily_score 体系一致）
// 口径：period_score = Σ(区间内每日净增分 net_score)，含登录奖励
// 明细：warmup_total / rank_total / challenge_total 从 daily_scores 区间汇总，仅展示
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

/**
 * 检查表是否存在
 */
async function tableExists(db, tableName) {
    try {
        const t = await db.prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
        ).bind(tableName).first();
        return !!t;
    } catch (_) {
        return false;
    }
}

/**
 * 检查某列是否存在
 */
async function columnExists(db, tableName, columnName) {
    try {
        const cols = await db.prepare(`PRAGMA table_info(${tableName})`).all();
        return (cols.results || []).some(c => c.name === columnName);
    } catch (_) {
        return false;
    }
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

        // ===== 前置检查：daily_score_history 表与 net_score 列 =====
        const hasHistory = await tableExists(db, 'daily_score_history');
        if (!hasHistory) {
            return jsonResp({
                success: true,
                period,
                startDate,
                endDate,
                mode: 'net_score_sum',
                warning: 'daily_score_history 表不存在，暂无周/月榜数据',
                updatedAt: new Date().toISOString(),
                ranking: [],
            });
        }
        const hasNetScore = await columnExists(db, 'daily_score_history', 'net_score');
        if (!hasNetScore) {
            return jsonResp({
                success: true,
                period,
                startDate,
                endDate,
                mode: 'net_score_sum',
                warning: 'daily_score_history.net_score 列不存在，请执行迁移 v8',
                updatedAt: new Date().toISOString(),
                ranking: [],
            });
        }

        // ===== 主聚合：以 daily_score_history 为准 =====
        // 三赛制明细通过关联 daily_scores 取得（若表存在），否则为 0
        const hasDailyScores = await tableExists(db, 'daily_scores');

        let rows;
        if (hasDailyScores) {
            rows = await db.prepare(`
                SELECT
                    u.id,
                    u.name,
                    u.unit,
                    SUM(COALESCE(h.net_score, 0)) AS period_score,
                    COUNT(DISTINCT h.date)        AS active_days,
                    SUM(COALESCE(ds.warmup_score, 0))    AS warmup_total,
                    SUM(COALESCE(ds.rank_score, 0))      AS rank_total,
                    SUM(COALESCE(ds.challenge_score, 0)) AS challenge_total
                FROM daily_score_history h
                JOIN users u ON u.id = h.user_id
                LEFT JOIN daily_scores ds
                       ON ds.user_id = h.user_id AND ds.date = h.date
                WHERE h.date >= ? AND h.date <= ?
                GROUP BY u.id, u.name, u.unit
                HAVING period_score > 0
                ORDER BY period_score DESC, u.name ASC
            `).bind(startDate, endDate).all();
        } else {
            // 无 daily_scores 表时，明细全部置 0
            rows = await db.prepare(`
                SELECT
                    u.id,
                    u.name,
                    u.unit,
                    SUM(COALESCE(h.net_score, 0)) AS period_score,
                    COUNT(DISTINCT h.date)        AS active_days,
                    0 AS warmup_total,
                    0 AS rank_total,
                    0 AS challenge_total
                FROM daily_score_history h
                JOIN users u ON u.id = h.user_id
                WHERE h.date >= ? AND h.date <= ?
                GROUP BY u.id, u.name, u.unit
                HAVING period_score > 0
                ORDER BY period_score DESC, u.name ASC
            `).bind(startDate, endDate).all();
        }

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
            mode: 'net_score_sum',
            updatedAt: new Date().toISOString(),
            ranking,
        });

    } catch (err) {
        console.error('[RankPeriod] 错误:', err);
        return jsonResp({ error: err.message || String(err), stack: err.stack || '' }, 500);
    }
}