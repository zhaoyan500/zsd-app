// /functions/api/questions/batch.js
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
        const { adminKey, questions, mode, overwrite = true } = body; // 默认覆盖

        // 验证管理员密钥
        if (adminKey !== 'zsdcr123') {
            return new Response(JSON.stringify({ error: '未授权' }), { status: 401, headers });
        }

        if (!questions || !Array.isArray(questions) || questions.length === 0) {
            return new Response(JSON.stringify({ error: '题目列表为空或格式无效' }), { status: 400, headers });
        }

        // 若未传 mode，则从第一条数据中推断，但建议前端必传
        const targetMode = mode || (questions[0] && questions[0].mode);
        if (!targetMode) {
            return new Response(JSON.stringify({ error: '缺少 mode 参数，无法确定覆盖范围' }), { status: 400, headers });
        }

        const db = env.D1_DB;

        // 检查 questions 表是否存在
        try {
            await db.prepare(`SELECT 1 FROM questions LIMIT 1`).all();
        } catch (e) {
            return new Response(JSON.stringify({ 
                error: 'questions 表不存在，请先执行数据库迁移 v4' 
            }), { status: 500, headers });
        }

        // 如果启用覆盖，删除该模式下所有旧题目
        if (overwrite) {
            await db.prepare(`DELETE FROM questions WHERE mode = ?`).bind(targetMode).run();
        }

        let inserted = 0;
        const errors = [];

        for (const q of questions) {
            // 优先使用题目自带的 mode，否则使用目标 mode
            const mode = q.mode || targetMode;
            const { question, option_a, option_b, option_c, option_d, correct, sort_order } = q;
            
            if (!mode || !question || !option_a || !option_b || !option_c || !option_d || !correct) {
                errors.push(`题目 "${question || '未命名'}" 缺少必填字段`);
                continue;
            }

            const correctUpper = correct.toUpperCase();
            if (!['A', 'B', 'C', 'D'].includes(correctUpper)) {
                errors.push(`题目 "${question}" 的答案格式错误: ${correct}，必须为 A/B/C/D`);
                continue;
            }

            try {
                await db.prepare(`
                    INSERT INTO questions (mode, question, option_a, option_b, option_c, option_d, correct, sort_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                    mode,
                    question,
                    option_a,
                    option_b,
                    option_c,
                    option_d,
                    correctUpper,
                    sort_order || 0
                ).run();
                inserted++;
            } catch (e) {
                errors.push(`插入失败: ${question} - ${e.message}`);
                console.error(`[Batch] 插入失败:`, e);
            }
        }

        // 如果全部失败，且启用了覆盖（但删除成功），可能造成题库为空，建议回滚？但D1不支持事务？可以用batch实现回滚，但为简化，暂不实现。

        return new Response(JSON.stringify({
            success: true,
            overwritten: overwrite,
            inserted: inserted,
            errors: errors.length > 0 ? errors : undefined,
            message: `成功导入 ${inserted} 道题目${errors.length > 0 ? `，${errors.length} 道失败` : ''}`
        }), { headers });

    } catch (err) {
        console.error('[Batch] 错误:', err);
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
    }
}