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

        // 计算本周/本月起始日期（北京时间）
        const now = new Date();
        const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        const year = beijingTime.getUTCFullYear();
        const month = beijingTime.getUTCMonth();
        const date = beijingTime.getUTCDate();
        const day = beijingTime.getUTCDay();

        let startDate;
        if (period === 'week') {
            const diff = (day === 0 ? 7 : day) - 1;
            const monday = new Date(Date.UTC(year, month, date - diff));
            startDate = monday.toISOString().split('T')[0];
        } else {
            const firstDay = new Date(Date.UTC(year, month, 1));
            startDate = firstDay.toISOString().split('T')[0];
        }

        // 检查表存在性
        const tableCheck = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='daily_score_history'`).first();
        if (!tableCheck) {
            return new Response(JSON.stringify({
                error: '数据库表缺失',
                period,
                startDate,
                ranking: []
            }), { status: 500, headers });
        }

        // 使用 MAX 取周期内单日最高积分，而非 SUM 累计
        const rows = await db.prepare(`
            SELECT 
                u.id, 
                u.name, 
                u.unit,
                COALESCE(MAX(dh.daily_score), 0) AS period_score
            FROM users u
            LEFT JOIN daily_score_history dh ON u.id = dh.user_id AND dh.date >= ?
            GROUP BY u.id, u.name, u.unit
            HAVING period_score > 0
            ORDER BY period_score DESC
        `).bind(startDate).all();

        return new Response(JSON.stringify({
            period,
            startDate,
            ranking: rows.results || []
        }), { headers });

    } catch (err) {
        console.error('period.js error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}