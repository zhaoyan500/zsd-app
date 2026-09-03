// /functions/api/rank/period.js
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

        if (period === 'week') {
            // ===== 周榜：原逻辑，本周一至今的 daily_score 累计 =====
            const now = new Date();
            const day = now.getUTCDay();
            const diff = (day === 0 ? 7 : day) - 1;
            const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
            const startDate = monday.toISOString().split('T')[0];

            const rows = await db.prepare(`
                SELECT 
                    u.id, 
                    u.name, 
                    u.unit,
                    COALESCE(SUM(dh.daily_score), 0) AS period_score
                FROM users u
                LEFT JOIN daily_score_history dh ON u.id = dh.user_id AND dh.date >= ?
                GROUP BY u.id, u.name, u.unit
                HAVING period_score > 0
                ORDER BY period_score DESC
            `).bind(startDate).all();

            const results = rows.results || [];
            return new Response(JSON.stringify({
                period: 'week',
                startDate: startDate,
                ranking: results
            }), { headers });
        }

        // ===== 月榜：最近4个有答题行为的周积分总和 =====
        // 1. 获取所有每日记录
        const allHistory = await db.prepare(`
            SELECT user_id, date, daily_score FROM daily_score_history
        `).all();
        const historyRows = allHistory.results || [];

        // 2. 获取用户信息
        const users = await db.prepare(`SELECT id, name, unit FROM users`).all();
        const userInfo = {};
        for (const u of users.results || []) {
            userInfo[u.id] = { name: u.name, unit: u.unit };
        }

        // 3. 按用户分组，计算最近4个活跃周
        const userMap = {};
        for (const row of historyRows) {
            const userId = row.user_id;
            if (!userMap[userId]) userMap[userId] = [];
            userMap[userId].push({ date: row.date, score: row.daily_score });
        }

        const ranking = [];
        for (const userId in userMap) {
            const records = userMap[userId];
            // 按日期升序
            records.sort((a, b) => a.date.localeCompare(b.date));

            // 按周汇总
            const weekMap = {};
            for (const rec of records) {
                const weekStart = getWeekStart(rec.date);
                if (!weekMap[weekStart]) weekMap[weekStart] = 0;
                weekMap[weekStart] += rec.score;
            }

            // 取最近的4个活跃周（按周起始日期降序）
            const weeks = Object.keys(weekMap).sort((a, b) => b.localeCompare(a));
            const recentWeeks = weeks.slice(0, 4);

            let total = 0;
            for (const w of recentWeeks) {
                total += weekMap[w];
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
            ranking: ranking
        }), { headers });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}

// 辅助：获取日期所在周的周一日期（UTC）
function getWeekStart(dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const day = d.getUTCDay();
    const diff = (day === 0 ? 7 : day) - 1;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
    return monday.toISOString().split('T')[0];
}