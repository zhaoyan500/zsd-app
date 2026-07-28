// /functions/api/save.js
export async function onRequest(context) {
    const { request, env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    try {
        const body = await request.json();
        const { name, userData } = body;

        if (!name || !userData) {
            return new Response(JSON.stringify({ error: '缺少必要参数' }), { status: 400, headers });
        }

        const db = env.D1_DB;

        // 1. 获取用户ID
        const user = await db.prepare('SELECT id FROM users WHERE name = ?').bind(name).first();
        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        const userId = user.id;
        const today = userData.dailyScoreDate || new Date().toISOString().split('T')[0];

        // ⭐ 修复：计算总积分
        let totalScore = userData.totalScore || 0;
        if (totalScore === 0) {
            const warmupScore = userData.warmupScore || 0;
            const rankScore = userData.rankScore || 0;
            const challengeScore = userData.challengeScore || 0;
            totalScore = warmupScore + rankScore + challengeScore;
        }

        // 2. 更新 users 表 - 增加 rank_daily 字段更新
        const rankDailyJson = JSON.stringify(userData.rankDaily || { date: today, used: 0 });
        
        await db.prepare(`
            UPDATE users SET
                unit = ?,
                warmupScore = ?,
                warmupDate = ?,
                rankScore = ?,
                challengeScore = ?,
                todayWarmup = ?,
                todayRank = ?,
                todayChallenge = ?,
                todayTotal = ?,
                dailyScoreDate = ?,
                totalScore = ?,
                challengeUsed = ?,
                challengeDate = ?,
                rank_daily = ?,
                version = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE name = ?
        `).bind(
            userData.unit || '',
            userData.warmupScore || 0,
            userData.warmupDate || '',
            userData.rankScore || 0,
            userData.challengeScore || 0,
            userData.todayWarmup || 0,
            userData.todayRank || 0,
            userData.todayChallenge || 0,
            userData.todayTotal || 0,
            today,
            totalScore,
            userData.challengeUsed || 0,
            userData.challengeDate || '',
            rankDailyJson,
            (userData.version || 1) + 1,
            name
        ).run();

        // 3. 写入 daily_score_history 表
        const dailyScore = userData.todayTotal || 0;
        await db.prepare(`
            INSERT INTO daily_score_history (user_id, date, daily_score)
            VALUES (?, ?, ?)
            ON CONFLICT(user_id, date) DO UPDATE SET daily_score = excluded.daily_score
        `).bind(userId, today, dailyScore).run();

        // 4. 返回更新后的用户数据
        const updatedUser = await db.prepare('SELECT * FROM users WHERE name = ?').bind(name).first();

        return new Response(JSON.stringify({
            success: true,
            user: updatedUser
        }), { headers });

    } catch (err) {
        console.error('save.js error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}