// /functions/api/save.js
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
        const { name, userData } = body;

        if (!name || !userData) {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        const db = env.D1_DB;
        const now = new Date().toISOString();

        await db.prepare(`
            UPDATE users SET
                warmup_score = ?,
                warmup_date = ?,
                rank_score = ?,
                rank_remain = ?,
                challenge_score = ?,
                challenge_date = ?,
                total_score = ?,
                challenge_used = ?,
                updated_at = ?
            WHERE name = ?
        `).bind(
            userData.warmupScore || 0,
            userData.warmupDate || '',
            userData.rankScore || 0,
            userData.rankRemain || 3,
            userData.challengeScore || 0,
            userData.challengeDate || '',
            userData.totalScore || 0,
            userData.challengeUsed || 0,
            now,
            name
        ).run();

        if (userData.rankDaily && userData.rankDaily.date) {
            const exists = await db.prepare(`
                SELECT 1 FROM rank_daily WHERE user_id = ? AND date = ?
            `).bind(userData.id, userData.rankDaily.date).first();

            if (exists) {
                await db.prepare(`
                    UPDATE rank_daily SET used = ? WHERE user_id = ? AND date = ?
                `).bind(userData.rankDaily.used, userData.id, userData.rankDaily.date).run();
            } else {
                await db.prepare(`
                    INSERT INTO rank_daily (user_id, date, used) VALUES (?, ?, ?)
                `).bind(userData.id, userData.rankDaily.date, userData.rankDaily.used).run();
            }
        }

        if (userData.rankHistory && userData.rankHistory.length > 0) {
            const last = userData.rankHistory[userData.rankHistory.length - 1];
            await db.prepare(`
                INSERT INTO quiz_history (user_id, mode, score, date) VALUES (?, 'ranked', ?, ?)
            `).bind(userData.id, last.score, last.date).run();
        }

        if (userData.challengeHistory && userData.challengeHistory.length > 0) {
            const last = userData.challengeHistory[userData.challengeHistory.length - 1];
            await db.prepare(`
                INSERT INTO quiz_history (user_id, mode, score, date) VALUES (?, 'challenge', ?, ?)
            `).bind(userData.id, last.score, last.date).run();
        }

        return new Response(JSON.stringify({ success: true }), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}