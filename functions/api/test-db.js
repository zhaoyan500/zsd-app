// /functions/api/test-db.js
export async function onRequest(context) {
    const { env } = context;
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    try {
        if (!env.D1_DB) {
            return new Response(JSON.stringify({
                success: false,
                error: 'D1 数据库未绑定'
            }), { status: 500, headers });
        }

        const result = await env.D1_DB.prepare('SELECT 1 as test').first();
        return new Response(JSON.stringify({
            success: true,
            result: result,
            message: 'D1 连接成功！'
        }), { headers });
    } catch (err) {
        return new Response(JSON.stringify({
            success: false,
            error: err.message
        }), { status: 500, headers });
    }
}