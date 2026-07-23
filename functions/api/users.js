// functions/api/users.js
export async function onRequest(context) {
    const { env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    try {
        const db = env.D1_DB;

        // 获取所有用户
        const users = await db.prepare(`
            SELECT id, name, unit, warmup_score, rank_score, challenge_score, total_score,
                   warmup_date, challenge_date, challenge_used, created_at
            FROM users
            ORDER BY total_score DESC
        `).all();

        const results = users.results || [];
        const today = new Date().toDateString();

        // 处理每个用户的数据
        for (const user of results) {
            const rankDaily = await db.prepare(`
                SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
            `).bind(user.id, today).first();
            user.rank_remain = rankDaily ? Math.max(0, 3 - rankDaily.used) : 3;
            user.rankDaily = rankDaily ? { date: today, used: rankDaily.used } : { date: today, used: 0 };
            // 转换为驼峰命名（前端兼容）
            user.warmupScore = user.warmup_score;
            user.rankScore = user.rank_score;
            user.challengeScore = user.challenge_score;
            user.totalScore = user.total_score;
            user.warmupDate = user.warmup_date;
            user.challengeDate = user.challenge_date;
            user.challengeUsed = user.challenge_used;
        }

        // 计算战队总积分
        const teamMap = {};
        for (const user of results) {
            if (user.unit) {
                if (!teamMap[user.unit]) {
                    teamMap[user.unit] = { 
                        unit: user.unit, 
                        totalScore: 0, 
                        memberCount: 0,
                        members: []
                    };
                }
                teamMap[user.unit].totalScore += (user.totalScore || 0);
                teamMap[user.unit].memberCount += 1;
                teamMap[user.unit].members.push(user);
            }
        }

        // 战队总积分排行
        const teamRanking = Object.values(teamMap).sort((a, b) => b.totalScore - a.totalScore);

        return new Response(JSON.stringify({
            users: results,
            teamRanking: teamRanking
        }), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}