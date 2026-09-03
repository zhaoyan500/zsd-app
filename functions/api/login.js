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
        const today = new Date().toISOString().split('T')[0]; // 使用 UTC，建议改为北京时间

        // 查询用户（包含 reward_date）
        const user = await db.prepare(`
            SELECT id, name, unit, pwd, 
                   warmup_score, rank_score, challenge_score,
                   today_warmup_score, today_rank_score, today_challenge_score,
                   daily_score, daily_score_date, total_score,
                   warmup_date, challenge_date, challenge_used, version, created_at,
                   reward_date
            FROM users WHERE name = ?
        `).bind(name).first();

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        if (user.pwd !== pwd) {
            return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
        }

        // ----- 每日登录奖励 -----
        // 若 reward_date 不是今日，则加2分并更新 reward_date
        if (user.reward_date !== today) {
            const newTotal = (user.total_score || 0) + 2;
            await db.prepare(`
                UPDATE users 
                SET total_score = ?, reward_date = ?, version = version + 1 
                WHERE id = ?
            `).bind(newTotal, today, user.id).run();
            user.total_score = newTotal;
            user.reward_date = today;
        }

        // 原有逻辑：重置今日数据等
        // 注意：若今日未重置，需重置 daily_score_date 等（原有代码已处理）
        // 这里保留原有登录重置逻辑（略，可参考原 login.js）

        // 继续原有逻辑（重置 daily_score、today_*、挑战、排位等）
        // ... 原代码保持不变 ...

        // 返回用户信息（已包含 total_score 和 reward_date）
        delete user.pwd;
        return new Response(JSON.stringify({ success: true, user: user }), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}