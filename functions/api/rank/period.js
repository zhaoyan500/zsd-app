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

        const now = new Date();
        let startDate;
        if (period === 'week') {
            const day = now.getUTCDay();
            const diff = (day === 0 ? 7 : day) - 1;
            const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff));
            startDate = monday.toISOString().split('T')[0];
        } else {
            startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().split('T')[0];
        }

        // 先检查 daily_score_history 表是否存在
        const tableCheck = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='daily_score_history'`).first();
        if (!tableCheck) {
            console.error('❌ daily_score_history 表不存在！请执行迁移SQL。');
            return new Response(JSON.stringify({
                error: '数据库表缺失，请联系管理员',
                period: period,
                startDate: startDate,
                ranking: []
            }), { status: 500, headers });
        }

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
        console.log(`✅ 周/月榜查询成功，周期起始 ${startDate}，共 ${results.length} 条记录`);

        return new Response(JSON.stringify({
            period: period,
            startDate: startDate,
            ranking: results
        }), { headers });

    } catch (err) {
        console.error('❌ period.js 错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}