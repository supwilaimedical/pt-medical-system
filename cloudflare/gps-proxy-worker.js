/**
 * GPS Proxy — Cloudflare Worker
 * แก้ปัญหา Mixed Content (HTTPS → HTTP)
 */

export default {
  async fetch(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      const reqUrl = new URL(request.url);
      const targetUrl = reqUrl.searchParams.get('url');

      if (!targetUrl) {
        return jsonResponse({ error: 'Missing "url" parameter', hint: 'Use ?url=http://...' }, 400);
      }

      // Security: only allow CMSV6 API endpoints
      if (!isAllowedUrl(targetUrl)) {
        return jsonResponse({ error: 'URL not allowed', received: targetUrl }, 403);
      }

      // Forward request to CMSV6
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: { 'User-Agent': 'GPS-Proxy/1.0' },
        redirect: 'follow'
      });

      const text = await response.text();

      // Try to parse as JSON, if not return as-is wrapped in JSON
      try {
        JSON.parse(text);
        // Valid JSON — return directly
        return new Response(text, {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders() }
        });
      } catch (e) {
        // Not JSON — wrap in error object
        return jsonResponse({ error: 'Non-JSON response from API', raw: text }, 200);
      }

    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }
};

function isAllowedUrl(url) {
  // Allow any StandardApiAction on CMSV6 servers
  if (url.includes('StandardApiAction')) return true;
  return false;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}
