/**
 * Multi-purpose Worker — OCR Proxy + Notification Sender
 * Routes:
 *   /                — OCR (Gemini) — POST {image, prompt}; GET = health
 *   /notify/health   — GET  → { ok, hasLine, hasTelegram, hasSupabase }
 *   /notify/check    — POST (Supabase DB Webhook) — auto-detect critical + fire
 *   /notify/send     — POST {case_id, alert_type, message, deep_link?, severity?}
 *                      → manual trigger (debounced via notification_state)
 *   /notify/test     — POST {channel, message, target?} → single send, no state
 *
 * Secrets (wrangler secret put …):
 *   GEMINI_API_KEY          — existing
 *   LINE_ACCESS_TOKEN       — Line OA Messaging API channel token
 *   TELEGRAM_BOT_TOKEN      — Telegram bot token from @BotFather
 *   SUPABASE_URL            — same as frontend SUPABASE_URL
 *   SUPABASE_SERVICE_KEY    — service_role key (bypasses RLS)
 *   PUBLIC_BASE_URL         — https://site.github.io/pt-medical-system (for deep links)
 *
 * Vars:
 *   ALLOWED_ORIGINS         — CSV; empty = allow all
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request, env) });
    }

    if (path.startsWith('/notify')) {
      // /notify/check — Supabase DB webhook (server-to-server).
      // Must carry Authorization: Bearer <WEBHOOK_SECRET> — reject anything else early,
      // before body parsing or expensive Supabase work.
      // NOTE: String comparison is not constant-time in JS; for production hardening use
      //       Web Crypto HMAC or a timing-safe helper (future improvement).
      if (path === '/notify/check') {
        if (!env.WEBHOOK_SECRET) {
          return new Response('Worker misconfigured: WEBHOOK_SECRET not set', { status: 500 });
        }
        const auth = request.headers.get('Authorization') || '';
        const expected = 'Bearer ' + env.WEBHOOK_SECRET;
        if (auth !== expected) {
          return new Response('Unauthorized', { status: 401 });
        }
      }

      // Other /notify/* routes are called by browser clients — check CORS origin.
      const isServerToServer = path === '/notify/check';
      if (!isServerToServer) {
        const origin = request.headers.get('origin') || '';
        if (!isAllowedOrigin(origin, env)) {
          return jsonResponse({ error: 'Origin not allowed', origin }, 403, request, env);
        }
      }

      if (path === '/notify/health' && request.method === 'GET') {
        return jsonResponse({
          ok: true, service: 'notify',
          hasLine:     !!env.LINE_ACCESS_TOKEN,
          hasTelegram: !!env.TELEGRAM_BOT_TOKEN,
          hasSupabase: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY)
        }, 200, request, env);
      }
      if (path === '/notify/check' && request.method === 'POST') return await handleNotifyCheck(request, env);
      if (path === '/notify/send'  && request.method === 'POST') return await handleNotifySend(request, env);
      if (path === '/notify/test'  && request.method === 'POST') return await handleNotifyTest(request, env);
      return jsonResponse({ error: 'Unknown /notify route', path }, 404, request, env);
    }

    // Google Cloud Monitoring API proxy — for admin quota dashboard.
    // Requires GOOGLE_SA_JSON env secret (service account JSON key).
    // PROTOTYPE — not yet wired into admin UI. Test endpoint to verify CF Worker
    // can authenticate to Google APIs via JWT + OAuth.
    if (path === '/api/quota/google' && request.method === 'GET') {
      return await handleGoogleQuota(request, env);
    }

    // GPS Shared Link — live ETA via Distance Matrix (cached on token row)
    // Spec: docs/superpowers/specs/2026-05-26-gps-shared-eta-design.md §8
    if (path === '/api/eta/refresh' && request.method === 'GET') {
      return await handleEtaRefresh(request, env);
    }

    return await handleOcr(request, env);
  }
};

// =============================================
// /api/quota/google — Google Cloud Monitoring proxy
// =============================================
async function handleGoogleQuota(request, env) {
  if (!env.GOOGLE_SA_JSON) {
    return jsonResponse({
      error: 'GOOGLE_SA_JSON env secret not set',
      hint: 'wrangler secret put GOOGLE_SA_JSON  → paste service account JSON'
    }, 500, request, env);
  }

  let sa;
  try {
    sa = JSON.parse(env.GOOGLE_SA_JSON);
  } catch (e) {
    return jsonResponse({ error: 'GOOGLE_SA_JSON is not valid JSON', detail: e.message }, 500, request, env);
  }

  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    return jsonResponse({
      error: 'Service account JSON missing required fields',
      need: ['client_email', 'private_key', 'project_id'],
      got: Object.keys(sa)
    }, 500, request, env);
  }

  try {
    // Step 1: Sign JWT
    const jwt = await signServiceAccountJWT(sa);

    // Step 2: Exchange JWT for OAuth access token
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + encodeURIComponent(jwt)
    });
    const tokenJson = await tokenResp.json();
    if (!tokenJson.access_token) {
      return jsonResponse({ error: 'OAuth token exchange failed', detail: tokenJson }, 500, request, env);
    }

    // Step 3: Query Cloud Monitoring API for current-month Maps Platform usage
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const startIso = startOfMonth.toISOString();
    const endIso = new Date().toISOString();

    // Metric: serviceruntime.googleapis.com/api/request_count
    // Filter: only Maps Platform services
    const filter = 'metric.type="serviceruntime.googleapis.com/api/request_count" AND ' +
                   'resource.type="consumed_api" AND ' +
                   'resource.label.service=monitoring.regex.full_match("(maps-backend|distance-matrix-backend|directions-backend|geocoding-backend|places-backend|places).googleapis.com")';

    const params = new URLSearchParams({
      filter: filter,
      'interval.startTime': startIso,
      'interval.endTime': endIso,
      'aggregation.alignmentPeriod': '2592000s',  // 30 days
      'aggregation.perSeriesAligner': 'ALIGN_SUM',
      'aggregation.crossSeriesReducer': 'REDUCE_SUM',
      'aggregation.groupByFields': 'resource.label.service'
    });

    const url = 'https://monitoring.googleapis.com/v3/projects/' + sa.project_id +
                '/timeSeries?' + params.toString();

    const monResp = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + tokenJson.access_token }
    });
    const monJson = await monResp.json();

    if (!monResp.ok) {
      return jsonResponse({
        error: 'Monitoring API call failed',
        status: monResp.status,
        detail: monJson
      }, 502, request, env);
    }

    // Parse: extract { service: count } map
    const usage = {};
    if (monJson.timeSeries) {
      for (const ts of monJson.timeSeries) {
        const svc = (ts.resource && ts.resource.labels && ts.resource.labels.service) || 'unknown';
        const total = (ts.points || []).reduce(function(sum, p) {
          return sum + Number((p.value && p.value.int64Value) || (p.value && p.value.doubleValue) || 0);
        }, 0);
        usage[svc] = (usage[svc] || 0) + total;
      }
    }

    return jsonResponse({
      ok: true,
      project_id: sa.project_id,
      month_start: startIso,
      month_end: endIso,
      usage_by_service: usage,
      total_calls: Object.values(usage).reduce(function(s, n) { return s + n; }, 0),
      raw_series_count: (monJson.timeSeries || []).length
    }, 200, request, env);

  } catch (e) {
    return jsonResponse({ error: 'handleGoogleQuota failed', detail: String(e && e.message || e), stack: String(e && e.stack || '') }, 500, request, env);
  }
}

// JWT signing for Google service account (RS256).
// Uses Web Crypto API (available in CF Workers + modern browsers).
async function signServiceAccountJWT(sa) {
  const header = { alg: 'RS256', typ: 'JWT', kid: sa.private_key_id };
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss:   sa.client_email,
    scope: 'https://www.googleapis.com/auth/monitoring.read',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedClaims = base64UrlEncode(JSON.stringify(claims));
  const signingInput  = encodedHeader + '.' + encodedClaims;

  // Import PEM-encoded private key
  const pem = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '')
                            .replace(/-----END PRIVATE KEY-----/, '')
                            .replace(/\s+/g, '');
  const keyData = Uint8Array.from(atob(pem), function(c) { return c.charCodeAt(0); });

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  return signingInput + '.' + base64UrlEncode(new Uint8Array(signature));
}

function base64UrlEncode(input) {
  let str;
  if (typeof input === 'string') {
    str = btoa(input);
  } else {
    // Uint8Array or ArrayBuffer
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    str = btoa(bin);
  }
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// =============================================
// /notify/check — Supabase Database Webhook entry
// Payload: { type:'INSERT'|'UPDATE', table, record, old_record? }
// =============================================
async function handleNotifyCheck(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: 'Worker missing SUPABASE_URL / SUPABASE_SERVICE_KEY' }, 500, request, env);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env); }

  const rec = body.record || body.new || body;
  if (!rec || !rec.case_id) {
    return jsonResponse({ ok: true, skipped: 'no case_id in payload' }, 200, request, env);
  }

  // Skip if raw_data identical to old (pure metadata update — no vitals change)
  const oldRec = body.old_record || body.old || null;
  if (oldRec && JSON.stringify(oldRec.raw_data || {}) === JSON.stringify(rec.raw_data || {})) {
    return jsonResponse({ ok: true, skipped: 'raw_data unchanged' }, 200, request, env);
  }

  const detected = detectCritical(rec);
  if (!detected.critical) {
    return jsonResponse({ ok: true, skipped: 'not critical' }, 200, request, env);
  }

  // Load state + decide
  const stateRows = await sbSelect(env, 'notification_state',
    `case_id=eq.${encodeURIComponent(rec.case_id)}&alert_type=eq.CRITICAL`);
  const state = stateRows && stateRows[0];

  let decision = 'send';
  let reason = 'first send';
  if (state) {
    if (state.acknowledged === true) {
      decision = 'send'; reason = 'refire after ack';
    } else {
      const diff = compareSeverity(state.last_payload && state.last_payload.severity, detected.severity);
      if (diff.worse) { decision = 'send'; reason = diff.reason; }
      else { decision = 'skip'; reason = diff.reason; }
    }
  }

  if (decision === 'skip') {
    await sbInsert(env, 'notification_log', [{
      case_id: rec.case_id, alert_type: 'CRITICAL', channel: 'all', status: 'skipped',
      error: reason, payload: { severity: detected.severity, alerts: detected.alerts }
    }]);
    return jsonResponse({ ok: true, skipped: reason }, 200, request, env);
  }

  // Compose message
  const msg = composeCriticalMessage(rec, detected);
  const baseUrl = (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const deepLink = baseUrl ? `${baseUrl}/monitor/?case=${encodeURIComponent(rec.case_id)}` : '';
  const fullText = deepLink ? `${msg}\n${deepLink}` : msg;

  // Pull channel settings
  const settings = await loadNotifySettings(env);
  const results = [];
  if (settings.NOTIFY_LINE_ENABLED === 'true' && env.LINE_ACCESS_TOKEN) {
    const r = await sendLine(env, settings, fullText);
    results.push({ channel: 'line', ...r });
  }
  if (settings.NOTIFY_TELEGRAM_ENABLED === 'true' && env.TELEGRAM_BOT_TOKEN && settings.NOTIFY_TELEGRAM_CHAT_ID) {
    const r = await sendTelegram(env, settings.NOTIFY_TELEGRAM_CHAT_ID, fullText);
    results.push({ channel: 'telegram', ...r });
  }

  if (results.length > 0) {
    await sbInsert(env, 'notification_log', results.map(r => ({
      case_id: rec.case_id, alert_type: 'CRITICAL',
      channel: r.channel,
      status:  r.ok ? 'sent' : 'failed',
      error:   r.ok ? reason : (r.error || 'unknown'),
      payload: { message: fullText, severity: detected.severity, alerts: detected.alerts }
    })));
  }

  await sbUpsert(env, 'notification_state', [{
    case_id: rec.case_id, alert_type: 'CRITICAL',
    first_sent_at: new Date().toISOString(),
    acknowledged: false,
    acknowledged_at: null,
    acknowledged_by: null,
    last_payload: { severity: detected.severity, alerts: detected.alerts, at: new Date().toISOString() }
  }], 'case_id,alert_type');

  if (Math.random() < 0.05) {
    await sbRpc(env, 'notification_log_cleanup').catch(() => {});
  }

  return jsonResponse({ ok: true, sent: results, reason }, 200, request, env);
}

// =============================================
// Critical detection (port from monitor_checkCritical)
// =============================================
function detectCritical(row) {
  const snap = safeParseJSON(row.raw_data && row.raw_data.rawSnapshot) || {};
  const vArr = safeParseJSON(row.raw_data && row.raw_data.vitalsJson) || [];

  let hasArrest = false;
  for (const v of vArr) {
    if (v.type === 'arrest' && v.arrest_outcome !== 'ROSC' && v.arrest_outcome !== 'Terminate CPR' && v.arrest_outcome !== 'Dead') { hasArrest = true; break; }
  }
  if (!hasArrest && (snap['circ_arrest'] || snap['arrest_pre_arrest'])) hasArrest = true;

  // Latest non-arrest vitals: merge latest vArr entry over initial (per-field, non-empty wins)
  const initVs = {
    bp:    snap['init_bp']   || '',
    pr:    snap['init_pr']   || '',
    rr:    snap['init_rr']   || '',
    spo2:  snap['init_spo2'] || '',
    gcs_e: snap['gcs_e'] || '',
    gcs_v: snap['gcs_v'] || '',
    gcs_m: snap['gcs_m'] || ''
  };
  let latestLog = null;
  for (let i = vArr.length - 1; i >= 0; i--) {
    if (vArr[i].type !== 'arrest') { latestLog = vArr[i]; break; }
  }
  const pick = (k) => (latestLog && latestLog[k] != null && latestLog[k] !== '') ? latestLog[k] : initVs[k];
  const vs = {
    bp:    pick('bp'),
    pr:    pick('pr'),
    rr:    pick('rr'),
    spo2:  pick('spo2'),
    gcs_e: pick('gcs_e'),
    gcs_v: pick('gcs_v'),
    gcs_m: pick('gcs_m')
  };

  const toInt = s => { const n = parseInt(s, 10); return isNaN(n) ? null : n; };
  const alerts = [];
  const severity = {};

  if (hasArrest) { alerts.push({ type: 'ARREST', label: 'Cardiac Arrest' }); severity.arrest = true; }

  const spo2 = toInt(vs.spo2);
  if (spo2 !== null) { severity.spo2 = spo2; if (spo2 < 90) alerts.push({ type: 'SPO2_LOW', label: `SpO2 ${spo2}%` }); }

  const pr = toInt(vs.pr);
  if (pr !== null) { severity.hr = pr; if (pr < 50 || pr > 140) alerts.push({ type: 'HR_ABNORMAL', label: `HR ${pr}` }); }

  const rr = toInt(vs.rr);
  if (rr !== null) { severity.rr = rr; if (rr < 10 || rr > 30) alerts.push({ type: 'RR_ABNORMAL', label: `RR ${rr}` }); }

  if (vs.bp && /^(\d+)\s*\/\s*(\d+)$/.test(String(vs.bp).trim())) {
    const m = String(vs.bp).trim().match(/^(\d+)\s*\/\s*(\d+)$/);
    const sbp = parseInt(m[1], 10);
    severity.bp_sbp = sbp; severity.bp_raw = vs.bp;
    if (sbp < 90 || sbp > 200) alerts.push({ type: 'BP_ABNORMAL', label: `BP ${vs.bp}` });
  }

  const ge = toInt(vs.gcs_e), gm = toInt(vs.gcs_m);
  const gv = vs.gcs_v === 'VT' ? 1 : toInt(vs.gcs_v);
  if (ge !== null && gv !== null && gm !== null) {
    const total = ge + gv + gm;
    severity.gcs = total;
    if (total < 8) alerts.push({ type: 'GCS_LOW', label: `GCS ${total}` });
  }

  return { critical: alerts.length > 0, alerts, severity };
}

// =============================================
// Severity compare — is new worse than old?
// =============================================
function compareSeverity(oldSev, newSev) {
  if (!oldSev) return { worse: true, reason: 'no previous severity' };

  // New arrest that wasn't there before
  if (newSev.arrest && !oldSev.arrest) return { worse: true, reason: 'arrest new' };

  // Helpers: distance from normal range (0 = inside normal)
  const distHR   = v => (v == null ? 0 : v < 50  ? 50 - v  : v > 140 ? v - 140 : 0);
  const distRR   = v => (v == null ? 0 : v < 10  ? 10 - v  : v > 30  ? v - 30  : 0);
  const distSpO2 = v => (v == null ? 0 : v < 90  ? 90 - v  : 0);
  const distBP   = v => (v == null ? 0 : v < 90  ? 90 - v  : v > 200 ? v - 200 : 0);
  const distGCS  = v => (v == null ? 0 : v < 8   ? 8 - v   : 0);

  const pairs = [
    ['HR',   distHR(oldSev.hr),     distHR(newSev.hr)],
    ['RR',   distRR(oldSev.rr),     distRR(newSev.rr)],
    ['SpO2', distSpO2(oldSev.spo2), distSpO2(newSev.spo2)],
    ['BP',   distBP(oldSev.bp_sbp), distBP(newSev.bp_sbp)],
    ['GCS',  distGCS(oldSev.gcs),   distGCS(newSev.gcs)]
  ];
  for (const [name, od, nd] of pairs) {
    if (nd > od && nd > 0) return { worse: true, reason: `${name} worse (${od} → ${nd})` };
    if (od === 0 && nd > 0) return { worse: true, reason: `${name} new alert` };
  }
  return { worse: false, reason: 'same or better' };
}

// =============================================
// Compose Line/TG message (merged, per-case)
// =============================================
function composeCriticalMessage(rec, detected) {
  const pi = rec.patient_info || {};
  const op = rec.op_info || {};
  const shortId = (rec.case_id || '').replace('CASE-', '');
  const alertList = detected.alerts.map(a => a.label).join(' · ');
  return [
    `🚨 CRITICAL — #${shortId}`,
    `ผู้ป่วย: ${pi.name || 'ไม่ระบุ'} (${pi.age || '-'} ปี)`,
    `จาก: ${pi.origin || '-'} → ${pi.destination || '-'}`,
    `รถ: ${op.level || '-'} / ${op.unitNo || '-'}`,
    `⚠️ ${alertList}`
  ].join('\n');
}

function safeParseJSON(v) {
  if (!v) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
}

// =============================================
// /notify/send — manual trigger (back-compat, simpler)
// =============================================
async function handleNotifySend(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: 'Worker missing SUPABASE_URL / SUPABASE_SERVICE_KEY' }, 500, request, env);
  }
  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env); }

  const caseId    = String(body.case_id    || '').trim();
  const alertType = String(body.alert_type || '').trim();
  const message   = String(body.message    || '').trim();
  const deepLink  = String(body.deep_link  || '').trim();
  if (!caseId || !alertType || !message) {
    return jsonResponse({ error: 'case_id, alert_type, message required' }, 400, request, env);
  }

  const stateRows = await sbSelect(env, 'notification_state',
    `case_id=eq.${encodeURIComponent(caseId)}&alert_type=eq.${encodeURIComponent(alertType)}`);
  const state = stateRows && stateRows[0];
  if (state && state.acknowledged === false) {
    await sbInsert(env, 'notification_log', [{
      case_id: caseId, alert_type: alertType, channel: 'all', status: 'skipped',
      error: 'debounced (not yet acked)', payload: { message }
    }]);
    return jsonResponse({ ok: true, skipped: true, reason: 'debounced' }, 200, request, env);
  }

  const settings = await loadNotifySettings(env);
  const fullText = deepLink ? `${message}\n${deepLink}` : message;
  const results = [];
  if (settings.NOTIFY_LINE_ENABLED === 'true' && env.LINE_ACCESS_TOKEN) {
    results.push({ channel: 'line', ...(await sendLine(env, settings, fullText)) });
  }
  if (settings.NOTIFY_TELEGRAM_ENABLED === 'true' && env.TELEGRAM_BOT_TOKEN && settings.NOTIFY_TELEGRAM_CHAT_ID) {
    results.push({ channel: 'telegram', ...(await sendTelegram(env, settings.NOTIFY_TELEGRAM_CHAT_ID, fullText)) });
  }
  if (results.length > 0) {
    await sbInsert(env, 'notification_log', results.map(r => ({
      case_id: caseId, alert_type: alertType,
      channel: r.channel, status: r.ok ? 'sent' : 'failed',
      error: r.ok ? null : (r.error || 'unknown'),
      payload: { message: fullText }
    })));
  }
  await sbUpsert(env, 'notification_state', [{
    case_id: caseId, alert_type: alertType,
    first_sent_at: new Date().toISOString(),
    acknowledged: false
  }], 'case_id,alert_type');

  return jsonResponse({ ok: true, results }, 200, request, env);
}

// =============================================
// /notify/test — single channel, no state
// =============================================
async function handleNotifyTest(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env); }

  const channel = String(body.channel || '').toLowerCase();
  const message = String(body.message || 'Test from PT Medical System').trim();
  const target  = String(body.target  || '').trim();

  if (channel === 'line') {
    if (!env.LINE_ACCESS_TOKEN) return jsonResponse({ error: 'LINE_ACCESS_TOKEN not set' }, 400, request, env);
    const settings = await loadNotifySettings(env).catch(() => ({}));
    if (target) settings.NOTIFY_LINE_TARGETS = target;
    const r = await sendLine(env, settings, message);
    return jsonResponse(r, r.ok ? 200 : 502, request, env);
  }
  if (channel === 'telegram') {
    if (!env.TELEGRAM_BOT_TOKEN) return jsonResponse({ error: 'TELEGRAM_BOT_TOKEN not set' }, 400, request, env);
    const chatId = target || (await loadNotifySettings(env).catch(() => ({}))).NOTIFY_TELEGRAM_CHAT_ID;
    if (!chatId) return jsonResponse({ error: 'No chat_id' }, 400, request, env);
    const r = await sendTelegram(env, chatId, message);
    return jsonResponse(r, r.ok ? 200 : 502, request, env);
  }
  return jsonResponse({ error: 'channel must be "line" or "telegram"' }, 400, request, env);
}

// =============================================
// Channel senders
// =============================================
async function sendLine(env, settings, text) {
  const targetType = (settings.NOTIFY_LINE_TARGET_TYPE || 'broadcast').trim();
  const targetsRaw = (settings.NOTIFY_LINE_TARGETS || '').trim();
  let url, payload;
  const messages = [{ type: 'text', text: text.slice(0, 5000) }];
  if (targetType === 'broadcast') {
    url = 'https://api.line.me/v2/bot/message/broadcast';
    payload = { messages };
  } else {
    let ids;
    try { ids = targetsRaw.startsWith('[') ? JSON.parse(targetsRaw) : [targetsRaw]; }
    catch { ids = [targetsRaw]; }
    ids = ids.filter(Boolean);
    if (ids.length === 0) return { ok: false, error: 'No Line targets configured' };
    if (targetType === 'group' && ids.length === 1) {
      url = 'https://api.line.me/v2/bot/message/push';
      payload = { to: ids[0], messages };
    } else {
      url = 'https://api.line.me/v2/bot/message/multicast';
      payload = { to: ids, messages };
    }
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.LINE_ACCESS_TOKEN}` },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) { const t = await resp.text(); return { ok: false, error: `Line ${resp.status}: ${t.slice(0, 300)}` }; }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function sendTelegram(env, chatId, text) {
  try {
    const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: false })
    });
    if (!resp.ok) { const t = await resp.text(); return { ok: false, error: `Telegram ${resp.status}: ${t.slice(0, 300)}` }; }
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// =============================================
// Supabase REST helpers
// =============================================
async function loadNotifySettings(env) {
  const keys = ['NOTIFY_LINE_ENABLED', 'NOTIFY_LINE_TARGET_TYPE', 'NOTIFY_LINE_TARGETS', 'NOTIFY_TELEGRAM_ENABLED', 'NOTIFY_TELEGRAM_CHAT_ID'];
  const inList = keys.map(k => `"${k}"`).join(',');
  const rows = await sbSelect(env, 'settings', `key=in.(${inList})`);
  const out = {};
  (rows || []).forEach(r => { out[r.key] = r.value; });
  return out;
}
async function sbSelect(env, table, query) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders(env) });
  if (!resp.ok) throw new Error(`sbSelect ${table}: ${resp.status} ${await resp.text()}`);
  return await resp.json();
}
async function sbInsert(env, table, rows) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbHeaders(env), 'Prefer': 'return=minimal' },
    body: JSON.stringify(rows)
  });
  if (!resp.ok) throw new Error(`sbInsert ${table}: ${resp.status} ${await resp.text()}`);
}
async function sbUpsert(env, table, rows, onConflict) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...sbHeaders(env), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows)
  });
  if (!resp.ok) throw new Error(`sbUpsert ${table}: ${resp.status} ${await resp.text()}`);
}
async function sbRpc(env, fn, params) {
  const resp = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...sbHeaders(env), 'Prefer': 'return=minimal' },
    body: JSON.stringify(params || {})
  });
  if (!resp.ok) throw new Error(`sbRpc ${fn}: ${resp.status}`);
}
function sbHeaders(env) {
  return {
    'apikey':        env.SUPABASE_SERVICE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    'Content-Type':  'application/json'
  };
}

// =============================================
// OCR
// =============================================
async function handleOcr(request, env) {
  if (request.method === 'GET') {
    return jsonResponse({ ok: true, service: 'ocr-proxy', hasKey: !!env.GEMINI_API_KEY, note: 'POST with {image, prompt} for OCR' }, 200, request, env);
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed. Use POST.' }, 405, request, env);
  if (!env.GEMINI_API_KEY) return jsonResponse({ error: 'Server not configured: missing GEMINI_API_KEY secret' }, 500, request, env);
  try {
    const url = new URL(request.url);
    const model = url.searchParams.get('model') || 'gemini-2.5-pro';
    const allowedModels = ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];
    if (!allowedModels.includes(model)) return jsonResponse({ error: 'Model not allowed', model }, 400, request, env);
    const origin = request.headers.get('origin') || '';
    if (!isAllowedOrigin(origin, env)) return jsonResponse({ error: 'Origin not allowed', origin }, 403, request, env);
    const body = await request.text();
    try {
      const parsed = JSON.parse(body);
      if (!parsed.contents) throw new Error('missing contents');
    } catch (e) { return jsonResponse({ error: 'Invalid request body: ' + e.message }, 400, request, env); }
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
    const resp = await fetch(geminiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const text = await resp.text();
    return new Response(text, { status: resp.status, headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) } });
  } catch (err) { return jsonResponse({ error: err.message }, 500, request, env); }
}

// =============================================
// CORS / response helpers
// =============================================
function isAllowedOrigin(origin, env) {
  if (!env.ALLOWED_ORIGINS || env.ALLOWED_ORIGINS.trim() === '') return true;
  const allowed = env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  return allowed.includes(origin) || allowed.includes('*');
}
function corsHeaders(request, env) {
  const origin = request.headers.get('origin') || '*';
  const allowedOrigin = isAllowedOrigin(origin, env) ? (origin || '*') : 'null';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}
function jsonResponse(data, status, request, env) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) } });
}

// =============================================================================
// GPS Shared Link ETA — /api/eta/refresh
// Returns cached ETA, refreshing via Google Distance Matrix when cooldown
// elapsed. Cache lives on gps_shared_tokens.last_eta_* columns (single SoT).
// Spec: docs/superpowers/specs/2026-05-26-gps-shared-eta-design.md §3,5,6,8
// Requires GOOGLE_MAPS_KEY_SERVER secret (Distance-Matrix-restricted API key).
// AUDIT-OK 2026-05-26: see chat (Phase 1 security-engineer subagent).
// =============================================================================

/**
 * Call Google Distance Matrix API for one origin → one destination.
 * @param {{lat:number,lng:number}} origin
 * @param {{lat:number,lng:number}} dest
 * @param {string} apiKey  Server-restricted Maps API key
 * @returns {Promise<{seconds:number,meters:number}>}
 * @throws Error on HTTP failure, status != OK, or element status != OK
 */
async function callDistanceMatrix(origin, dest, apiKey) {
  const url = 'https://maps.googleapis.com/maps/api/distancematrix/json'
            + '?origins=' + encodeURIComponent(origin.lat + ',' + origin.lng)
            + '&destinations=' + encodeURIComponent(dest.lat + ',' + dest.lng)
            + '&mode=driving'
            + '&departure_time=now'
            + '&language=th'
            + '&key=' + encodeURIComponent(apiKey);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('DistanceMatrix HTTP ' + res.status);
  }
  const j = await res.json();
  if (j.status !== 'OK') {
    throw new Error('DistanceMatrix status: ' + j.status + ' ' + (j.error_message || ''));
  }
  const row = (j.rows && j.rows[0]) || {};
  const el  = (row.elements && row.elements[0]) || {};
  if (el.status !== 'OK') {
    throw new Error('DistanceMatrix element status: ' + el.status);
  }
  // Prefer duration_in_traffic when available (departure_time=now triggers it)
  const dur = el.duration_in_traffic || el.duration || {};
  const dis = el.distance || {};
  return { seconds: dur.value || 0, meters: dis.value || 0 };
}

/**
 * GET /api/eta/refresh?token=TK-XXXXXXXX
 * Returns: { ok, eta_seconds, eta_at, distance_m, fresh, arrived, next_refresh_in }
 *
 * Cadence (spec §6):
 *  - just-locked  → refresh immediately
 *  - moving       (last_distance_m >= 1000 m) → 5 min cooldown
 *  - stopped      (last_distance_m  < 1000 m) → 2 min cooldown
 *  - arrived      (last_distance_m  <  100 m) → return cache (no API call)
 *
 * Race condition (spec §5 H2): we use a simple read-then-write pattern.
 * Worst-case is one duplicate Distance Matrix call per ~5 min if two requests
 * land in the ~50 ms window. Cost is bounded and acceptable; explicit FOR
 * UPDATE NOWAIT was considered but adds PG transaction complexity for
 * negligible savings.
 */
async function handleEtaRefresh(request, env) {
  const url = new URL(request.url);
  const token = (url.searchParams.get('token') || '').trim();

  if (!token) {
    return jsonResponse({ ok: false, error: 'TOKEN_REQUIRED' }, 400, request, env);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResponse({ ok: false, error: 'WORKER_MISCONFIGURED' }, 500, request, env);
  }
  if (!env.GOOGLE_MAPS_KEY_SERVER) {
    return jsonResponse({ ok: false, error: 'NO_MAPS_KEY' }, 500, request, env);
  }

  // Token validation
  const sbHdrs = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json'
  };
  const tokenUrl = env.SUPABASE_URL + '/rest/v1/gps_shared_tokens'
                 + '?token=eq.' + encodeURIComponent(token) + '&select=*';
  const tRes = await fetch(tokenUrl, { headers: sbHdrs });
  if (!tRes.ok) {
    return jsonResponse({ ok: false, error: 'DB_READ_FAILED', status: tRes.status }, 502, request, env);
  }
  const tokenRows = await tRes.json();
  const row = tokenRows[0];
  if (!row) {
    return jsonResponse({ ok: false, error: 'TOKEN_INVALID' }, 404, request, env);
  }
  if (row.status !== 'Active' || new Date(row.expires_at) < new Date()) {
    return jsonResponse({ ok: false, error: 'TOKEN_INVALID' }, 404, request, env);
  }
  if (!row.dest_locked_at || row.dest_lat == null || row.dest_lng == null) {
    return jsonResponse({ ok: false, error: 'DEST_NOT_LOCKED' }, 409, request, env);
  }

  // Fetch vehicle's current position
  const vehUrl = env.SUPABASE_URL + '/rest/v1/gps_vehicles'
               + '?device_id=eq.' + encodeURIComponent(row.device_id)
               + '&select=device_id,last_lat,last_lng,last_seen_at';
  const vRes = await fetch(vehUrl, { headers: sbHdrs });
  if (!vRes.ok) {
    return jsonResponse({ ok: false, error: 'VEHICLE_READ_FAILED' }, 502, request, env);
  }
  const vehRows = await vRes.json();
  const veh = vehRows[0];
  if (!veh || veh.last_lat == null || veh.last_lng == null) {
    return jsonResponse({ ok: false, error: 'VEHICLE_NO_POSITION' }, 503, request, env);
  }

  // Cadence decision
  const now = Date.now();
  const lastEtaAt = row.last_eta_at ? new Date(row.last_eta_at).getTime() : 0;
  const sinceLastMs = now - lastEtaAt;
  const justLocked = !row.last_eta_at;
  const lastDistM = row.last_distance_m == null ? 99999 : row.last_distance_m;
  const STOPPED_MS = 2 * 60 * 1000;
  const MOVING_MS  = 5 * 60 * 1000;
  const cadenceMs = (lastDistM < 1000) ? STOPPED_MS : MOVING_MS;

  // Arrival short-circuit (no API call)
  if (!justLocked && lastDistM < 100) {
    return jsonResponse({
      ok: true,
      eta_seconds: 0,
      eta_at: row.last_eta_at,
      distance_m: lastDistM,
      fresh: false,
      arrived: true,
      next_refresh_in: Math.max(0, Math.round((STOPPED_MS - sinceLastMs) / 1000))
    }, 200, request, env);
  }

  // Cooldown not met → return cache
  if (!justLocked && sinceLastMs < cadenceMs) {
    return jsonResponse({
      ok: true,
      eta_seconds: row.last_eta_seconds,
      eta_at: row.last_eta_at,
      distance_m: row.last_distance_m,
      fresh: false,
      arrived: false,
      next_refresh_in: Math.max(0, Math.round((cadenceMs - sinceLastMs) / 1000))
    }, 200, request, env);
  }

  // Call Distance Matrix
  let dm;
  try {
    dm = await callDistanceMatrix(
      { lat: veh.last_lat, lng: veh.last_lng },
      { lat: row.dest_lat, lng: row.dest_lng },
      env.GOOGLE_MAPS_KEY_SERVER
    );
  } catch (e) {
    // Soft fallback: return cached value if we have one
    if (row.last_eta_at) {
      return jsonResponse({
        ok: true,
        eta_seconds: row.last_eta_seconds,
        eta_at: row.last_eta_at,
        distance_m: row.last_distance_m,
        fresh: false,
        arrived: false,
        next_refresh_in: 60,
        warning: 'DISTANCE_MATRIX_FAILED: ' + e.message
      }, 200, request, env);
    }
    return jsonResponse({
      ok: false,
      error: 'DISTANCE_MATRIX_FAILED',
      detail: e.message
    }, 503, request, env);
  }

  // Writeback cache
  const nowIso = new Date().toISOString();
  const patchUrl = env.SUPABASE_URL + '/rest/v1/gps_shared_tokens'
                 + '?token=eq.' + encodeURIComponent(token);
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: { ...sbHdrs, Prefer: 'return=minimal' },
    body: JSON.stringify({
      last_eta_seconds: dm.seconds,
      last_eta_at: nowIso,
      last_distance_m: dm.meters
    })
  });

  return jsonResponse({
    ok: true,
    eta_seconds: dm.seconds,
    eta_at: nowIso,
    distance_m: dm.meters,
    fresh: true,
    arrived: dm.meters < 100,
    next_refresh_in: Math.round(cadenceMs / 1000)
  }, 200, request, env);
}
