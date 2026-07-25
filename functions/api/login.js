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

        const user = await db.prepare(`
            SELECT id, name, unit, pwd, 
                   daily_warmup_score, daily_rank_score, daily_challenge_score, daily_total_score, daily_date,
                   total_warmup_score, total_rank_score, total_challenge_score, total_total_score,
                   warmup_score, warmup_date, rank_score, challenge_score, challenge_date,
                   total_score, challenge_used, version, created_at
            FROM users WHERE name = ?
        `).bind(name).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        if (user.pwd !== pwd) {
            return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
        }

        const today = new Date().toISOString().split('T')[0];
        
        // ✅ 检查每日积分是否需要重置（只重置每日积分，不影响历史积分）
        if (user.daily_date !== today) {
            // ✅ 只重置每日积分字段，历史积分保持不变
            await db.prepare(`
                UPDATE users SET 
                    daily_warmup_score = 0,
                    daily_rank_score = 0,
                    daily_challenge_score = 0,
                    daily_total_score = 0,
                    daily_date = ?,
                    -- ✅ 兼容字段同步为每日积分（重置后为0）
                    warmup_score = 0,
                    rank_score = 0,
                    challenge_score = 0,
                    -- ✅ total_score 重新计算 = 每日积分(0) + 历史总积分
                    total_score = total_total_score
                WHERE id = ?
            `).bind(today, user.id).run();
            
            // ✅ 更新内存中的用户对象（每日积分重置为0）
            user.daily_warmup_score = 0;
            user.daily_rank_score = 0;
            user.daily_challenge_score = 0;
            user.daily_total_score = 0;
            user.daily_date = today;
            user.warmup_score = 0;
            user.rank_score = 0;
            user.challenge_score = 0;
        }
        
        // ✅ 从云端查询今日排位赛已用次数
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

        // ✅ 计算显示用的总积分 = 每日积分 + 历史总积分
        user.total_score = (user.daily_total_score || 0) + (user.total_total_score || 0);

        delete user.pwd;

        return new Response(JSON.stringify({ success: true, user: user }), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}