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

        // 优先从 daily_score_history 汇总（包含所有模式），若用户无记录则从 quiz_history 回退（仅排位+挑战）
        const rows = await db.prepare(`
            SELECT 
                u.id, 
                u.name, 
                u.unit,
                COALESCE(
                    (SELECT SUM(dh.daily_score) FROM daily_score_history dh WHERE dh.user_id = u.id AND dh.date >= ?),
                    (SELECT SUM(qh.score) FROM quiz_history qh WHERE qh.user_id = u.id AND qh.date >= ? AND qh.mode IN ('ranked', 'challenge'))
                ) AS period_score
            FROM users u
            WHERE u.id IN (
                SELECT DISTINCT user_id FROM daily_score_history WHERE date >= ?
                UNION
                SELECT DISTINCT user_id FROM quiz_history WHERE date >= ? AND mode IN ('ranked', 'challenge')
            )
            ORDER BY period_score DESC
        `).bind(startDate, startDate, startDate, startDate).all();

        const results = rows.results || [];
        const filtered = results.filter(r => r.period_score !== null && r.period_score > 0);

        return new Response(JSON.stringify({
            period: period,
            startDate: startDate,
            ranking: filtered
        }), { headers });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}