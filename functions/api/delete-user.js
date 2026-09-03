// /functions/api/delete-user.js
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
        const { name, adminKey } = body;

        // 验证管理员密码（与 clear-all 保持一致）
        if (adminKey !== 'zsdcr123') {
            return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
        }

        if (!name) {
            return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
        }

        const db = env.D1_DB;

        // 先查询用户是否存在，获取 id
        const user = await db.prepare('SELECT id FROM users WHERE name = ?').bind(name).first();
        if (!user) {
            return new Response(JSON.stringify({ error: '用户不存在' }), { status: 404, headers });
        }

        const userId = user.id;

        // 使用事务删除所有关联数据
        const statements = [
            db.prepare('DELETE FROM daily_score_history WHERE user_id = ?').bind(userId),
            db.prepare('DELETE FROM rank_daily WHERE user_id = ?').bind(userId),
            db.prepare('DELETE FROM quiz_history WHERE user_id = ?').bind(userId),
            db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
        ];

        await db.batch(statements);

        return new Response(JSON.stringify({ success: true, message: '用户已删除' }), { headers });
    } catch (err) {
        console.error('删除用户失败:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}