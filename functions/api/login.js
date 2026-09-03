// /functions/api/login.js
import { verifyPassword, getBeijingDate } from './_utils.js';

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
        const today = getBeijingDate();

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

        // 验证密码哈希
        const isValid = await verifyPassword(pwd, user.pwd);
        if (!isValid) {
            return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
        }

        // ========== 每日登录奖励 ==========
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

        // ========== 原有登录逻辑 ==========
        if (user.daily_score_date !== today) {
            user.daily_score = 0;
            user.daily_score_date = today;
            user.today_warmup_score = 0;
            user.today_rank_score = 0;
            user.today_challenge_score = 0;
            await db.prepare(`
                UPDATE users SET 
                    daily_score = 0, 
                    daily_score_date = ?, 
                    today_warmup_score = 0,
                    today_rank_score = 0,
                    today_challenge_score = 0
                WHERE id = ?
            `).bind(today, user.id).run();
        }

        if (user.challenge_date !== today) {
            user.challenge_used = 0;
            user.challenge_date = today;
            await db.prepare(`
                UPDATE users SET 
                    challenge_used = 0, 
                    challenge_date = ?
                WHERE id = ?
            `).bind(today, user.id).run();
        }

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

        delete user.pwd;

        return new Response(JSON.stringify({ success: true, user: user }), { headers });
    } catch (err) {
        // 降级处理（如 reward_date 字段不存在）
        if (err.message && err.message.includes('no such column')) {
            console.warn('reward_date 字段不存在，跳过每日奖励');
            try {
                // 回退到不含 reward_date 的查询（无奖励）
                const fallbackUser = await db.prepare(`
                    SELECT id, name, unit, pwd, 
                           warmup_score, rank_score, challenge_score,
                           today_warmup_score, today_rank_score, today_challenge_score,
                           daily_score, daily_score_date, total_score,
                           warmup_date, challenge_date, challenge_used, version, created_at
                    FROM users WHERE name = ?
                `).bind(name).first();
                if (!fallbackUser) {
                    return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
                }
                const isValid = await verifyPassword(pwd, fallbackUser.pwd);
                if (!isValid) {
                    return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
                }
                // 继续执行原有重置逻辑（略）
                // ...（此处为简化，可复制上方重置逻辑，但建议先迁移数据库）
                return new Response(JSON.stringify({ error: '数据库迁移未完成，请联系管理员' }), { status: 500, headers });
            } catch (e) {
                return new Response(JSON.stringify({ error: e.message }), { status: 500, headers });
            }
        }
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}