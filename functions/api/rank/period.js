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

        // 使用中国时区 (UTC+8) 计算本周/本月起始日期
        const now = new Date();
        // 转为北京时间 (UTC+8)
        const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
        const year = beijingTime.getUTCFullYear();
        const month = beijingTime.getUTCMonth();
        const date = beijingTime.getUTCDate();
        const day = beijingTime.getUTCDay(); // 0=周日

        let startDate;
        if (period === 'week') {
            // 周一为一周的开始 (周一=1, 周日=0 => 周日视为7)
            const diff = (day === 0 ? 7 : day) - 1; // 距离周一的天数
            const monday = new Date(Date.UTC(year, month, date - diff));
            startDate = monday.toISOString().split('T')[0];
        } else { // month
            const firstDay = new Date(Date.UTC(year, month, 1));
            startDate = firstDay.toISOString().split('T')[0];
        }

        // 检查表是否存在
        const tableCheck = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='daily_score_history'`).first();
        if (!tableCheck) {
            return new Response(JSON.stringify({
                error: '数据库表缺失',
                period: period,
                startDate: startDate,
                ranking: []
            }), { status: 500, headers });
        }

        // 关键修改：将 SUM 改为 MAX，取周期内每日积分的最高值，而非累计总和
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

        const results = rows.results || [];

        return new Response(JSON.stringify({
            period: period,
            startDate: startDate,
            ranking: results
        }), { headers });

    } catch (err) {
        console.error('period.js error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}