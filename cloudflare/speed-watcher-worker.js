/**
 * Speed Watcher — Cloudflare Worker (cron-driven)
 *
 * Polls GPS providers every 2 min, alerts via existing notify worker
 * (/notify/send) when a vehicle's reported speed exceeds threshold.
 *
 * Alert policy:
 *   - threshold default 130 km/h (admin override via settings.SPEED_THRESHOLD_KMH)
 *   - max 2 alerts per continuous over-speed event
 *   - reset when speed drops back to <= threshold (state cleared)
 *   - cron interval 2 min → ~2-4 min between the two alerts of an event
 *
 * KV layout (SPEED_WATCH_KV):
 *   key   = "v:<deviceId>"
 *   value = { eventStart: ISO, alertCount: 1|2, lastSpeed: number, lastUpdated: ISO }
 *   ttl   = 6h (cleanup if vehicle stops reporting)
 *
 * Notify payload — unique case_id per alert avoids notify-worker debounce:
 *   case_id    = `speed:<deviceId>:<eventStartUnix>:<alertN>`
 *   alert_type = "SPEED_OVER"
 *
 * Manual trigger for testing:
 *   GET https://speed-watcher.<acct>.workers.dev/run?dry=1
 *   GET https://speed-watcher.<acct>.workers.dev/run            (live)
 */

const KV_TTL_SECONDS = 6 * 3600;
const FETCH_TIMEOUT_MS = 8000;

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCycle(env, { dry: false }));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Auth gate — all HTTP-triggered routes require Authorization: Bearer <WORKER_SECRET>.
    // The cron path (scheduled) never passes through here; only manual/admin HTTP calls do.
    // NOTE: String comparison is not constant-time in JS; for production hardening use
    //       Web Crypto HMAC or a timing-safe helper (future improvement).
    if (!env.WORKER_SECRET) {
      return jsonResponse({ error: 'Worker misconfigured: WORKER_SECRET not set' }, 500);
    }
    const auth = request.headers.get('Authorization') || '';
    const expected = 'Bearer ' + env.WORKER_SECRET;
    if (auth !== expected) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    if (url.pathname === '/run') {
      const dry = url.searchParams.get('dry') === '1';
      const result = await runCycle(env, { dry });
      return jsonResponse(result);
    }
    if (url.pathname === '/state') {
      // Debug: list current KV entries
      const list = await env.SPEED_WATCH_KV.list({ prefix: 'v:' });
      const out = [];
      for (const k of list.keys) {
        const v = await env.SPEED_WATCH_KV.get(k.name, 'json');
        out.push({ key: k.name, value: v });
      }
      return jsonResponse({ count: out.length, items: out });
    }
    if (url.pathname === '/clear') {
      const list = await env.SPEED_WATCH_KV.list({ prefix: 'v:' });
      for (const k of list.keys) await env.SPEED_WATCH_KV.delete(k.name);
      return jsonResponse({ ok: true, cleared: list.keys.length });
    }
    if (url.pathname === '/test-alert') {
      // Fire a fake alert through the full notify pipeline — verifies Line+Telegram reach you
      const r = await sendAlert(env, false, {
        vehicleId: 'TEST',
        display: 'รถทดสอบ (test-alert endpoint)',
        speed: 145.0,
        threshold: 130,
        alertN: 1,
        maxN: 2,
        eventStart: Date.now()
      });
      return jsonResponse({ ok: true, fakeAlert: true, result: r });
    }
    return jsonResponse({
      service: 'speed-watcher',
      endpoints: ['/run', '/run?dry=1', '/state', '/clear', '/test-alert'],
      cron: '*/2 * * * *'
    });
  }
};

// =============================================================
// Main cycle
// =============================================================
async function runCycle(env, opts) {
  const dry = !!(opts && opts.dry);
  const startedAt = new Date().toISOString();
  const log = { startedAt, dry, providers: 0, vehicles: 0, overThreshold: 0, alertsSent: 0, alertsSkipped: 0, errors: [] };

  let settings;
  try {
    settings = await loadSettings(env);
  } catch (e) {
    log.errors.push('loadSettings: ' + e.message);
    return log;
  }
  log.settings = settings;

  if (settings.SPEED_WATCH_ENABLED !== 'true' && settings.SPEED_WATCH_ENABLED !== '1') {
    log.disabled = true;
    return log;
  }

  const threshold = parseFloat(settings.SPEED_THRESHOLD_KMH || '130') || 130;
  const maxAlerts = parseInt(settings.SPEED_MAX_ALERTS_PER_EVENT || '2', 10) || 2;
  const allowList = String(settings.SPEED_WATCH_VEHICLES || '').split(',').map(s => s.trim()).filter(Boolean);
  log.threshold = threshold;
  log.maxAlerts = maxAlerts;
  if (allowList.length) log.allowList = allowList;

  let providers, vehicles;
  try {
    [providers, vehicles] = await Promise.all([
      sbSelect(env, 'gps_providers', 'is_active=eq.true'),
      sbSelect(env, 'gps_vehicles',  'select=device_id,nickname,device_name')
    ]);
  } catch (e) {
    log.errors.push('load providers/vehicles: ' + e.message);
    return log;
  }
  log.providers = providers.length;

  // Build deviceId → display name map (use nickname if set, else device_name)
  const nameMap = {};
  for (const v of vehicles) {
    const display = (v.nickname && v.nickname.trim()) || v.device_name || v.device_id;
    nameMap[String(v.device_id)] = display;
  }

  // Per-provider fetch + check
  for (const provider of providers) {
    if (provider.software !== 'cmsv6') {
      log.errors.push('skip provider ' + provider.name + ' — software not supported: ' + provider.software);
      continue;
    }
    try {
      const statuses = await cmsv6Poll(provider, settings);
      log.vehicles += statuses.length;
      for (const s of statuses) {
        if (!s.online) continue;
        const id = String(s.deviceId);
        if (allowList.length && allowList.indexOf(id) === -1) continue;

        const kvKey = 'v:' + id;
        const prev = await env.SPEED_WATCH_KV.get(kvKey, 'json');

        if (s.speed > threshold) {
          log.overThreshold++;
          const display = nameMap[id] || id;
          if (!prev) {
            // New event — alert #1
            const eventStart = Date.now();
            const newState = { eventStart, alertCount: 1, lastSpeed: s.speed, lastUpdated: new Date().toISOString() };
            if (!dry) await env.SPEED_WATCH_KV.put(kvKey, JSON.stringify(newState), { expirationTtl: KV_TTL_SECONDS });
            const r = await sendAlert(env, dry, { vehicleId: id, display, speed: s.speed, threshold, alertN: 1, maxN: maxAlerts, eventStart });
            if (r.sent) log.alertsSent++; else log.alertsSkipped++;
          } else if (prev.alertCount < maxAlerts) {
            const nextN = prev.alertCount + 1;
            const newState = { ...prev, alertCount: nextN, lastSpeed: s.speed, lastUpdated: new Date().toISOString() };
            if (!dry) await env.SPEED_WATCH_KV.put(kvKey, JSON.stringify(newState), { expirationTtl: KV_TTL_SECONDS });
            const r = await sendAlert(env, dry, { vehicleId: id, display, speed: s.speed, threshold, alertN: nextN, maxN: maxAlerts, eventStart: prev.eventStart });
            if (r.sent) log.alertsSent++; else log.alertsSkipped++;
          } else {
            // Already alerted max times this event → silent
            log.alertsSkipped++;
          }
        } else {
          // Speed back to normal — clear event state
          if (prev) {
            if (!dry) await env.SPEED_WATCH_KV.delete(kvKey);
          }
        }
      }
    } catch (e) {
      log.errors.push('provider ' + provider.name + ': ' + e.message);
    }
  }

  log.finishedAt = new Date().toISOString();
  return log;
}

// =============================================================
// CMSV6 adapter — login + getDeviceStatus
// Mirrors browser proxy chain: Synology → Render → GAS → direct.
// (Direct rarely works from CF Workers — provider firewall blocks edge IPs)
// =============================================================
async function cmsv6Poll(provider, settings) {
  const base = String(provider.base_url || '').replace(/\/$/, '');
  if (!base) throw new Error('provider base_url empty');

  const loginPath  = '/StandardApiAction_login.action?account=' +
    encodeURIComponent(provider.account) + '&password=' + encodeURIComponent(provider.password);
  const loginData  = await proxiedFetch(base, loginPath, settings);
  if (loginData.result !== 0 || !loginData.jsession) {
    // Don't leak credentials in error
    throw new Error('cmsv6 login failed (result=' + loginData.result + ')');
  }
  const jsession = loginData.jsession;

  const statusPath = '/StandardApiAction_getDeviceStatus.action?jsession=' + jsession + '&toMap=1&geoaddress=1';
  const data       = await proxiedFetch(base, statusPath, settings);
  const all = data.status || [];

  return all.map(s => ({
    deviceId: String(s.id || s.did),
    speed: (s.sp || 0) / 10,
    online: s.ol === 1,
    address: s.ps || '',
    gpsTime: s.gt || ''
  }));
}

// Try proxy chain: Synology (path-rewrite) → Render (?url=) → GAS (?url=) → direct
async function proxiedFetch(base, pathAndQuery, settings) {
  const fullUrl = base + pathAndQuery;
  const tiers = [];

  if (settings.GPS_PROXY_SYNOLOGY) {
    tiers.push({
      name: 'synology',
      url: settings.GPS_PROXY_SYNOLOGY.replace(/\/+$/, '') + pathAndQuery + (pathAndQuery.indexOf('?') >= 0 ? '&' : '?') + '_t=' + Date.now()
    });
  }
  if (settings.GPS_PROXY_RENDER) {
    tiers.push({
      name: 'render',
      url: settings.GPS_PROXY_RENDER.replace(/\/+$/, '') + '/?url=' + encodeURIComponent(fullUrl)
    });
  }
  if (settings.GPS_PROXY_GAS) {
    tiers.push({
      name: 'gas',
      url: settings.GPS_PROXY_GAS + (settings.GPS_PROXY_GAS.indexOf('?') >= 0 ? '&' : '?') + 'url=' + encodeURIComponent(fullUrl)
    });
  }
  tiers.push({ name: 'direct', url: fullUrl });

  let lastErr = null;
  for (const tier of tiers) {
    try {
      const resp = await fetchWithTimeout(tier.url, { headers: { 'User-Agent': 'speed-watcher/1.0' } });
      if (!resp.ok) { lastErr = 'tier ' + tier.name + ' HTTP ' + resp.status; continue; }
      const j = await resp.json();
      return j;
    } catch (e) {
      lastErr = 'tier ' + tier.name + ': ' + e.message;
    }
  }
  throw new Error('all proxy tiers failed — last: ' + lastErr);
}

// =============================================================
// Notify — sends via existing /notify/send route
// =============================================================
async function sendAlert(env, dry, info) {
  // Unique case_id per alert → avoids notify worker's debounce-on-unacked
  const eventUnix = Math.floor(info.eventStart / 1000);
  const caseId = `speed:${info.vehicleId}:${eventUnix}:${info.alertN}`;
  const speedStr = info.speed.toFixed(1);
  const message =
    `🚨 ความเร็วเกินกำหนด (${info.alertN}/${info.maxN})\n` +
    `รถ: ${info.display}\n` +
    `ความเร็ว: ${speedStr} km/h (เกิน ${info.threshold})\n` +
    `เวลา: ${formatThaiTime(new Date())}`;

  if (dry) {
    return { sent: false, dry: true, caseId, message };
  }

  try {
    // Use Service Binding (env.NOTIFY) — worker-to-worker via internal CF mesh.
    // Public workers.dev URL would return CF 1042 (worker-to-worker via public URL is blocked).
    const req = new Request('https://internal/notify/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        case_id: caseId,
        alert_type: 'SPEED_OVER',
        message,
        deep_link: ''
      })
    });
    const resp = await env.NOTIFY.fetch(req);
    const text = await resp.text();
    let j = {};
    try { j = JSON.parse(text); } catch(_) {}
    return { sent: !!j.ok && !j.skipped, status: resp.status, response: j, rawBody: text.slice(0, 300) };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

// =============================================================
// Supabase REST helpers
// =============================================================
async function loadSettings(env) {
  const keys = [
    'SPEED_WATCH_ENABLED',
    'SPEED_THRESHOLD_KMH',
    'SPEED_MAX_ALERTS_PER_EVENT',
    'SPEED_WATCH_VEHICLES',
    'GPS_PROXY_SYNOLOGY',
    'GPS_PROXY_RENDER',
    'GPS_PROXY_GAS'
  ];
  const filter = 'key=in.(' + keys.map(encodeURIComponent).join(',') + ')';
  const rows = await sbSelect(env, 'settings', filter);
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  // Defaults
  if (!('SPEED_WATCH_ENABLED' in out))           out.SPEED_WATCH_ENABLED = 'true';
  if (!('SPEED_THRESHOLD_KMH' in out))           out.SPEED_THRESHOLD_KMH = '130';
  if (!('SPEED_MAX_ALERTS_PER_EVENT' in out))    out.SPEED_MAX_ALERTS_PER_EVENT = '2';
  if (!('SPEED_WATCH_VEHICLES' in out))          out.SPEED_WATCH_VEHICLES = '';
  return out;
}

async function sbSelect(env, table, filter) {
  const url = env.SUPABASE_URL + '/rest/v1/' + table + '?' + (filter || 'select=*');
  const resp = await fetchWithTimeout(url, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + env.SUPABASE_ANON_KEY,
      Accept: 'application/json'
    }
  });
  if (!resp.ok) throw new Error('Supabase ' + table + ' ' + resp.status + ' ' + (await resp.text()).slice(0, 200));
  return await resp.json();
}

// =============================================================
// Fetch helpers
// =============================================================
async function fetchJson(url) {
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) throw new Error('HTTP ' + resp.status + ' for ' + url);
  return await resp.json();
}

async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...(opts || {}), signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function formatThaiTime(d) {
  // Bangkok time, HH:mm DD/MM/YYYY
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit', minute: '2-digit',
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
  return fmt.format(d).replace(',', '');
}
