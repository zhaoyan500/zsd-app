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
            const day = now.getUTCDay(); // 0=周日
            const diff = (day === 0 ? 7 : day) - 1; // 周一为0
            const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
            startDate = monday.toISOString().split('T')[0];
        } else { // month
            startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().split('T')[0];
        }

        // 仅从 daily_score_history 汇总，确保准确
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
            period: period,
            startDate: startDate,
            ranking: results
        }), { headers });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}