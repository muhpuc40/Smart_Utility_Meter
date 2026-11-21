/*
============================================================
 HTTP -> HTTPS RELAY FOR THE SIM900A
 Cloudflare Worker (free) on *.workers.dev

 The SIM900A can only send plain HTTP. Render accepts HTTPS only.
 This Worker accepts the meter's plain HTTP request and forwards
 it to the Render backend over HTTPS.

   ESP32 --HTTP--> https?://<name>.<account>.workers.dev --HTTPS--> Render

 Only the meter routes (/consumer/meter/...) and /health are
 forwarded. Admin and consumer panels call Render directly.

 Deploy: Cloudflare Dashboard > Workers & Pages > Create >
 "Start with Hello World" > Deploy > Edit code > paste this file > Deploy
============================================================
*/

// Your Render backend (no trailing slash)
const ORIGIN = 'https://smart-meter-api-do5b.onrender.com';

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    const allowed = url.pathname.startsWith('/consumer/meter/') || url.pathname === '/health';

    if (!allowed) {
      return jsonResponse(404, { success: false, message: 'Not found' });
    }

    const headers = new Headers();
    headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');
    headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || '');

    const deviceKey = request.headers.get('X-Device-Key');
    if (deviceKey) headers.set('X-Device-Key', deviceKey);

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

    try {
      const upstream = await fetch(ORIGIN + url.pathname + url.search, {
        method: request.method,
        headers,
        body: hasBody ? await request.arrayBuffer() : undefined,
        redirect: 'manual',
      });

      // Buffer the body so the reply has a Content-Length.
      // The SIM900A HTTP client cannot read chunked responses.
      const body = await upstream.arrayBuffer();

      return new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
          'Content-Length': String(body.byteLength),
        },
      });
    }
    catch (error) {
      return jsonResponse(502, { success: false, message: 'Backend unreachable' });
    }
  },
};
