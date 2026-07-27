// /functions/api/questions.js
export async function onRequest(context) {
    const { request, env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    const url = new URL(request.url);
    const db = env.D1_DB;
    const ADMIN_PWD = "zsdcr123";

    try {
        // ============================================================
        // GET - 普通用户获取题库（无需验证）
        // ============================================================
        if (request.method === 'GET') {
            const mode = url.searchParams.get('mode');
            let sql = 'SELECT * FROM quiz_questions ORDER BY sort_order, id';
            let params = [];
            if (mode) {
                sql = 'SELECT * FROM quiz_questions WHERE mode = ? ORDER BY sort_order, id';
                params = [mode];
            }
            const result = await db.prepare(sql).bind(...params).all();
            return new Response(JSON.stringify(result.results || []), { headers });
        }

        // ============================================================
        // POST/PUT/DELETE - 管理员操作（需要验证）
        // ============================================================
        
        // 获取 adminKey（从 URL 参数或请求体）
        let adminKey = url.searchParams.get('adminKey');
        if (!adminKey && (request.method === 'POST' || request.method === 'PUT')) {
            try {
                const body = await request.clone().json();
                adminKey = body.adminKey;
            } catch (e) {
                // 忽略解析错误
            }
        }

        // 验证管理员密码
        if (adminKey !== ADMIN_PWD) {
            return new Response(JSON.stringify({ 
                error: '未授权，需要管理员密码' 
            }), { status: 401, headers });
        }

        // ============================================================
        // POST - 添加题目
        // ============================================================
        if (request.method === 'POST') {
            const body = await request.json();
            const { mode, question, correct, option_a, option_b, option_c, option_d, sort_order } = body;
            
            // 验证必填字段
            if (!mode || !question || !correct || !option_a || !option_b || !option_c || !option_d) {
                return new Response(JSON.stringify({ 
                    error: '参数不完整，请检查所有字段' 
                }), { status: 400, headers });
            }

            // 验证正确答案格式
            if (!['A', 'B', 'C', 'D'].includes(correct.toUpperCase())) {
                return new Response(JSON.stringify({ 
                    error: '正确答案必须是 A、B、C、D 中的一个' 
                }), { status: 400, headers });
            }

            const insert = await db.prepare(`
                INSERT INTO quiz_questions (mode, question, correct, option_a, option_b, option_c, option_d, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                mode, 
                question, 
                correct.toUpperCase(), 
                option_a, 
                option_b, 
                option_c, 
                option_d, 
                sort_order || 0
            ).run();

            const newId = insert.meta?.last_row_id || insert.lastRowId;
            const newQuestion = await db.prepare('SELECT * FROM quiz_questions WHERE id = ?').bind(newId).first();
            
            return new Response(JSON.stringify({ 
                success: true, 
                question: newQuestion,
                message: '题目添加成功'
            }), { headers });
        }

        // ============================================================
        // PUT - 更新题目
        // ============================================================
        if (request.method === 'PUT') {
            const body = await request.json();
            const { id, mode, question, correct, option_a, option_b, option_c, option_d, sort_order } = body;
            
            if (!id) {
                return new Response(JSON.stringify({ error: '缺少题目ID' }), { status: 400, headers });
            }

            // 验证必填字段
            if (!mode || !question || !correct || !option_a || !option_b || !option_c || !option_d) {
                return new Response(JSON.stringify({ 
                    error: '参数不完整，请检查所有字段' 
                }), { status: 400, headers });
            }

            // 验证正确答案格式
            if (!['A', 'B', 'C', 'D'].includes(correct.toUpperCase())) {
                return new Response(JSON.stringify({ 
                    error: '正确答案必须是 A、B、C、D 中的一个' 
                }), { status: 400, headers });
            }

            const update = await db.prepare(`
                UPDATE quiz_questions SET
                    mode = ?,
                    question = ?,
                    correct = ?,
                    option_a = ?,
                    option_b = ?,
                    option_c = ?,
                    option_d = ?,
                    sort_order = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).bind(
                mode,
                question,
                correct.toUpperCase(),
                option_a,
                option_b,
                option_c,
                option_d,
                sort_order || 0,
                id
            ).run();

            if (update.changes === 0) {
                return new Response(JSON.stringify({ error: '题目不存在' }), { status: 404, headers });
            }

            const updated = await db.prepare('SELECT * FROM quiz_questions WHERE id = ?').bind(id).first();
            return new Response(JSON.stringify({ 
                success: true, 
                question: updated,
                message: '题目更新成功'
            }), { headers });
        }

        // ============================================================
        // DELETE - 删除题目
        // ============================================================
        if (request.method === 'DELETE') {
            const id = url.searchParams.get('id');
            
            if (!id) {
                return new Response(JSON.stringify({ error: '缺少题目ID' }), { status: 400, headers });
            }

            // DELETE 请求从 URL 获取 adminKey
            if (url.searchParams.get('adminKey') !== ADMIN_PWD) {
                return new Response(JSON.stringify({ 
                    error: '未授权，需要管理员密码' 
                }), { status: 401, headers });
            }

            const del = await db.prepare('DELETE FROM quiz_questions WHERE id = ?').bind(id).run();
            
            if (del.changes === 0) {
                return new Response(JSON.stringify({ error: '题目不存在' }), { status: 404, headers });
            }

            return new Response(JSON.stringify({ 
                success: true,
                message: '题目删除成功'
            }), { headers });
        }

        // ============================================================
        // 不支持的请求方法
        // ============================================================
        return new Response(JSON.stringify({ 
            error: 'Method not allowed' 
        }), { status: 405, headers });

    } catch (err) {
        console.error('题库API错误:', err);
        return new Response(JSON.stringify({ 
            error: '服务器内部错误: ' + err.message,
            stack: err.stack 
        }), { status: 500, headers });
    }
}