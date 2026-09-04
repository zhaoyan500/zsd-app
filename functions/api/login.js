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
        let user;
        let hasRewardDate = false;
        try {
            user = await db.prepare(`
                SELECT id, name, unit, pwd, 
                       warmup_score, rank_score, challenge_score,
                       today_warmup_score, today_rank_score, today_challenge_score,
                       daily_score, daily_score_date, total_score,
                       warmup_date, challenge_date, challenge_used, version, created_at,
                       reward_date
                FROM users WHERE name = ?
            `).bind(name).first();
            if (user && user.reward_date !== undefined) hasRewardDate = true;
        } catch (err) {
            if (err.message && err.message.includes('no such column')) {
                console.warn('[Login] reward_date 字段不存在，降级处理');
                user = await db.prepare(`
                    SELECT id, name, unit, pwd, 
                           warmup_score, rank_score, challenge_score,
                           today_warmup_score, today_rank_score, today_challenge_score,
                           daily_score, daily_score_date, total_score,
                           warmup_date, challenge_date, challenge_used, version, created_at
                    FROM users WHERE name = ?
                `).bind(name).first();
            } else {
                throw err;
            }
        }

        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        // 验证密码
        const isValid = await verifyPassword(pwd, user.pwd);
        if (!isValid) {
            // 兼容旧明文（自动升级）
            if (!user.pwd.includes(':')) {
                if (user.pwd === pwd) {
                    const salt = generateSalt();
                    const newHash = await hashPassword(pwd, salt);
                    const storedPwd = `${salt}:${newHash}`;
                    await db.prepare(`UPDATE users SET pwd = ? WHERE id = ?`).bind(storedPwd, user.id).run();
                } else {
                    return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
                }
            } else {
                return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
            }
        }

        // 每日登录奖励
        if (hasRewardDate) {
            if (user.reward_date !== today) {
                const newTotal = (user.total_score || 0) + 2;
                await db.prepare(`
                    UPDATE users 
                    SET total_score = ?, reward_date = ?, version = version + 1 
                    WHERE id = ?
                `).bind(newTotal, today, user.id).run();
                const updated = await db.prepare(`SELECT total_score FROM users WHERE id = ?`).bind(user.id).first();
                user.total_score = updated.total_score;
                user.reward_date = today;
            }
        }

        // 原有重置逻辑
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
        console.error('[Login] 错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}