// /functions/api/_utils.js

/**
 * 获取北京时间（UTC+8）的日期字符串 YYYY-MM-DD
 */
export function getBeijingDate() {
    const now = new Date();
    const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    return beijingTime.toISOString().split('T')[0];
}

/**
 * 生成随机盐（16字节十六进制）
 */
export function generateSalt() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * PBKDF2 哈希密码
 * @param {string} password - 明文密码
 * @param {string} salt - 十六进制盐
 * @returns {Promise<string>} 哈希值（base64）
 */
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
    // 转为 base64
    const base64 = btoa(String.fromCharCode(...hashArray));
    return base64;
}

/**
 * 验证密码
 * @param {string} password - 明文密码
 * @param {string} stored - 数据库中存储的 "salt:hash"
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, stored) {
    if (!stored || !stored.includes(':')) return false;
    const [salt, hash] = stored.split(':');
    const newHash = await hashPassword(password, salt);
    return newHash === hash;
}