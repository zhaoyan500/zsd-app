// /functions/api/rank/period.js
import { getBeijingDate } from '../_utils.js';

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

        const today = getBeijingDate(); // 北京时间日期

        if (period === 'week') {
            // 周榜：本周一（北京时间）至今
            const weekStart = getWeekStart(today); // 本周一的日期
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
                ranking: results
            }), { headers });
        }

        // ===== 月榜：最近4个有答题行为的周（按赛制最高分） =====
        // 查询近一年的数据（避免全表扫描）
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const startDateLimit = oneYearAgo.toISOString().split('T')[0]; // 使用 UTC 日期作为下限，不影响比较

        const historyResult = await db.prepare(`
            SELECT user_id, date, warmup_score, rank_score, challenge_score 
            FROM daily_scores 
            WHERE date >= ?
        `).bind(startDateLimit).all();
        const historyRows = historyResult.results || [];

        const usersResult = await db.prepare(`SELECT id, name, unit FROM users`).all();
        const users = usersResult.results || [];
        const userInfo = {};
        for (const u of users) {
            userInfo[u.id] = { name: u.name, unit: u.unit };
        }

        const userMap = {};
        for (const row of historyRows) {
            const userId = row.user_id;
            if (!userMap[userId]) userMap[userId] = [];
            userMap[userId].push({
                date: row.date,
                warmup: row.warmup_score || 0,
                rank: row.rank_score || 0,
                challenge: row.challenge_score || 0
            });
        }

        const ranking = [];
        for (const userId in userMap) {
            const records = userMap[userId];
            records.sort((a, b) => a.date.localeCompare(b.date));

            // 按周汇总（基于北京时间）
            const weekMap = {};
            for (const rec of records) {
                const weekStart = getWeekStart(rec.date);
                if (!weekMap[weekStart]) {
                    weekMap[weekStart] = { warmup: 0, rank: 0, challenge: 0 };
                }
                weekMap[weekStart].warmup = Math.max(weekMap[weekStart].warmup, rec.warmup);
                weekMap[weekStart].rank = Math.max(weekMap[weekStart].rank, rec.rank);
                weekMap[weekStart].challenge = Math.max(weekMap[weekStart].challenge, rec.challenge);
            }

            const weekScores = {};
            for (const w in weekMap) {
                weekScores[w] = weekMap[w].warmup + weekMap[w].rank + weekMap[w].challenge;
            }

            // 取最近4个有积分的周
            const weeksWithScore = Object.keys(weekScores)
                .filter(w => weekScores[w] > 0)
                .sort((a, b) => b.localeCompare(a));
            const recentWeeks = weeksWithScore.slice(0, 4);

            let total = 0;
            for (const w of recentWeeks) {
                total += weekScores[w];
            }

            if (total > 0) {
                const info = userInfo[userId];
                if (info) {
                    ranking.push({
                        id: userId,
                        name: info.name,
                        unit: info.unit || '',
                        period_score: total
                    });
                }
            }
        }

        ranking.sort((a, b) => b.period_score - a.period_score);

        return new Response(JSON.stringify({
            period: 'month',
            startDate: startDateLimit,
            ranking: ranking
        }), { headers });

    } catch (err) {
        console.error('period 接口错误:', err);
        return new Response(JSON.stringify({
            error: err.message,
            stack: err.stack
        }), { status: 500, headers });
    }
}

// 获取给定日期所在周的周一日期（基于北京时间）
function getWeekStart(dateStr) {
    // dateStr 格式为 YYYY-MM-DD，视为北京时间日期
    const parts = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1]-1, parts[2])); // 构建 UTC 时间，保证后续计算正确
    // 获取星期几（UTC），因为日期字符串是 UTC 0 点，但代表北京时间当天，星期几与北京时间一致
    const day = d.getUTCDay(); // 0=周日
    const diff = (day === 0 ? 7 : day) - 1; // 周一为0
    const monday = new Date(Date.UTC(parts[0], parts[1]-1, parts[2] - diff));
    return monday.toISOString().split('T')[0];
}