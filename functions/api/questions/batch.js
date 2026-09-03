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
        const { adminKey, questions } = body;

        // 验证管理员密钥（与原有保持一致）
        if (adminKey !== 'zsdcr123') {
            return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
        }

        if (!questions || !Array.isArray(questions) || questions.length === 0) {
            return new Response(JSON.stringify({ error: '题目列表为空或格式无效' }), { status: 400, headers });
        }

        const db = env.D1_DB;

        // 批量插入（循环，也可使用 batch 但需注意 SQL 长度限制）
        let inserted = 0;
        for (const q of questions) {
            const { mode, question, option_a, option_b, option_c, option_d, correct, sort_order } = q;
            // 校验必填字段
            if (!mode || !question || !option_a || !option_b || !option_c || !option_d || !correct) {
                continue; // 跳过不完整的题目
            }
            await db.prepare(`
                INSERT INTO questions (mode, question, option_a, option_b, option_c, option_d, correct, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(mode, question, option_a, option_b, option_c, option_d, correct, sort_order || 0).run();
            inserted++;
        }

        return new Response(JSON.stringify({
            success: true,
            message: `成功导入 ${inserted} 道题目`,
            inserted: inserted
        }), { headers });
    } catch (err) {
        console.error('批量导入失败:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}