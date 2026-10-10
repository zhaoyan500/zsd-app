// /functions/api/clear-all.js
export async function onRequest(context) {
    const { request, env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
    }

    try {
        const body = await request.json();
        const { adminKey } = body;

        if (adminKey !== 'zsdcr123') {
            return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
        }

        const db = env.D1_DB;

        // 使用事务保证原子性
        const statements = [
            db.prepare('DELETE FROM quiz_history'),
            db.prepare('DELETE FROM rank_daily'),
            db.prepare('DELETE FROM daily_scores'),
            db.prepare('DELETE FROM daily_score_history'),
            db.prepare(`UPDATE users SET
                daily_score = 0,
                start_of_day_score = 0,
                historical_score = 0,
                last_transfer_week = '',
                today_warmup_score = 0,
                today_rank_score = 0,
                today_challenge_score = 0,
                daily_score_date = '',
                reward_date = ''`),
            db.prepare(`UPDATE users SET
                warmup_score = 0,
                rank_score = 0,
                challenge_score = 0,
                total_score = 0,
                warmup_date = '',
                challenge_date = '',
                challenge_used = 0,
                version = version + 1`)
        ];

        await db.batch(statements);

        return new Response(JSON.stringify({ success: true }), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}