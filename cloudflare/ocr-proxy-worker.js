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
      if (path === '/notify/quota' && request.method === 'GET')  return await handleNotifyQuota(request, env);
      if (path === '/notify/event' && request.method === 'POST') return await handleNotifyEvent(request, env);
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
      // CORS origin check — only allow calls from configured frontends
      // (audit HIGH finding: scanner from arbitrary origin can drain quota)
      const origin = request.headers.get('origin') || '';
      if (origin && !isAllowedOrigin(origin, env)) {
        return jsonResponse({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403, request, env);
      }
      return await handleEtaRefresh(request, env);
    }

    // GPS Shared Link — Directions route polyline (called once at create + on deviation > 500m)
    if (path === '/api/route/refresh' && request.method === 'GET') {
      const origin = request.headers.get('origin') || '';
      if (origin && !isAllowedOrigin(origin, env)) {
        return jsonResponse({ ok: false, error: 'ORIGIN_NOT_ALLOWED' }, 403, request, env);
      }
      return await handleRouteRefresh(request, env);
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

  const settings = await loadNotifySettings(env);

  // แยกเป็น 2 เลน (2026-07-31) — Arrest มีโควตาของตัวเอง ไม่ถูกเพดานของ critical กลบ
  // PK ของ notification_state คือ (case_id, alert_type) อยู่แล้ว จึงแยกได้โดยไม่ต้องแก้ schema
  const lanes = [
    { type: 'ARREST',   alerts: detected.alerts.filter(a => a.type === 'ARREST') },
    { type: 'CRITICAL', alerts: detected.alerts.filter(a => a.type !== 'ARREST') }
  ].filter(l => l.alerts.length > 0);

  const out = [];
  for (const lane of lanes) {
    out.push(await runNotifyLane(env, settings, rec, lane.type, lane.alerts, detected.severity));
  }

  if (Math.random() < 0.05) {
    await sbRpc(env, 'notification_log_cleanup').catch(() => {});
  }

  return jsonResponse({ ok: true, lanes: out }, 200, request, env);
}

// บันทึก notification_state แบบทนต่อ "ยังไม่ได้รัน migration v3"
//
// sbUpsert โยน error ถ้า schema ไม่มีคอลัมน์ ⇒ ถ้า worker ขึ้นก่อน SQL:
// ส่ง LINE ไปแล้ว → upsert พัง → /notify/check คืน 500 → Supabase DB Webhook retry
// → ส่งซ้ำวนไม่หยุด = เผาโควตาเร็วกว่าเดิมหลายเท่า
// จึงลองแบบเต็มก่อน ถ้าพังค่อยตัดคอลัมน์ใหม่ทิ้งแล้วเขียนแบบเดิม (debounce ยังทำงาน แค่ยังไม่มีเพดาน)
async function upsertNotifyState(env, row) {
  try {
    await sbUpsert(env, 'notification_state', [row], 'case_id,alert_type');
    return true;
  } catch (e) {
    const legacy = { ...row };
    delete legacy.line_sent_count;
    delete legacy.last_sent_at;
    try {
      await sbUpsert(env, 'notification_state', [legacy], 'case_id,alert_type');
      console.warn('[notify] เขียน state แบบเก่า — ยังไม่ได้รัน notifications_v3_percase_cap.sql:', e.message);
      return true;
    } catch (e2) {
      console.error('[notify] เขียน state ไม่ได้เลย — debounce จะไม่ทำงาน:', e2.message);
      return false;
    }
  }
}

// เพดานส่ง LINE ต่อ (เคส × เลน) — ตั้งค่าได้จาก Settings, ค่าเริ่มต้น 2 ตามมติ Pex 2026-07-31
function linePerCaseCap(settings) {
  const raw = parseInt(settings && settings.NOTIFY_LINE_MAX_PER_CASE, 10);
  if (isNaN(raw) || raw < 0) return 2;
  return raw;
}

// =============================================
// ประมวลผลหนึ่งเลน (CRITICAL หรือ ARREST) แยกจากกันคนละ state
//
// เพดานนับเฉพาะ LINE เท่านั้น — Telegram ฟรีและไม่มีโควตา จึงส่งต่อได้เสมอ
// ⇒ ประหยัดโควตา LINE โดยที่การแจ้งเตือนทางคลินิกไม่ขาด ถ้าเปิด Telegram ไว้
// นับเฉพาะครั้งที่ LINE "ส่งสำเร็จจริง" (ล้มเหลว/โดนโควตาบล็อก ไม่กินโควตาของเคส)
// =============================================
async function runNotifyLane(env, settings, rec, laneType, alerts, severity) {
  const stateRows = await sbSelect(env, 'notification_state',
    `case_id=eq.${encodeURIComponent(rec.case_id)}&alert_type=eq.${encodeURIComponent(laneType)}`);
  const state = stateRows && stateRows[0];

  let decision = 'send';
  let reason = 'first send';
  if (state) {
    if (laneType === 'ARREST') {
      // arrest เป็น on/off ไม่มี "ค่าแย่ลง" ให้เทียบ — ส่งซ้ำได้เฉพาะเมื่อมีคนกดรับทราบไปแล้ว
      // (เช่น ROSC แล้ว arrest ซ้ำ) และยังไม่ชนเพดาน
      if (state.acknowledged === true) { reason = 'arrest refire after ack'; }
      else { decision = 'skip'; reason = 'arrest already notified'; }
    } else if (state.acknowledged === true) {
      reason = 'refire after ack';
    } else {
      const diff = compareSeverity(state.last_payload && state.last_payload.severity, severity);
      if (diff.worse) { reason = diff.reason; }
      else { decision = 'skip'; reason = diff.reason; }
    }
  }

  const sentCount = Number((state && state.line_sent_count) || 0);

  if (decision === 'skip') {
    await sbInsert(env, 'notification_log', [{
      case_id: rec.case_id, alert_type: laneType, channel: 'all', status: 'skipped',
      error: reason, payload: { severity, alerts }
    }]).catch(() => {});
    return { lane: laneType, skipped: reason, line_sent_count: sentCount };
  }

  const msg = composeCriticalMessage(rec, alerts, laneType);
  const baseUrl = (env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const deepLink = baseUrl ? `${baseUrl}/monitor/?case=${encodeURIComponent(rec.case_id)}` : '';
  const fullText = deepLink ? `${msg}\n${deepLink}` : msg;

  const cap = linePerCaseCap(settings);
  const results = [];

  if (settings.NOTIFY_LINE_ENABLED === 'true' && env.LINE_ACCESS_TOKEN) {
    if (sentCount >= cap) {
      results.push({ channel: 'line', ok: false, skipped: true,
        error: `LINE_CAP_PER_CASE (${sentCount}/${cap})` });
    } else {
      const guard = await checkLineQuotaGuard(env, laneType);
      if (guard.allow) {
        results.push({ channel: 'line', ...(await sendLine(env, settings, fullText)) });
      } else {
        results.push({ channel: 'line', ok: false, skipped: true, error: guard.reason, quota: guard.quota });
      }
    }
  }
  // Telegram — ไม่มีเพดานต่อเคส (ไม่เสียโควตา) = ตาข่ายรับกรณีที่ LINE ถูกตัด
  if (settings.NOTIFY_TELEGRAM_ENABLED === 'true' && env.TELEGRAM_BOT_TOKEN && settings.NOTIFY_TELEGRAM_CHAT_ID) {
    results.push({ channel: 'telegram', ...(await sendTelegram(env, settings.NOTIFY_TELEGRAM_CHAT_ID, fullText)) });
  }

  const lineSentNow = results.some(r => r.channel === 'line' && r.ok);
  const nowIso = new Date().toISOString();

  // ⚠️ ห้าม throw หลังจากส่งข้อความออกไปแล้วเด็ดขาด
  // /notify/check ถูกเรียกจาก Supabase DB Webhook ซึ่ง retry เมื่อได้ 5xx
  // ⇒ ถ้าเขียน log ล้มแล้วปล่อย throw จะกลายเป็น "ส่งแล้ว → 500 → webhook ยิงซ้ำ → ส่งอีก"
  //   = ลูปแบบเดียวกับที่ทำ Telegram เด้งไม่หยุดเมื่อ 2026-07-31 (คนละที่ บั๊กคลาสเดียวกัน)
  if (results.length > 0) {
    await sbInsert(env, 'notification_log', results.map(r => ({
      case_id: rec.case_id, alert_type: laneType,
      channel: r.channel,
      status:  r.ok ? 'sent' : (r.skipped ? 'skipped' : 'failed'),
      error:   r.ok ? reason : (r.error || 'unknown'),
      payload: { message: fullText, severity, alerts }
    }))).catch((e) => console.error('[notify] เขียน log ไม่ได้ (ไม่ throw กัน webhook retry):', e.message));
  }

  // ⚠️ บันทึก state เฉพาะเมื่อ "ส่งถึงจริงอย่างน้อย 1 ช่อง"
  // ของเดิมบันทึกทุกกรณี ⇒ ถ้าส่งล้มหมด/โดน quota guard บล็อก ระบบยังจำว่า "แจ้งไปแล้ว"
  // ⇒ การอัปเดตครั้งถัดไปที่ความรุนแรงเท่าเดิมจะถูก debounce ทิ้ง = เคสวิกฤตหายถาวร
  // (Codex เจอ 2026-07-31) · ไม่บันทึก = รอบหน้าลองใหม่ ซึ่งเป็นสิ่งที่ควรเป็น
  if (!results.some(r => r.ok)) {
    console.error(`[notify] ${rec.case_id}/${laneType}: ส่งไม่สำเร็จสักช่อง — ไม่บันทึก state เพื่อให้รอบหน้าลองใหม่`);
    return { lane: laneType, reason: reason, sent: results, state_saved: false, cap: cap };
  }

  await upsertNotifyState(env, {
    case_id: rec.case_id, alert_type: laneType,
    // first_sent_at เก็บ "ครั้งแรก" จริงๆ ไม่ทับอีกแล้ว (ของเดิมทับทุกครั้ง = ดูประวัติไม่ได้)
    first_sent_at: (state && state.first_sent_at) ? state.first_sent_at : nowIso,
    last_sent_at: nowIso,
    line_sent_count: sentCount + (lineSentNow ? 1 : 0),
    acknowledged: false,
    acknowledged_at: null,
    acknowledged_by: null,
    last_payload: { severity, alerts, at: nowIso }
  });

  return { lane: laneType, reason, sent: results, line_sent_count: sentCount + (lineSentNow ? 1 : 0), cap };
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
function composeCriticalMessage(rec, alerts, laneType) {
  const pi = rec.patient_info || {};
  const op = rec.op_info || {};
  const shortId = (rec.case_id || '').replace('CASE-', '');
  const alertList = (alerts || []).map(a => a.label).join(' · ');
  const head = laneType === 'ARREST'
    ? `🫀 CARDIAC ARREST — #${shortId}`
    : `🚨 CRITICAL — #${shortId}`;
  return [
    head,
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
  // ต้องมีคีย์ (2026-07-31) — เดิมเปิดโล่ง ใครรู้ URL ก็สั่งส่งข้อความหรือเผาโควตา LINE ได้
  //
  // ⚠️ บทเรียน: ตอนใส่ auth ผมเขียนคอมเมนต์ว่า "ตรวจแล้วไม่มีผู้เรียกจริงสักที่"
  // ซึ่ง **ผิด** — ตรวจแค่ใน supwilaiOS/OS (ที่นั่นมีแต่นิยาม notifyTrigger ไม่มีใครเรียกจริง)
  // แต่ **speed-watcher-worker.js เรียกผ่าน Service Binding** อยู่ ⇒ แจ้งเตือนรถขับเร็วตายเงียบ
  // ⇒ ผู้เรียกจริงตอนนี้: speed-watcher (แนบ key แล้ว) · ถ้าจะเพิ่ม auth ที่ไหนอีก
  //    ต้องค้นทั้ง workspace ไม่ใช่แค่ repo เดียว
  const sendKey = (new URL(request.url).searchParams.get('key') || '').trim();
  const wantKey = (env.EXTERNAL_NOTIFY_KEY || '').trim();
  if (!wantKey || sendKey !== wantKey) {
    return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  }
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
  const sentCount = Number((state && state.line_sent_count) || 0);
  const cap = linePerCaseCap(settings);
  const results = [];
  if (settings.NOTIFY_LINE_ENABLED === 'true' && env.LINE_ACCESS_TOKEN) {
    // เพดานต่อเคสใช้กับเส้นนี้ด้วย ไม่งั้นเรียก /notify/send ตรงๆ ก็ทะลุเพดานได้ (2026-07-31)
    if (sentCount >= cap) {
      results.push({ channel: 'line', ok: false, skipped: true,
        error: `LINE_CAP_PER_CASE (${sentCount}/${cap})` });
    } else {
      // Quota guard — non-CRITICAL (e.g. SPEED_OVER) blocked at >= 95% to preserve last 5%
      const guard = await checkLineQuotaGuard(env, alertType);
      if (guard.allow) {
        results.push({ channel: 'line', ...(await sendLine(env, settings, fullText)) });
      } else {
        results.push({ channel: 'line', ok: false, skipped: true, error: guard.reason, quota: guard.quota });
      }
    }
  }
  if (settings.NOTIFY_TELEGRAM_ENABLED === 'true' && env.TELEGRAM_BOT_TOKEN && settings.NOTIFY_TELEGRAM_CHAT_ID) {
    results.push({ channel: 'telegram', ...(await sendTelegram(env, settings.NOTIFY_TELEGRAM_CHAT_ID, fullText)) });
  }
  if (results.length > 0) {
    // ห้าม throw หลังส่งแล้ว — ผู้เรียกอาจ retry แล้วส่งซ้ำ (ดูคำอธิบายใน runNotifyLane)
    await sbInsert(env, 'notification_log', results.map(r => ({
      case_id: caseId, alert_type: alertType,
      channel: r.channel,
      status: r.ok ? 'sent' : (r.skipped ? 'skipped' : 'failed'),
      error: r.ok ? null : (r.error || 'unknown'),
      payload: { message: fullText }
    }))).catch((e) => console.error('[notify] เขียน log ไม่ได้ (ไม่ throw):', e.message));
  }
  // บันทึก state เฉพาะเมื่อส่งถึงจริงอย่างน้อย 1 ช่อง — เหมือน runNotifyLane
  // ของเดิมบันทึกทุกกรณี ⇒ ส่งล้มหมดแล้วยังจำว่า "แจ้งไปแล้ว" ⇒ ครั้งถัดไปโดน debounce ที่ด้านบน
  // = เคสหายถาวร (Fable ชี้ 2026-07-31 ว่าเป็นบั๊กคลาสเดียวกับที่แก้ใน runNotifyLane ไปแล้ว
  //   และจะกลายเป็นปัญหาจริงทันทีที่ speed alert กลับมาทำงาน)
  if (!results.some(r => r.ok)) {
    console.error(`[notify] ${caseId}/${alertType}: ส่งไม่สำเร็จสักช่อง — ไม่บันทึก state เพื่อให้รอบหน้าลองใหม่`);
    return jsonResponse({ ok: true, results, cap, state_saved: false }, 200, request, env);
  }

  const nowIso = new Date().toISOString();
  await upsertNotifyState(env, {
    case_id: caseId, alert_type: alertType,
    first_sent_at: (state && state.first_sent_at) ? state.first_sent_at : nowIso,
    last_sent_at: nowIso,
    line_sent_count: sentCount + (results.some(r => r.channel === 'line' && r.ok) ? 1 : 0),
    acknowledged: false
  });

  return jsonResponse({ ok: true, results, cap }, 200, request, env);
}

// =============================================
// /notify/event — ประตูกลางสำหรับระบบภายนอกที่ไม่ได้อยู่ใน PT
// =============================================
// เพิ่ม 2026-07-31 ตามที่ Pex ออกแบบ:
//   Google Form → Sheet → Apps Script → ที่นี่ → LINE/Telegram
//
// ทำไมต้องมี: สคริปต์ที่ฝังในชีต (เช็ครถ 6 ใบ + ฟอร์มลาเก่า) เดิม hardcode
// LINE channel token ไว้ในชีตแล้วยิงเองตรงๆ ⇒ (1) ไม่มีใครนับได้ว่ากินโควตาเท่าไหร่
// (2) ใครเปิดชีตก็ก๊อป token ไปยิงในนาม OA บริษัทได้ (3) ไม่มีเพดาน ไม่หลีกทางให้ critical
// ⇒ ย้ายมาเข้าเส้นนี้: token อยู่ที่ worker ที่เดียว · log ลง notification_log ก้อนเดียว
//   กับ critical · และได้ checkLineQuotaGuard ฟรี (งานที่ไม่ใช่ CRITICAL ถูกบล็อกที่ 95%
//   ⇒ เช็ครถหลีกทางให้เคสวิกฤตเองอัตโนมัติ)
//
// body: { source, message, title?, kind? }   kind: 'submit' (ค่าเริ่มต้น) | 'edit'
// auth: ?key= ต้องตรงกับ secret EXTERNAL_NOTIFY_KEY
//       (คีย์นี้แค่ "สั่งส่งเข้ากลุ่มตัวเอง" ได้ ทำอย่างอื่นในนาม OA ไม่ได้ — ต่างจาก channel token)
async function handleNotifyEvent(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResponse({ error: 'Worker missing SUPABASE_URL / SUPABASE_SERVICE_KEY' }, 500, request, env);
  }
  // trim ทั้งสองฝั่ง — ตอน `wrangler secret put` รับค่าทาง pipe บางเชลล์ต่อ \r\n ให้ท้ายค่า
  // แล้วจะเทียบไม่ตรงตลอดกาลโดยหาสาเหตุยาก (เจอจริง 2026-07-31)
  const key = (new URL(request.url).searchParams.get('key') || '').trim();
  const want = (env.EXTERNAL_NOTIFY_KEY || '').trim();
  if (!want || key !== want) {
    return jsonResponse({ error: 'Unauthorized' }, 401, request, env);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: 'Invalid JSON body' }, 400, request, env); }

  const source  = String(body.source  || '').trim().slice(0, 40);
  const message = String(body.message || '').trim();
  const kind    = String(body.kind    || 'submit').trim();
  if (!source || !message) {
    return jsonResponse({ error: 'source, message required' }, 400, request, env);
  }

  const settings = await loadNotifySettings(env);
  const get = (k, dflt) => {
    const v = settings[k];
    return (v === undefined || v === null || v === '') ? dflt : String(v);
  };
  const isOn = (v) => v === 'true' || v === '1';

  const logRow = (status, channel, error, extra) => sbInsert(env, 'notification_log', [{
    case_id: 'ext:' + source, alert_type: 'EXTERNAL', channel, status,
    error: error || null,
    payload: Object.assign({ source, kind, message: message.slice(0, 800) }, extra || {})
  }]).catch(() => {});

  // ปิดทั้ง source ได้ (NOTIFY_EXT_CHECKLIST_ENABLED = 'false')
  if (!isOn(get('NOTIFY_EXT_' + source.toUpperCase() + '_ENABLED', 'true'))) {
    await logRow('skipped', 'all', 'source_disabled');
    return jsonResponse({ ok: true, skipped: 'source_disabled' }, 200, request, env);
  }
  // แจ้งตอน "แก้เซลล์ย้อนหลัง"
  // ⚠️ ค่าเริ่มต้น = 'true' โดยตั้งใจ — งานนี้คือ "ย้ายทางเดิน" ไม่ใช่เปลี่ยนพฤติกรรม
  // ของเดิมยิงทุกการแก้ ถ้าจะปิดต้องเป็นการตัดสินใจของเจ้าของระบบ ตั้ง NOTIFY_EXT_EDIT_ENABLED=false
  if (kind === 'edit' && !isOn(get('NOTIFY_EXT_EDIT_ENABLED', 'true'))) {
    await logRow('skipped', 'all', 'edit_events_disabled');
    return jsonResponse({ ok: true, skipped: 'edit_events_disabled' }, 200, request, env);
  }

  // ช่องทาง: ค่าเริ่มต้น 'both' = "ส่งตามที่เปิดไว้ในหน้า Admin" (มติ Pex 2026-07-31)
  // ⇒ ช่องไหนที่สวิตช์ "เปิดใช้งาน" อยู่ ก็ส่งช่องนั้น ไม่ต้องมีสวิตช์ซ้ำซ้อนอีกชุด
  //   (ด้านล่างเช็ค NOTIFY_LINE_ENABLED / NOTIFY_TELEGRAM_ENABLED อยู่แล้ว)
  // ตั้ง NOTIFY_EXT_CHANNEL=line หรือ telegram เมื่อต้องการบังคับเฉพาะช่องเดียว
  const channel = get('NOTIFY_EXT_CHANNEL', 'both').toLowerCase();
  const wantLine = channel === 'line' || channel === 'both';
  const wantTg   = channel === 'telegram' || channel === 'both';
  const results = [];

  // ปลายทางเฉพาะของ source นี้ — ตั้ง NOTIFY_EXT_<SOURCE>_TO = LINE userId
  // มติ Pex 2026-07-31: "เช็ครถประจำวันให้ส่งหา admin คนเดียว" ⇒ ครั้งละ 1 แทนที่จะเป็น 3
  //   (แจ้งลาคงเดิม เข้ากลุ่ม + ตรงหา admin เพื่อกันลืม — ยอมจ่ายแพงกว่าเพราะพลาดไม่ได้)
  const toOverride = get('NOTIFY_EXT_' + source.toUpperCase() + '_TO', '').trim();

  if (wantLine && settings.NOTIFY_LINE_ENABLED === 'true' && env.LINE_ACCESS_TOKEN) {
    // alert_type ไม่ใช่ CRITICAL ⇒ ถูกกันที่ 95% เพื่อสงวนโควตาก้อนสุดท้ายให้เคสวิกฤต
    const guard = await checkLineQuotaGuard(env, 'EXTERNAL');
    if (guard.allow) results.push({ channel: 'line', ...(await sendLine(env, settings, message, toOverride || null)) });
    else results.push({ channel: 'line', ok: false, skipped: true, error: guard.reason, quota: guard.quota });
  }
  if (wantTg && settings.NOTIFY_TELEGRAM_ENABLED === 'true' && env.TELEGRAM_BOT_TOKEN && settings.NOTIFY_TELEGRAM_CHAT_ID) {
    results.push({ channel: 'telegram', ...(await sendTelegram(env, settings.NOTIFY_TELEGRAM_CHAT_ID, message)) });
  }

  if (!results.length) {
    await logRow('skipped', channel, 'no_channel_available');
    return jsonResponse({ ok: true, skipped: 'no_channel_available', channel }, 200, request, env);
  }

  for (const r of results) {
    await logRow(r.ok ? 'sent' : (r.skipped ? 'skipped' : 'failed'), r.channel, r.ok ? null : (r.error || 'unknown'));
  }

  if (Math.random() < 0.02) await sbRpc(env, 'notification_log_cleanup').catch(() => {});
  // บอกกลับไปด้วยว่า setting ถูกอ่านจริงและปลายทางคืออะไร — ใช้ตรวจได้จากภายนอกโดยไม่ต้องส่งจริง
  return jsonResponse({
    ok: true,
    sent: results,
    resolved: { channel: channel, lineTarget: toOverride ? 'direct:' + toOverride.slice(0, 8) + '…' : 'default(group)' }
  }, 200, request, env);
}

// =============================================
// /notify/test — single channel, no state
// =============================================
async function handleNotifyTest(request, env) {
  // เดิมเปิดโล่งเหมือน /notify/send — แต่เส้นนี้ "มีคนใช้จริง" (ปุ่มทดสอบในหน้า PT Admin
  // ที่ v2/admin.html:3065) ซึ่งเรียกจากเบราว์เซอร์ จะใส่คีย์ไม่ได้เพราะคีย์จะโผล่ในหน้าเว็บ
  // ⇒ ใช้ 2 ด่านที่ไม่กระทบปุ่มเดิม:
  //   1) จำกัด Origin (ถ้าตั้ง ALLOWED_ORIGINS ไว้) — กันคนยิงจากเบราว์เซอร์เว็บอื่น
  //   2) เพดาน 5 ครั้ง/ชั่วโมง — จำกัดความเสียหายสูงสุดถ้ามีคนยิงตรงด้วย curl
  //      (ปุ่มทดสอบจริงกดกันไม่กี่ครั้ง ไม่มีทางชน)
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  if (allowed.length && origin && allowed.indexOf(origin) === -1) {
    return jsonResponse({ error: 'Origin not allowed' }, 403, request, env);
  }

  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = await sbSelect(env, 'notification_log',
      `alert_type=eq.TEST&created_at=gte.${since}&select=id`).catch(() => []);
    if (Array.isArray(recent) && recent.length >= 5) {
      return jsonResponse({ error: 'ทดสอบบ่อยเกินไป — เกิน 5 ครั้งใน 1 ชั่วโมง ลองใหม่ภายหลัง' }, 429, request, env);
    }
    await sbInsert(env, 'notification_log', [{
      case_id: 'test', alert_type: 'TEST', channel: 'all', status: 'sent',
      error: null, payload: { origin: origin || '(ไม่มี)' }
    }]).catch(() => {});
  }

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
// LINE Quota — Messaging API helpers
// =============================================
// LINE provides two free read endpoints (do NOT count against quota):
//   GET /v2/bot/message/quota             → { type: 'limited'|'none', value: <max> }
//   GET /v2/bot/message/quota/consumption → { totalUsage: '<number>' }
// We call both, return a unified object. ~100-200ms per check.
async function getLineQuota(env) {
  if (!env.LINE_ACCESS_TOKEN) return { ok: false, error: 'LINE_ACCESS_TOKEN not set' };
  try {
    const headers = { 'Authorization': `Bearer ${env.LINE_ACCESS_TOKEN}` };
    const [qResp, cResp] = await Promise.all([
      fetch('https://api.line.me/v2/bot/message/quota', { headers }),
      fetch('https://api.line.me/v2/bot/message/quota/consumption', { headers })
    ]);
    if (!qResp.ok) {
      const t = await qResp.text();
      return { ok: false, error: `LINE quota ${qResp.status}: ${t.slice(0, 200)}` };
    }
    if (!cResp.ok) {
      const t = await cResp.text();
      return { ok: false, error: `LINE consumption ${cResp.status}: ${t.slice(0, 200)}` };
    }
    const q = await qResp.json();
    const c = await cResp.json();
    const type = q.type || 'none';
    const max = type === 'limited' ? Number(q.value || 0) : Infinity;
    const used = Number(c.totalUsage || 0);
    const remaining = max === Infinity ? Infinity : Math.max(0, max - used);
    const percent = max === Infinity ? 0 : (max > 0 ? Math.round((used / max) * 1000) / 10 : 0);
    return { ok: true, type, max, used, remaining, percent };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Quota guard — call before sendLine to decide if we should send
// Returns { allow: bool, reason: string, quota: <obj> }
// Policy:
//   - Plan type 'none' (unlimited) → always allow
//   - used >= max          → block all LINE sends (would 429)
//   - used >= 95% of max   → allow only CRITICAL, block SPEED_OVER + others
//   - else                 → allow
async function checkLineQuotaGuard(env, alertType) {
  const q = await getLineQuota(env);
  if (!q.ok) {
    // If quota check itself fails, fail-OPEN (don't block legitimate critical alerts
    // because of a transient LINE API hiccup). Log it though.
    return { allow: true, reason: 'quota_check_failed:' + (q.error || ''), quota: q };
  }
  if (q.type !== 'limited') return { allow: true, reason: 'unlimited_plan', quota: q };
  if (q.used >= q.max) {
    return { allow: false, reason: 'LINE_QUOTA_EXHAUSTED', quota: q };
  }
  if (q.used >= q.max * 0.95) {
    // Soft cap — preserve last 5% for CRITICAL/ARREST only
    // (ARREST เพิ่มเข้ามา 2026-07-31 ตอนแยกเลน — ถ้าไม่นับ arrest จะโดนบล็อกที่ 95% ทั้งที่หนักสุด)
    const isCritical = ['CRITICAL', 'ARREST'].indexOf(String(alertType || '').toUpperCase()) >= 0;
    if (!isCritical) {
      return { allow: false, reason: 'LINE_QUOTA_NEAR_LIMIT_NONCRITICAL_BLOCKED', quota: q };
    }
  }
  return { allow: true, reason: 'ok', quota: q };
}

// =============================================
// /notify/quota — admin panel reads LINE quota
// =============================================
async function handleNotifyQuota(request, env) {
  const q = await getLineQuota(env);
  return jsonResponse(q, q.ok ? 200 : 502, request, env);
}

// =============================================
// Channel senders
// =============================================
// toOverride — ส่งตรงหา userId ที่ระบุ แทนปลายทางปกติ (2026-07-31)
//
// ⚠️ สำคัญเรื่องค่าใช้จ่าย: LINE นับโควตา "ตามจำนวนผู้รับ" ไม่ใช่ตามจำนวนครั้งที่ยิง
//    ส่งเข้ากลุ่ม = กินเท่ากับจำนวนคนในกลุ่ม (กลุ่ม "Supwilai แจ้งเตือน" มี 3 คน ⇒ ครั้งละ 3)
//    ส่งตรงหาคนเดียว = ครั้งละ 1
//    (วัดจริงจาก insight/message/delivery ก.ค. 2026: วันที่มีแต่ PT ส่ง ยอดที่ LINE นับ = ครั้งที่ยิง × 3 เป๊ะ)
//    ⇒ เพิ่มคนเข้ากลุ่มเมื่อไหร่ ค่าใช้จ่ายขึ้นทันทีตามจำนวนคน โดยไม่มีใครรู้ตัว
async function sendLine(env, settings, text, toOverride) {
  const messages = [{ type: 'text', text: text.slice(0, 5000) }];
  if (toOverride) {
    try {
      const resp = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.LINE_ACCESS_TOKEN}` },
        body: JSON.stringify({ to: toOverride, messages })
      });
      if (!resp.ok) { const t = await resp.text(); return { ok: false, error: `Line ${resp.status}: ${t.slice(0, 300)}` }; }
      return { ok: true, to: 'override' };
    } catch (e) { return { ok: false, error: e.message }; }
  }
  const targetType = (settings.NOTIFY_LINE_TARGET_TYPE || 'broadcast').trim();
  const targetsRaw = (settings.NOTIFY_LINE_TARGETS || '').trim();
  let url, payload;
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
// โหลด "ทุก key ที่ขึ้นต้นด้วย NOTIFY" — ไม่ใช่รายการตายตัว
//
// ⚠️ ของเดิมฮาร์ดโค้ดไว้ 5 key ⇒ setting ใหม่ที่เพิ่มทีหลังไม่เคยถูกอ่านเลย และ "เงียบ"
// เพราะทุกจุดมี default รองรับ จึงดูเหมือนทำงานปกติ (Codex เจอ 2026-07-31:
// ตั้ง NOTIFY_EXT_CHECKLIST_TO ไว้แล้วแต่เช็ครถยังส่งเข้ากลุ่มเหมือนเดิม
// และช่อง "เพดานต่อเคส" ในหน้า Admin กดบันทึกแล้วไม่มีผลอะไร)
// ⇒ ใช้ prefix filter แทน setting ใหม่จะทำงานทันทีโดยไม่ต้องมาแก้ตรงนี้อีก
async function loadNotifySettings(env) {
  const rows = await sbSelect(env, 'settings', 'key=like.NOTIFY*&select=key,value');
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
  const vehLat = parseFloat(url.searchParams.get('lat'));
  const vehLng = parseFloat(url.searchParams.get('lng'));

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

  // Vehicle position comes from the caller (frontend already polls gpsGetStatus
  // every 10s — gps_vehicles is just a registry, not a position store).
  // Validate sane lat/lng.
  if (!isFinite(vehLat) || !isFinite(vehLng) ||
      vehLat < -90 || vehLat > 90 || vehLng < -180 || vehLng > 180) {
    return jsonResponse({ ok: false, error: 'VEHICLE_NO_POSITION', hint: 'pass &lat= &lng= query params' }, 400, request, env);
  }
  const veh = { last_lat: vehLat, last_lng: vehLng };

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
    // Log full error server-side; expose only generic code to caller (audit
    // LOW finding — avoid forwarding raw e.message which could echo API key
    // if Google ever includes it in error responses).
    console.error('Distance Matrix failed:', e && e.message);
    if (row.last_eta_at) {
      return jsonResponse({
        ok: true,
        eta_seconds: row.last_eta_seconds,
        eta_at: row.last_eta_at,
        distance_m: row.last_distance_m,
        fresh: false,
        arrived: false,
        next_refresh_in: 60,
        warning: 'DISTANCE_MATRIX_UNAVAILABLE'
      }, 200, request, env);
    }
    return jsonResponse({
      ok: false,
      error: 'DISTANCE_MATRIX_UNAVAILABLE'
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

// =============================================================================
// GPS Shared Link — /api/route/refresh
// Calls Google Directions API to get an encoded polyline + writes to the
// gps_shared_tokens row. Caller decides WHEN to refresh (initial create +
// on deviation > 500m). Worker doesn't track deviation itself.
// =============================================================================

/**
 * Call Google Directions API.
 * @returns {Promise<{polyline:string, seconds:number, meters:number}>}
 */
async function callDirections(origin, dest, apiKey) {
  const url = 'https://maps.googleapis.com/maps/api/directions/json'
            + '?origin=' + encodeURIComponent(origin.lat + ',' + origin.lng)
            + '&destination=' + encodeURIComponent(dest.lat + ',' + dest.lng)
            + '&mode=driving'
            + '&departure_time=now'
            + '&language=th'
            + '&key=' + encodeURIComponent(apiKey);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Directions HTTP ' + res.status);
  const j = await res.json();
  if (j.status !== 'OK') throw new Error('Directions status: ' + j.status);
  const route = (j.routes && j.routes[0]) || {};
  const leg   = (route.legs && route.legs[0]) || {};
  const dur   = leg.duration_in_traffic || leg.duration || {};
  const dis   = leg.distance || {};
  const poly  = (route.overview_polyline && route.overview_polyline.points) || '';
  if (!poly) throw new Error('Directions returned no polyline');
  return { polyline: poly, seconds: dur.value || 0, meters: dis.value || 0 };
}

async function handleRouteRefresh(request, env) {
  const url = new URL(request.url);
  const token = (url.searchParams.get('token') || '').trim();
  const vehLat = parseFloat(url.searchParams.get('lat'));
  const vehLng = parseFloat(url.searchParams.get('lng'));

  if (!token) {
    return jsonResponse({ ok: false, error: 'TOKEN_REQUIRED' }, 400, request, env);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return jsonResponse({ ok: false, error: 'WORKER_MISCONFIGURED' }, 500, request, env);
  }
  if (!env.GOOGLE_MAPS_KEY_SERVER) {
    return jsonResponse({ ok: false, error: 'NO_MAPS_KEY' }, 500, request, env);
  }
  if (!isFinite(vehLat) || !isFinite(vehLng) ||
      vehLat < -90 || vehLat > 90 || vehLng < -180 || vehLng > 180) {
    return jsonResponse({ ok: false, error: 'VEHICLE_NO_POSITION', hint: 'pass &lat= &lng= query params' }, 400, request, env);
  }

  const sbHdrs = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json'
  };

  // Validate token + read dest
  const tokenUrl = env.SUPABASE_URL + '/rest/v1/gps_shared_tokens'
                 + '?token=eq.' + encodeURIComponent(token)
                 + '&select=token,status,expires_at,dest_lat,dest_lng,dest_locked_at';
  const tRes = await fetch(tokenUrl, { headers: sbHdrs });
  if (!tRes.ok) {
    return jsonResponse({ ok: false, error: 'DB_READ_FAILED' }, 502, request, env);
  }
  const tokenRows = await tRes.json();
  const row = tokenRows[0];
  if (!row) return jsonResponse({ ok: false, error: 'TOKEN_INVALID' }, 404, request, env);
  if (row.status !== 'Active' || new Date(row.expires_at) < new Date()) {
    return jsonResponse({ ok: false, error: 'TOKEN_INVALID' }, 404, request, env);
  }
  if (!row.dest_locked_at || row.dest_lat == null || row.dest_lng == null) {
    return jsonResponse({ ok: false, error: 'DEST_NOT_LOCKED' }, 409, request, env);
  }

  // Call Directions
  let dir;
  try {
    dir = await callDirections(
      { lat: vehLat, lng: vehLng },
      { lat: row.dest_lat, lng: row.dest_lng },
      env.GOOGLE_MAPS_KEY_SERVER
    );
  } catch (e) {
    console.error('Directions failed:', e && e.message);
    return jsonResponse({ ok: false, error: 'DIRECTIONS_UNAVAILABLE' }, 503, request, env);
  }

  // Writeback polyline + also update ETA cache (Directions gives both)
  const nowIso = new Date().toISOString();
  const patchUrl = env.SUPABASE_URL + '/rest/v1/gps_shared_tokens'
                 + '?token=eq.' + encodeURIComponent(token);
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: { ...sbHdrs, Prefer: 'return=minimal' },
    body: JSON.stringify({
      route_polyline: dir.polyline,
      route_updated_at: nowIso,
      last_eta_seconds: dir.seconds,
      last_eta_at: nowIso,
      last_distance_m: dir.meters
    })
  });

  return jsonResponse({
    ok: true,
    polyline: dir.polyline,
    eta_seconds: dir.seconds,
    distance_m: dir.meters,
    route_updated_at: nowIso
  }, 200, request, env);
}
