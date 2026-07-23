// /functions/api/health.js
export async function onRequest(context) {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
    };

    return new Response(JSON.stringify({
        status: 'ok',
        message: 'API 服务运行正常',
        time: new Date().toISOString()
    }), { headers });
}