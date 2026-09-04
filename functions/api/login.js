// /functions/api/login.js
// 独立版本，包含所有工具函数，不依赖外部 _utils.js
// 支持哈希密码验证和每日登录奖励（+2分），奖励依赖 reward_date 字段，若字段不存在则跳过

// ===== 工具函数（内联） =====
function getBeijingDate() {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return beijingTime.toISOString().split('T')[0];
}

function generateSalt() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const hashBuffer = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: enc.encode(salt),
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );
    const hashArray = new Uint8Array(hashBuffer);
    return btoa(String.fromCharCode(...hashArray));
}

async function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    const newHash = await hashPassword(password, salt);
    return newHash === hash;
}

// ===== 主处理函数 =====
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

        console.log(`[Login] 用户 ${name} 尝试登录，今日日期: ${today}`);

        // 尝试查询包含 reward_date 的用户
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
            // 如果 reward_date 字段不存在，则回退到不含该字段的查询
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

        // 验证密码（哈希）
        const isValid = await verifyPassword(pwd, user.pwd);
        if (!isValid) {
            // 为兼容旧明文密码（如果之前是明文存储），可尝试直接比对
            // 但为了安全，不建议长期保留。这里仅作为过渡：
            // 如果哈希验证失败且密码是明文（不含冒号），则比对明文并自动升级为哈希
            if (!user.pwd.includes(':')) {
                if (user.pwd === pwd) {
                    // 自动升级为哈希
                    const salt = generateSalt();
                    const newHash = await hashPassword(pwd, salt);
                    const storedPwd = `${salt}:${newHash}`;
                    await db.prepare(`UPDATE users SET pwd = ? WHERE id = ?`).bind(storedPwd, user.id).run();
                    // 重新验证（本次登录成功）
                } else {
                    return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
                }
            } else {
                return new Response(JSON.stringify({ error: '密码错误' }), { status: 401, headers });
            }
        }

        // ========== 每日登录奖励（仅在 reward_date 存在时执行） ==========
        if (hasRewardDate) {
            console.log(`[Login] 当前 reward_date: ${user.reward_date}, 今日: ${today}`);
            if (user.reward_date !== today) {
                const newTotal = (user.total_score || 0) + 2;
                console.log(`[Login] 执行加分: 原 ${user.total_score} → ${newTotal}`);
                await db.prepare(`
                    UPDATE users 
                    SET total_score = ?, reward_date = ?, version = version + 1 
                    WHERE id = ?
                `).bind(newTotal, today, user.id).run();

                // 重新查询最新 total_score
                const updated = await db.prepare(`SELECT total_score FROM users WHERE id = ?`).bind(user.id).first();
                user.total_score = updated.total_score;
                user.reward_date = today;
                console.log(`[Login] 加分后 total_score: ${user.total_score}`);
            } else {
                console.log(`[Login] 今日已奖励，跳过加分`);
            }
        } else {
            console.log(`[Login] reward_date 不存在，跳过每日奖励`);
        }

        // ========== 原有登录重置逻辑 ==========
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
        // 如果 user 中没有 reward_date 字段，确保不添加
        if (!hasRewardDate) {
            // 可以添加一个占位，但无需操作
        }

        console.log(`[Login] 最终返回 total_score: ${user.total_score}`);
        return new Response(JSON.stringify({ success: true, user: user }), { headers });
    } catch (err) {
        console.error(`[Login] 错误: ${err.message}`);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}