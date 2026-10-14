// /functions/api/rank/team.js
import { getBeijingDate } from '../_utils.js';

export async function onRequest(context) {
    const { env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    try {
        const db = env.D1_DB;
        const rows = await db.prepare(`
            SELECT
                unit,
                COUNT(*) AS member_count,
                SUM(COALESCE(historical_score, 0) + COALESCE(daily_score, 0)) AS total_score,
                SUM(COALESCE(historical_score, 0)) AS total_historical,
                SUM(COALESCE(daily_score, 0)) AS total_daily
            FROM users
            GROUP BY unit
            ORDER BY total_score DESC
        `).all();

        return new Response(JSON.stringify({
            success: true,
            teams: rows.results || []
        }), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}