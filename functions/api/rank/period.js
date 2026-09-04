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

        const today = getBeijingDate();

        if (period === 'week') {
            const weekStart = getWeekStart(today);
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

        // 月榜：最近4个有答题行为的周
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        const startDateLimit = oneYearAgo.toISOString().split('T')[0];

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

function getWeekStart(dateStr) {
    const parts = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1]-1, parts[2]));
    const day = d.getUTCDay();
    const diff = (day === 0 ? 7 : day) - 1;
    const monday = new Date(Date.UTC(parts[0], parts[1]-1, parts[2] - diff));
    return monday.toISOString().split('T')[0];
}