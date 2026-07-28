// /functions/api/register.js
import { getBeijingDate, generateSalt, hashPassword } from './_utils.js';

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
        const { name, unit, pwd } = body;

        if (!name || !unit || !pwd) {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        const db = env.D1_DB;

        const existing = await db.prepare('SELECT name FROM users WHERE name = ?').bind(name).first();
        if (existing) {
            return new Response(JSON.stringify({ error: '用户名已存在' }), { status: 409, headers });
        }

        const id = Date.now().toString() + '_' + Math.random().toString(36).substr(2, 6);
        const now = new Date().toISOString();
        const today = getBeijingDate();

        // 生成盐并哈希密码
        const salt = generateSalt();
        const hashedPwd = await hashPassword(pwd, salt);
        const storedPwd = `${salt}:${hashedPwd}`;

        await db.prepare(`
            INSERT INTO users (
                id, name, unit, pwd, 
                warmup_score, rank_score, challenge_score, total_score,
                today_warmup_score, today_rank_score, today_challenge_score,
                daily_score, daily_score_date,
                warmup_date, challenge_date, challenge_used, 
                version, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, ?, '', '', 0, 1, ?, ?)
        `).bind(id, name, unit, storedPwd, today, now, now).run();

        const user = await db.prepare(`
            SELECT id, name, unit, 
                   warmup_score, rank_score, challenge_score, total_score,
                   warmup_date, challenge_date, challenge_used, version, created_at
            FROM users WHERE id = ?
        `).bind(id).first();

        // 返回时补齐 rank 信息
        user.rank_remain = 3;
        user.rankDaily = { date: today, used: 0 };

        return new Response(JSON.stringify({ success: true, user }), { headers });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}