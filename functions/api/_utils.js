// /functions/api/_utils.js

export function getBeijingDate() {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return beijingTime.toISOString().split('T')[0];
}

export function getBeijingNow() {
    const now = new Date();
    return new Date(now.getTime() + 8 * 60 * 60 * 1000);
}

// 给定日期字符串（YYYY-MM-DD），返回本周周一日期
export function getBeijingWeekStart(dateStr) {
    const parts = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1]-1, parts[2]));
    const day = d.getUTCDay(); // 0=Sun ... 6=Sat
    const diff = (day === 0 ? 7 : day) - 1; // 与周一的差
    const monday = new Date(Date.UTC(parts[0], parts[1]-1, parts[2] - diff));
    return monday.toISOString().split('T')[0];
}

// 给定日期字符串，返回该自然月的第一天
export function getBeijingMonthStart(dateStr) {
    const parts = dateStr.split('-').map(Number);
    return `${parts[0]}-${String(parts[1]).padStart(2,'0')}-01`;
}

// 给定日期字符串，返回该自然月的最后一天（含当月全部日期范围）
export function getBeijingMonthEnd(dateStr) {
    const parts = dateStr.split('-').map(Number);
    // 下月第 0 天 = 本月最后一天
    const lastDay = new Date(Date.UTC(parts[0], parts[1], 0)).getUTCDate();
    return `${parts[0]}-${String(parts[1]).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;
}

// 给定日期字符串，返回 ISO 周标记 "YYYY-Www"
export function getISOWeek(dateStr) {
    const parts = dateStr.split('-').map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1]-1, parts[2]));
    // ISO 周计算
    const dayOfWeek = (d.getUTCDay() + 6) % 7; // 周一=0, ..., 周日=6
    d.setUTCDate(d.getUTCDate() - dayOfWeek + 3); // 转到本周周四
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2,'0')}`;
}

export function generateSalt() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, salt) {
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

export async function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    const newHash = await hashPassword(password, salt);
    return newHash === hash;
}

// 周日 24:00 转存：把每个用户的 daily_score 加到 historical_score，并清零
// 用 last_transfer_week 防止重复转存
// 由 login / save / weekly-transfer 接口在检测到新一周时触发
export async function runWeeklyTransfer(db, currentWeek) {
    try {
        await db.prepare(`
            UPDATE users
            SET historical_score = COALESCE(historical_score, 0) + COALESCE(daily_score, 0),
                daily_score = 0,
                start_of_day_score = 0,
                today_warmup_score = 0,
                today_rank_score = 0,
                today_challenge_score = 0,
                daily_score_date = '',
                last_transfer_week = ?
            WHERE COALESCE(last_transfer_week, '') != ?
              AND COALESCE(last_transfer_week, '') < ?
        `).bind(currentWeek, currentWeek, currentWeek).run();
        console.log(`[Transfer] 周转存完成: ${currentWeek}`);
    } catch (err) {
        console.error('[Transfer] 转存失败:', err);
    }
}