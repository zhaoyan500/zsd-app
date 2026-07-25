// /functions/api/rank/period.js
export async function onRequest(context) {
    const { request, env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    try {
        const url = new URL(request.url);
        const period = url.searchParams.get('period') || 'week'; // 'week' or 'month'
        const db = env.D1_DB;

        // 计算周期起始日期（UTC）
        const now = new Date();
        let startDate;
        if (period === 'week') {
            // 本周一（UTC）
            const day = now.getUTCDay(); // 0=周日
            const diff = (day === 0 ? 7 : day) - 1; // 周一为0
            const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
            startDate = monday.toISOString().split('T')[0];
        } else { // month
            startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().split('T')[0];
        }

        // 查询每个用户在周期内的每日积分总和
        const rows = await db.prepare(`
            SELECT 
                u.id, u.name, u.unit,
                COALESCE(SUM(h.daily_score), 0) as period_score
            FROM users u
            LEFT JOIN daily_score_history h ON u.id = h.user_id AND h.date >= ?
            GROUP BY u.id
            ORDER BY period_score DESC
        `).bind(startDate).all();

        const results = rows.results || [];
        return new Response(JSON.stringify({
            period: period,
            startDate: startDate,
            ranking: results
        }), { headers });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}