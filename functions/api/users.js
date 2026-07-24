// /functions/api/users.js
export async function onRequest(context) {
    const { env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    try {
        const db = env.D1_DB;

        const users = await db.prepare(`
            SELECT id, name, unit, warmup_score, rank_score, challenge_score, total_score,
                   warmup_date, challenge_date, challenge_used, version, created_at
            FROM users
            ORDER BY total_score DESC
        `).all();

        const results = users.results || [];
        const today = new Date().toDateString();

        for (const user of results) {
            const rankDaily = await db.prepare(`
                SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
            `).bind(user.id, today).first();
            user.rank_remain = rankDaily ? Math.max(0, 3 - rankDaily.used) : 3;
            user.rankDaily = rankDaily ? { date: today, used: rankDaily.used } : { date: today, used: 0 };
        }

        return new Response(JSON.stringify(results), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}