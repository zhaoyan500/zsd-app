// /functions/api/questions.js
export async function onRequest(context) {
    const { request, env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    const url = new URL(request.url);
    const db = env.D1_DB;

    // 处理 GET 请求（查询题库）
    if (request.method === 'GET') {
        try {
            const mode = url.searchParams.get('mode') || 'warmup';
            const adminKey = url.searchParams.get('adminKey');

            // 如果是管理员请求（带 adminKey），返回全部字段；否则只返回题目字段
            const isAdmin = (adminKey === 'zsdcr123');

            const rows = await db.prepare(`
                SELECT id, mode, question, option_a, option_b, option_c, option_d, correct, sort_order
                FROM questions
                WHERE mode = ?
                ORDER BY sort_order ASC, id ASC
            `).bind(mode).all();

            const results = rows.results || [];
            return new Response(JSON.stringify(results), { headers });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
        }
    }

    // 处理 POST 请求（添加题目）
    if (request.method === 'POST') {
        try {
            const body = await request.json();
            const { mode, question, option_a, option_b, option_c, option_d, correct, sort_order, adminKey } = body;

            if (adminKey !== 'zsdcr123') {
                return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
            }

            if (!mode || !question || !option_a || !option_b || !option_c || !option_d || !correct) {
                return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
            }

            const result = await db.prepare(`
                INSERT INTO questions (mode, question, option_a, option_b, option_c, option_d, correct, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(mode, question, option_a, option_b, option_c, option_d, correct, sort_order || 0).run();

            return new Response(JSON.stringify({ success: true, id: result.lastRowId }), { headers });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
        }
    }

    // 处理 PUT 请求（编辑题目）
    if (request.method === 'PUT') {
        try {
            const body = await request.json();
            const { id, mode, question, option_a, option_b, option_c, option_d, correct, sort_order, adminKey } = body;

            if (adminKey !== 'zsdcr123') {
                return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
            }

            if (!id || !mode || !question || !option_a || !option_b || !option_c || !option_d || !correct) {
                return new Response(JSON.stringify({ error: '参数不完整' }), { status: 400, headers });
            }

            await db.prepare(`
                UPDATE questions SET
                    mode = ?,
                    question = ?,
                    option_a = ?,
                    option_b = ?,
                    option_c = ?,
                    option_d = ?,
                    correct = ?,
                    sort_order = ?
                WHERE id = ?
            `).bind(mode, question, option_a, option_b, option_c, option_d, correct, sort_order || 0, id).run();

            return new Response(JSON.stringify({ success: true }), { headers });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
        }
    }

    // 处理 DELETE 请求（删除题目）
    if (request.method === 'DELETE') {
        try {
            const id = url.searchParams.get('id');
            const adminKey = url.searchParams.get('adminKey');

            if (adminKey !== 'zsdcr123') {
                return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
            }

            if (!id) {
                return new Response(JSON.stringify({ error: '缺少题目 ID' }), { status: 400, headers });
            }

            await db.prepare(`DELETE FROM questions WHERE id = ?`).bind(id).run();

            return new Response(JSON.stringify({ success: true }), { headers });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
        }
    }

    // 其他方法不允许
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
}