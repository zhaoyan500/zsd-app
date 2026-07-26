// /functions/api/questions.js
export async function onRequest(context) {
    const { request, env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    // 只允许管理员操作（可通过请求头传递简单验证，此处复用 ADMIN_PWD）
    // 前端会在请求中附加 adminKey 参数
    const url = new URL(request.url);
    const adminKey = url.searchParams.get('adminKey') || 
                     (request.method === 'POST' ? (await request.clone().json().catch(() => ({}))).adminKey : null);

    // 验证管理员密码（与前端一致）
    const ADMIN_PWD = "zsdcr123";
    if (adminKey !== ADMIN_PWD) {
        return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
    }

    const db = env.D1_DB;

    // 处理不同的 HTTP 方法
    try {
        if (request.method === 'GET') {
            // 获取题库，可加 mode 参数过滤
            const mode = url.searchParams.get('mode');
            let sql = 'SELECT * FROM quiz_questions ORDER BY sort_order, id';
            let params = [];
            if (mode) {
                sql = 'SELECT * FROM quiz_questions WHERE mode = ? ORDER BY sort_order, id';
                params = [mode];
            }
            const result = await db.prepare(sql).bind(...params).all();
            return new Response(JSON.stringify(result.results || []), { headers });

        } else if (request.method === 'POST') {
            // 添加新题目
            const body = await request.json();
            const { mode, question, correct, option_a, option_b, option_c, option_d, sort_order } = body;
            if (!mode || !question || !correct || !option_a || !option_b || !option_c || !option_d) {
                return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
            }
            const insert = await db.prepare(`
                INSERT INTO quiz_questions (mode, question, correct, option_a, option_b, option_c, option_d, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(mode, question, correct, option_a, option_b, option_c, option_d, sort_order || 0).run();
            const newId = insert.meta?.last_row_id || insert.lastRowId;
            const newQuestion = await db.prepare('SELECT * FROM quiz_questions WHERE id = ?').bind(newId).first();
            return new Response(JSON.stringify({ success: true, question: newQuestion }), { headers });

        } else if (request.method === 'PUT') {
            // 更新题目
            const body = await request.json();
            const { id, mode, question, correct, option_a, option_b, option_c, option_d, sort_order } = body;
            if (!id) return new Response(JSON.stringify({ error: '缺少题目ID' }), { status: 400, headers });
            const update = await db.prepare(`
                UPDATE quiz_questions SET
                    mode = ?, question = ?, correct = ?, option_a = ?, option_b = ?, option_c = ?, option_d = ?,
                    sort_order = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(mode, question, correct, option_a, option_b, option_c, option_d, sort_order || 0, id).run();
            if (update.changes === 0) {
                return new Response(JSON.stringify({ error: '题目不存在' }), { status: 404, headers });
            }
            const updated = await db.prepare('SELECT * FROM quiz_questions WHERE id = ?').bind(id).first();
            return new Response(JSON.stringify({ success: true, question: updated }), { headers });

        } else if (request.method === 'DELETE') {
            // 删除题目
            const id = url.searchParams.get('id');
            if (!id) return new Response(JSON.stringify({ error: '缺少题目ID' }), { status: 400, headers });
            const del = await db.prepare('DELETE FROM quiz_questions WHERE id = ?').bind(id).run();
            if (del.changes === 0) {
                return new Response(JSON.stringify({ error: '题目不存在' }), { status: 404, headers });
            }
            return new Response(JSON.stringify({ success: true }), { headers });

        } else {
            return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
        }
    } catch (err) {
        console.error('题库API错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}