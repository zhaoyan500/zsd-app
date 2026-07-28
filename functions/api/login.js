// /functions/api/login.js
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
        const { name, pwd } = body;

        if (!name || !pwd) {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        const db = env.D1_DB;

        // ⭐ 查询所有字段
        const user = await db.prepare(`
            SELECT 
                id, name, unit, pwd, 
                warmup_score, rank_score, challenge_score,
                today_warmup_score, today_rank_score, today_challenge_score,
                daily_score, daily_score_date, total_score,
                warmup_date, challenge_date, challenge_used, version, created_at, updated_at
            FROM users WHERE name = ?
        `).bind(name).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        if (user.pwd !== pwd) {
            return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
        }

        const today = new Date().toISOString().split('T')[0'];

        // ⭐ 如果日期不同，重置今日数据（但保留历史最高分）
        if (user.daily_score_date !== today) {
            console.log(`🔄 用户 ${name} 日期变化: ${user.daily_score_date} -> ${today}，重置今日数据`);
            
            await db.prepare(`
                UPDATE users SET 
                    daily_score = 0, 
                    daily_score_date = ?,
                    today_warmup_score = 0,
                    today_rank_score = 0,
                    today_challenge_score = 0,
                    updated_at = datetime('now')
                WHERE id = ?
            `).bind(today, user.id).run();
            
            // 更新对象
            user.daily_score = 0;
            user.daily_score_date = today;
            user.today_warmup_score = 0;
            user.today_rank_score = 0;
            user.today_challenge_score = 0;
        }

        // 重置挑战赛使用次数
        if (user.challenge_date !== today) {
            await db.prepare(`
                UPDATE users SET 
                    challenge_used = 0, 
                    challenge_date = ?,
                    updated_at = datetime('now')
                WHERE id = ?
            `).bind(today, user.id).run();
            user.challenge_used = 0;
            user.challenge_date = today;
        }

        // 排位赛每日记录
        let rankDaily = await db.prepare(`
            SELECT used FROM rank_daily WHERE user_id = ? AND date = ?
        `).bind(user.id, today).first();
        
        if (!rankDaily) {
            await db.prepare(`
                INSERT INTO rank_daily (user_id, date, used) VALUES (?, ?, 0)
            `).bind(user.id, today).run();
            rankDaily = { used: 0 };
        }
        
        const used = rankDaily.used || 0;
        user.rank_remain = Math.max(0, 3 - used);
        user.rankDaily = { date: today, used: used };

        // ⭐ 删除密码
        delete user.pwd;

        return new Response(JSON.stringify({ success: true, user: user }), { headers });
    } catch (err) {
        console.error('login.js error:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}