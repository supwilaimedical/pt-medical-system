// Build website-map.pdf (A1 landscape) — full file + DB schema map of PT Medical System
// Module-centric layout, all DB columns, Thai+English labels.
// Run: node tools/build-website-map.js
const puppeteer = require('puppeteer');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(DOCS, 'website-map.pdf');
const OUT_HTML = path.join(DOCS, 'website-map.html');
const fs = require('fs');

// ============================================================
// DATA — sourced from migration/*.sql, sql/*.sql, v2/ pages (2026-06-16)
// ============================================================

// type abbreviations: TEXT, UUID, JSONB, INT, BOOL, TS=timestamptz, DATE, FLOAT=double precision, BIG=bigint/bigserial
// col: [name, type, flag]  flag: 'pk' | 'fk:table' | 'uq' | '' ; note via 4th elem
const TABLES = {
  cases: {
    mod: 'transport', src: 'migration/schema.sql + gps_schema + wave8',
    cols: [
      ['case_id', 'TEXT', 'pk'],
      ['status', 'TEXT', '', "'Active'"],
      ['created_at', 'TS', ''],
      ['triage_level', 'TEXT', ''],
      ['op_info', 'JSONB', ''],
      ['patient_info', 'JSONB', ''],
      ['raw_data', 'JSONB', '', 'referSummary/caseSummary/vitals/IV'],
      ['public_token', 'TEXT', ''],
      ['is_public', 'BOOL', ''],
      ['public_expiry', 'TS', ''],
      ['gps_device_id', 'TEXT', 'fk:gps_vehicles'],
      ['gps_provider', 'TEXT', 'fk:gps_providers'],
      ['opened_by', 'TEXT', ''],
      ['opened_at', 'TS', ''],
      ['row_version', 'INT', '', 'OCC (trigger++)'],
    ],
    extra: 'idx(status,created_at) · trg bump row_version',
  },
  transport_consents: {
    mod: 'transport', src: 'sql/create_transport_consents + wave7',
    cols: [
      ['id', 'UUID', 'pk'],
      ['case_id', 'TEXT', 'fk:cases'],
      ['version', 'INT', ''],
      ['signed_at', 'TS', ''],
      ['signed_by', 'TEXT', ''],
      ['relationship', 'TEXT', ''],
      ['consent_data', 'JSONB', '', 'dnr/destination/checklist/lang'],
      ['signature_image', 'TEXT', '', 'base64'],
      ['witness_name', 'TEXT', ''],
      ['witness_signature_image', 'TEXT', ''],
      ['status', 'TEXT', '', 'active|superseded|case_deleted'],
      ['superseded_at', 'TS', ''],
      ['superseded_reason', 'TEXT', ''],
      ['created_at', 'TS', ''],
    ],
    extra: 'uniq 1 active/case · RPC sign_consent_atomic',
  },
  analytics: {
    mod: 'transport', src: 'migration/schema.sql',
    cols: [
      ['id', 'BIG', 'pk'],
      ['case_id', 'TEXT', 'fk:cases'],
      ['timestamp', 'TS', ''],
      ['status', 'TEXT', ''],
      ['triage_level', 'TEXT', ''],
      ['patient_name', 'TEXT', ''],
      ['age', 'INT', ''],
      ['gender', 'TEXT', ''],
      ['hn', 'TEXT', ''],
      ['diagnosis', 'TEXT', ''],
      ['op_level', 'TEXT', ''],
      ['op_unit', 'TEXT', ''],
      ['from_location', 'TEXT', ''],
      ['to_location', 'TEXT', ''],
      ['has_ett', 'BOOL', ''],
      ['has_iv_drip', 'BOOL', ''],
      ['has_o2', 'BOOL', ''],
      ['has_foley', 'BOOL', ''],
      ['has_chest_tube', 'BOOL', ''],
      ['vitals_bp', 'TEXT', ''],
      ['vitals_hr', 'TEXT', ''],
      ['vitals_rr', 'TEXT', ''],
      ['vitals_temp', 'TEXT', ''],
      ['vitals_o2sat', 'TEXT', ''],
    ],
  },
  fa_events: {
    mod: 'firstaid', src: 'migration/schema.sql',
    cols: [
      ['event_id', 'TEXT', 'pk'],
      ['event_name', 'TEXT', ''],
      ['location', 'TEXT', ''],
      ['event_date', 'DATE', ''],
      ['status', 'TEXT', '', "'Active'"],
      ['created_by', 'TEXT', ''],
      ['image_url', 'TEXT', ''],
      ['start_time', 'TEXT', ''],
      ['end_date', 'DATE', ''],
      ['end_time', 'TEXT', ''],
      ['q_ammonia', 'INT', '', 'supply'],
      ['q_plaster', 'INT', ''],
      ['q_spray', 'INT', ''],
      ['q_wound', 'INT', ''],
      ['q_meds', 'INT', ''],
      ['event_type', 'TEXT', '', "'general'"],
      ['event_config', 'JSONB', ''],
    ],
    extra: 'RPC fa_bump_supply (atomic ++)',
  },
  fa_registry: {
    mod: 'firstaid', src: 'migration/schema.sql + wave6b',
    cols: [
      ['reg_id', 'TEXT', 'pk'],
      ['event_id', 'TEXT', 'fk:fa_events'],
      ['triage', 'TEXT', ''],
      ['gender', 'TEXT', ''],
      ['age', 'INT', ''],
      ['name', 'TEXT', ''],
      ['phone', 'TEXT', ''],
      ['category', 'TEXT', ''],
      ['location_tx', 'TEXT', ''],
      ['time_in', 'TEXT', ''],
      ['time_out', 'TEXT', ''],
      ['etiology', 'TEXT', ''],
      ['cc', 'TEXT', '', 'chief complaint'],
      ['cc_other', 'TEXT', ''],
      ['problem', 'TEXT', ''],
      ['problem_other', 'TEXT', ''],
      ['treatment', 'TEXT', ''],
      ['allergy', 'TEXT', ''],
      ['vitals_json', 'JSONB', '', 'bp/hr/rr/temp/o2sat'],
      ['result', 'TEXT', ''],
      ['note', 'TEXT', ''],
      ['image_url', 'TEXT', ''],
      ['gps', 'TEXT', ''],
      ['recorded_by', 'TEXT', ''],
    ],
    extra: 'idx(event_id)',
  },
  fa_patients: {
    mod: 'firstaid', src: 'migration/schema.sql', legacy: true,
    cols: [
      ['patient_id', 'TEXT', 'pk'],
      ['event_id', 'TEXT', 'fk:fa_events'],
      ['name', 'TEXT', ''],
      ['phone', 'TEXT', ''],
      ['time_in', 'TEXT', ''],
      ['time_out', 'TEXT', ''],
      ['symptoms', 'TEXT', ''],
      ['treatment', 'TEXT', ''],
      ['allergy', 'TEXT', ''],
      ['note', 'TEXT', ''],
      ['image_url', 'TEXT', ''],
      ['gps', 'TEXT', ''],
      ['recorded_by', 'TEXT', ''],
      ['gender', 'TEXT', ''],
      ['age', 'INT', ''],
      ['triage', 'TEXT', ''],
    ],
  },
  fa_event_tokens: {
    mod: 'firstaid', src: 'sql/add_fa_event_tokens + wave9',
    cols: [
      ['token', 'TEXT', 'pk', '6-char'],
      ['event_id', 'TEXT', 'fk:fa_events'],
      ['worker_name', 'TEXT', ''],
      ['location_tx', 'TEXT', '', 'NULL=all'],
      ['status', 'TEXT', '', 'Active|Revoked'],
      ['created_by', 'TEXT', ''],
      ['created_at', 'TS', ''],
    ],
    extra: 'anon: S+I+U (no D)',
  },
  loc_customers: {
    mod: 'location', src: 'migration/schema.sql',
    cols: [
      ['id', 'TEXT', 'pk'],
      ['name', 'TEXT', ''],
      ['phone', 'TEXT', ''],
      ['lat', 'FLOAT', ''],
      ['lng', 'FLOAT', ''],
      ['district', 'TEXT', ''],
      ['details', 'TEXT', ''],
      ['photo_url', 'TEXT', ''],
      ['date_added', 'TS', ''],
      ['province', 'TEXT', ''],
      ['customer_type', 'TEXT', '', "'ลูกค้าทั่วไป'"],
    ],
    extra: 'anon R only if active share token',
  },
  loc_shared_tokens: {
    mod: 'location', src: 'schema + loc_shared_tokens_*',
    cols: [
      ['token', 'TEXT', 'pk'],
      ['customer_id', 'TEXT', 'fk:loc_customers'],
      ['config', 'JSONB', '', 'legacy'],
      ['expiry_date', 'TS', ''],
      ['created_by', 'TEXT', ''],
      ['status', 'TEXT', '', "'Active'"],
      ['created_at', 'TS', ''],
      ['note', 'TEXT', ''],
      ['share_config', 'JSONB', '', 'name/phone/coords/details/photo'],
    ],
  },
  gps_providers: {
    mod: 'gps', src: 'migration/gps_schema.sql',
    cols: [
      ['id', 'TEXT', 'pk'],
      ['name', 'TEXT', ''],
      ['software', 'TEXT', '', 'Traccar/CMSV6…'],
      ['base_url', 'TEXT', ''],
      ['account', 'TEXT', ''],
      ['password', 'TEXT', ''],
      ['is_active', 'BOOL', ''],
      ['config_json', 'TEXT', ''],
      ['created_at', 'TS', ''],
    ],
    extra: 'anon R only if is_active',
  },
  gps_vehicles: {
    mod: 'gps', src: 'gps_schema + gps_share_camera',
    cols: [
      ['id', 'UUID', 'pk'],
      ['device_id', 'TEXT', 'uq'],
      ['device_name', 'TEXT', ''],
      ['nickname', 'TEXT', ''],
      ['provider', 'TEXT', 'fk:gps_providers'],
      ['is_active', 'BOOL', ''],
      ['synced_at', 'TS', ''],
    ],
    extra: 'UNIQUE(device_id,provider)',
  },
  gps_shared_tokens: {
    mod: 'gps', src: 'gps_schema + gps_share_eta/route/camera/speed',
    cols: [
      ['id', 'UUID', 'pk'],
      ['token', 'TEXT', 'uq'],
      ['device_id', 'TEXT', ''],
      ['provider', 'TEXT', 'fk:gps_providers'],
      ['expires_at', 'TS', ''],
      ['created_by', 'TEXT', ''],
      ['reason', 'TEXT', ''],
      ['status', 'TEXT', '', 'Active|Revoked'],
      ['created_at', 'TS', ''],
      ['ttl_hours', 'INT', ''],
      ['dest_mode', 'TEXT', '', 'paramedic_set|customer_choose|none'],
      ['dest_lat', 'FLOAT', ''],
      ['dest_lng', 'FLOAT', ''],
      ['dest_name', 'TEXT', ''],
      ['dest_source', 'TEXT', '', 'link/search/preset/map_click…'],
      ['dest_locked_at', 'TS', ''],
      ['audience', 'TEXT', '', 'family|contractor'],
      ['last_eta_seconds', 'INT', ''],
      ['last_eta_at', 'TS', ''],
      ['last_distance_m', 'INT', ''],
      ['route_polyline', 'TEXT', ''],
      ['route_updated_at', 'TS', ''],
      ['allow_camera', 'BOOL', ''],
      ['show_speed', 'BOOL', ''],
    ],
    extra: 'trg clear_on_revoke · RPC lock_customer_dest / cleanup',
  },
  notification_state: {
    mod: 'notify', src: 'sql/notifications + v2 + wave9',
    cols: [
      ['case_id', 'TEXT', 'pk', 'fk:cases'],
      ['alert_type', 'TEXT', 'pk'],
      ['first_sent_at', 'TS', ''],
      ['acknowledged', 'BOOL', ''],
      ['acknowledged_at', 'TS', ''],
      ['acknowledged_by', 'TEXT', ''],
      ['last_payload', 'JSONB', '', 'severity compare'],
    ],
    extra: 'PK(case_id,alert_type) · anon S+U',
  },
  notification_log: {
    mod: 'notify', src: 'sql/notifications + wave6b',
    cols: [
      ['id', 'BIG', 'pk'],
      ['case_id', 'TEXT', 'fk:cases'],
      ['alert_type', 'TEXT', ''],
      ['channel', 'TEXT', '', 'line|telegram'],
      ['status', 'TEXT', '', 'sent|failed|skipped'],
      ['error', 'TEXT', ''],
      ['payload', 'JSONB', ''],
      ['created_at', 'TS', ''],
    ],
    extra: 'RPC cleanup (>30d) · anon S',
  },
  line_user_bindings: {
    mod: 'lineoa', src: 'sql/line_oa_hub_001 + 003',
    cols: [
      ['id', 'UUID', 'pk'],
      ['line_user_id', 'TEXT', ''],
      ['employee_id', 'TEXT', ''],
      ['employee_name', 'TEXT', ''],
      ['employee_role', 'TEXT', '', "'Employee'"],
      ['company', 'TEXT', '', "'supwilai'"],
      ['line_display_name', 'TEXT', ''],
      ['line_picture_url', 'TEXT', ''],
      ['bound_at', 'TS', ''],
      ['is_active', 'BOOL', ''],
      ['unbound_at', 'TS', ''],
      ['unbound_by', 'TEXT', ''],
      ['unbound_reason', 'TEXT', ''],
    ],
    extra: 'partial uniq (employee/line per company) · service_role',
  },
  line_user_state: {
    mod: 'lineoa', src: 'sql/line_oa_hub_002',
    cols: [
      ['line_user_id', 'TEXT', 'pk'],
      ['action', 'TEXT', ''],
      ['expires_at', 'TS', ''],
      ['created_at', 'TS', ''],
    ],
    extra: 'service_role only',
  },
  settings: {
    mod: 'core', src: 'migration/schema.sql',
    cols: [
      ['key', 'TEXT', 'pk'],
      ['value', 'TEXT', '', 'GPS_ENABLED, branding, tokens, SPEED_ALERT_COOLDOWN_MIN…'],
    ],
  },
  activity_log: {
    mod: 'core', src: 'migration/schema.sql',
    cols: [
      ['id', 'BIG', 'pk'],
      ['timestamp', 'TS', ''],
      ['username', 'TEXT', ''],
      ['role', 'TEXT', ''],
      ['action', 'TEXT', '', 'SAVE/CREATE/OPEN/REOPEN_CASE…'],
      ['target', 'TEXT', ''],
      ['details', 'TEXT', ''],
    ],
  },
};

const MODULES = [
  {
    key: 'transport', name: 'Patient Transport', th: 'นำส่งผู้ป่วย',
    pages: [
      ['v2/transport/index.html', 'จัดการเคสรับ-ส่งผู้ป่วย · V/S · ยา/IV · Consent · พิมพ์'],
      ['v2/transport/consent-prototype.html', 'ต้นแบบฟอร์มยินยอม'],
    ],
    deps: ['config', 'auth', 'settings', 'realtime', 'favicon', 'notify', 'cloudinary'],
    tables: ['cases', 'transport_consents', 'analytics'],
  },
  {
    key: 'firstaid', name: 'First Aid', th: 'ปฐมพยาบาล (Event)',
    pages: [
      ['v2/firstaid/index.html', 'งานออกหน่วย: Event → Registry'],
      ['v2/firstaid/dashboard.html', 'วิเคราะห์ (triage/เพศ/ผล)'],
      ['v2/firstaid/staff.html', 'รายชื่อทีม'],
      ['v2/firstaid/reg-form.js', 'logic ฟอร์มลงทะเบียน'],
    ],
    deps: ['config', 'auth', 'settings', 'realtime', 'favicon', 'notify'],
    tables: ['fa_events', 'fa_registry', 'fa_event_tokens', 'fa_patients'],
  },
  {
    key: 'location', name: 'PT Location', th: 'พิกัดสถานที่',
    pages: [
      ['v2/location/index.html', 'ฐานข้อมูลลูกค้า/สถานที่ + แผนที่'],
      ['v2/location/share.html', 'ลิงก์แชร์สาธารณะ'],
    ],
    deps: ['config', 'auth', 'settings', 'places-api', 'map-config', 'cloudinary'],
    tables: ['loc_customers', 'loc_shared_tokens'],
  },
  {
    key: 'gps', name: 'GPS Tracking', th: 'ติดตามรถ Real-time',
    pages: [
      ['v2/gps/index.html', 'fleet live + history (admin)'],
      ['v2/gps/share.html', 'public share token (live)'],
      ['v2/gps/share-expired.html', 'ลิงก์หมดอายุ'],
    ],
    deps: ['config', 'auth', 'settings', 'realtime', 'gps-providers', 'map-config'],
    tables: ['gps_providers', 'gps_vehicles', 'gps_shared_tokens'],
  },
  {
    key: 'notify', name: 'Notifications', th: 'แจ้งเตือน (cross-cut)',
    pages: [
      ['shared/notify.js', 'Line OA + Telegram (debounce/case)'],
      ['cloudflare/speed-watcher-worker.js', 'แจ้งรถวิ่งเกินความเร็ว'],
    ],
    deps: ['config', 'settings'],
    tables: ['notification_state', 'notification_log'],
  },
  {
    key: 'lineoa', name: 'Line OA Hub', th: 'ผูกบัญชี LINE (external worker)',
    pages: [
      ['(CF Worker) line-oa-hub', 'webhook · LIFF bind · rich menu'],
    ],
    deps: [],
    tables: ['line_user_bindings', 'line_user_state'],
  },
  {
    key: 'core', name: 'Core / Admin / Monitor / Fleet', th: 'แกนกลาง + ผู้ดูแล',
    pages: [
      ['v2/index.html', 'Login + Landing (command center)'],
      ['v2/admin.html', 'ตั้งค่าระบบ 3-col (org/brand/GPS/OCR/notify/sessions/stats)'],
      ['v2/monitor/index.html', 'Realtime monitor + wallboard (admin)'],
      ['v2/fleet/index.html', 'เช็คลิสต์รถประจำวัน (ผ่าน GAS API)'],
    ],
    deps: ['config', 'auth', 'settings', 'realtime', 'favicon'],
    tables: ['settings', 'activity_log'],
  },
];

const MOD_COLORS = {
  transport: '#0284c7', firstaid: '#dc2626', location: '#16a34a',
  gps: '#7c3aed', notify: '#d97706', lineoa: '#06b6d4', core: '#475569',
};

const SHARED_JS = [
  ['config.js', 'APP_VERSION · Supabase keys · GAS endpoints · factory defaults'],
  ['auth.js', 'session/login · GAS HR auth · 8h timeout · force-logout · _supabase client'],
  ['settings.js', 'โหลด/cache ตั้งค่า admin จาก DB'],
  ['realtime.js', 'subscribe/unsubscribe Supabase Realtime (debounce)'],
  ['favicon.js', 'favicon จาก APP_LOGO_URL'],
  ['notify.js', 'ส่ง Line OA + Telegram (debounce/case)'],
  ['gps-providers.js', 'proxy chain: Synology → Render → GAS'],
  ['map-config.js', 'Leaflet/Google Maps · marker styles · classify by speed'],
  ['places-api.js', 'Google Places · reverse geocode · expand short link'],
  ['cloudinary.js', 'อัพรูป + บีบอัด → Cloudinary CDN'],
];

const EXTERNAL = [
  ['GitHub Pages', 'hosting · static · auto-deploy main', '#24292f'],
  ['Supabase PostgreSQL', 'DB · RLS · Realtime · Edge Fn (Singapore)', '#3ecf8e'],
  ['Cloudinary', 'อัพโหลด/optimize รูป (unsigned)', '#3448c5'],
  ['GAS HR API', 'auth login (employee/role)', '#ea4335'],
  ['GAS gps-proxy', 'GPS fallback ชั้น 3', '#ea4335'],
  ['Cloudflare Workers', 'gps-proxy · ocr-proxy · speed-watcher', '#f38020'],
  ['Leaflet + OSM', 'แผนที่ + MarkerCluster', '#199900'],
  ['Google Places/Directions', 'ค้นหาใกล้ + route/ETA', '#4285f4'],
  ['Nominatim', 'reverse geocode', '#7ebc6f'],
  ['Gemini OCR', 'อ่านใบ Refer/บัตร (ผ่าน CF worker)', '#8e75f8'],
  ['LINE OA + Telegram', 'ช่องทางแจ้งเตือน', '#06c755'],
];

const EDGE = [
  ['supabase/functions/expand-url', 'Edge Fn (Deno): ตาม redirect Google Maps → lat/lng'],
  ['cloudflare/gps-proxy-worker.js', 'route GPS ผ่าน proxy chain'],
  ['cloudflare/ocr-proxy-worker.js', 'ซ่อน Gemini API key'],
  ['cloudflare/speed-watcher-worker.js', 'เฝ้าความเร็ว → alert'],
  ['gas/gps-proxy.gs', 'GPS fallback ฟรี (ช้าสุด)'],
];

const RPCS = [
  ['expand_maps_url(short_url)', 'JSONB', 'ขยาย Maps short URL → lat/lng'],
  ['fa_bump_supply(event,field,delta)', 'INT', 'นับ supply ปฐมพยาบาลแบบ atomic'],
  ['sign_consent_atomic(...)', 'JSONB', 'supersede+insert consent (advisory lock)'],
  ['lock_customer_dest(token,lat,lng,name,src)', 'BOOL', 'ล็อกปลายทางที่ลูกค้าเลือก'],
  ['notification_log_cleanup()', 'void', 'ลบ log >30 วัน'],
  ['gps_shared_tokens_cleanup()', 'TABLE', 'เคลียร์ token หมดอายุ'],
  ['cases_bump_row_version()', 'trigger', 'เพิ่ม row_version (OCC)'],
  ['gps_shared_tokens_clear_on_revoke()', 'trigger', 'ล้าง route/ETA เมื่อ revoke'],
];

const REALTIME = ['cases', 'transport_consents', 'fa_events', 'fa_registry', 'fa_event_tokens', 'loc_customers', 'loc_shared_tokens', 'settings', 'activity_log'];

const TOOLS = [
  ['tools/build-manual.js', 'puppeteer → user/admin PDF'],
  ['tools/build-website-map.js', 'แผนที่นี้ (A1 PDF)'],
  ['tools/regen-case-report.mjs', 'gen Case Report ย้อนหลัง'],
  ['tools/regen-refer-sbar.mjs', 'gen Refer summary ย้อนหลัง'],
  ['tools/gen-missing-case-report.mjs / gen-missing-refer.mjs', 'ซ่อมข้อมูลที่ขาด'],
  ['migration/migrate.mjs', 'runner apply migration'],
];

// ============================================================
// RENDER
// ============================================================
const TYPE_COLOR = {
  TEXT: '#0369a1', UUID: '#7c3aed', JSONB: '#b45309', INT: '#15803d', BIG: '#15803d',
  BOOL: '#be185d', TS: '#475569', DATE: '#475569', FLOAT: '#15803d',
};

function flagBadge(flag) {
  if (!flag) return '';
  if (flag === 'pk') return '<span class="fl pk">PK</span>';
  if (flag === 'uq') return '<span class="fl uq">UQ</span>';
  if (flag.startsWith('fk:')) return `<span class="fl fk">FK→${flag.slice(3)}</span>`;
  return '';
}

function tableCard(key) {
  const t = TABLES[key];
  const color = MOD_COLORS[t.mod];
  const rows = t.cols.map(c => {
    const [n, ty, fl, note] = c;
    const tc = TYPE_COLOR[ty] || '#475569';
    return `<div class="col">
      <span class="cn">${n}</span>
      <span class="ct" style="color:${tc}">${ty}</span>
      ${flagBadge(fl)}
      ${note ? `<span class="note">${note}</span>` : ''}
    </div>`;
  }).join('');
  return `<div class="tcard" style="border-color:${color}">
    <div class="thead" style="background:${color}">
      <span class="tname">${key}</span>
      <span class="tcount">${t.cols.length} cols${t.legacy ? ' · legacy' : ''}</span>
    </div>
    <div class="tsrc">${t.src}</div>
    <div class="cols">${rows}</div>
    ${t.extra ? `<div class="textra">⚙ ${t.extra}</div>` : ''}
  </div>`;
}

function moduleBlock(m) {
  const color = MOD_COLORS[m.key];
  const pages = m.pages.map(p => `<div class="pg"><span class="pgf">${p[0]}</span><span class="pgd">${p[1]}</span></div>`).join('');
  const deps = m.deps.length ? `<div class="deps">${m.deps.map(d => `<span class="dep">${d}</span>`).join('')}</div>` : '';
  const tables = m.tables.map(tableCard).join('');
  return `<div class="mod" style="--mc:${color}">
    <div class="mhead" style="background:${color}">
      <span class="mname">${m.name}</span><span class="mth">${m.th}</span>
    </div>
    <div class="pages">${pages}${deps}</div>
    <div class="mtables">${tables}</div>
  </div>`;
}

const STAMP = new Date().toLocaleString('th-TH', { dateStyle: 'long', timeStyle: 'short' });

const HTML = `<!doctype html><html lang="th"><head><meta charset="utf-8">
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
@page{size:A1 landscape;margin:0}
html,body{font-family:'Sarabun',sans-serif;color:#0f172a;background:#fff}
.mono{font-family:'JetBrains Mono',monospace}
#sheet{width:3178px;min-height:2245px;padding:26px 30px;background:linear-gradient(180deg,#f8fafc,#eef2f7);}
/* header */
.top{display:flex;align-items:flex-end;justify-content:space-between;border-bottom:4px solid #0f172a;padding-bottom:12px;margin-bottom:16px}
.title h1{font-size:46px;font-weight:800;color:#0f172a;letter-spacing:-.5px}
.title .sub{font-size:19px;color:#475569;margin-top:2px;font-weight:500}
.title .sub b{color:#0284c7}
.meta{text-align:right;font-size:15px;color:#64748b;line-height:1.5}
.meta b{color:#0f172a}
.stackchips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;justify-content:flex-end;max-width:900px}
.chip{font-size:13px;background:#fff;border:1px solid #cbd5e1;border-radius:999px;padding:2px 10px;color:#334155;font-weight:500}
/* legend */
.legend{display:flex;gap:18px;flex-wrap:wrap;align-items:center;font-size:14px;color:#475569;margin-bottom:14px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:8px 14px}
.legend .lg{display:flex;align-items:center;gap:5px}
.swatch{width:14px;height:14px;border-radius:4px;display:inline-block}
.fl{font-size:11px;font-weight:700;border-radius:4px;padding:0 4px;color:#fff;font-family:'JetBrains Mono',monospace}
.fl.pk{background:#0f172a}.fl.uq{background:#7c3aed}.fl.fk{background:#0891b2;font-size:10px}
/* main grid */
.grid{display:grid;grid-template-columns:470px 1fr;gap:16px;align-items:start}
.rail{display:flex;flex-direction:column;gap:11px}
.panel{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.05)}
.panel>.ph{font-size:18px;font-weight:700;color:#fff;padding:8px 14px;background:#0f172a;display:flex;justify-content:space-between;align-items:center}
.panel .pb{padding:10px 12px}
.kv{display:flex;flex-direction:column;gap:6px}
.row1{display:flex;gap:8px;align-items:baseline}
.row1 .k{font-family:'JetBrains Mono',monospace;font-size:13.5px;font-weight:600;color:#0f172a;white-space:nowrap}
.row1 .v{font-size:13.5px;color:#475569;line-height:1.35}
.extsvc{display:flex;flex-direction:column;gap:7px}
.ext{display:flex;gap:9px;align-items:baseline;font-size:14px}
.ext .dot{width:11px;height:11px;border-radius:3px;flex:0 0 auto;position:relative;top:2px}
.ext b{color:#0f172a;font-weight:600}.ext span{color:#64748b}
.flow{font-size:14px;color:#334155;line-height:1.7;background:#f8fafc;border:1px dashed #94a3b8;border-radius:8px;padding:9px 12px}
.flow b{color:#0284c7}
/* modules area */
.mods{column-count:5;column-gap:13px}
.mod{break-inside:auto;margin-bottom:12px;background:#fff;border:1px solid #e2e8f0;border-top:4px solid var(--mc);border-radius:12px;box-shadow:0 1px 3px rgba(15,23,42,.06)}
.mhead,.pages,.tcard{break-inside:avoid}
.mhead{padding:8px 13px;display:flex;flex-direction:column;color:#fff}
.mhead .mname{font-size:21px;font-weight:800;line-height:1.1}
.mhead .mth{font-size:14px;opacity:.92;font-weight:500}
.pages{padding:9px 11px;background:#f8fafc;border-bottom:1px solid #eef2f7}
.pg{margin-bottom:5px}
.pg .pgf{display:block;font-family:'JetBrains Mono',monospace;font-size:12.5px;font-weight:600;color:#0f172a}
.pg .pgd{display:block;font-size:12.5px;color:#64748b;line-height:1.3}
.deps{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}
.dep{font-size:11.5px;font-family:'JetBrains Mono',monospace;background:#e2e8f0;color:#334155;border-radius:5px;padding:1px 6px}
.mtables{padding:8px 10px;display:flex;flex-direction:column;gap:7px}
.tcard{border:1px solid #e2e8f0;border-left:4px solid;border-radius:8px;overflow:hidden;break-inside:avoid}
.thead{color:#fff;padding:4px 10px;display:flex;justify-content:space-between;align-items:center}
.thead .tname{font-family:'JetBrains Mono',monospace;font-size:15px;font-weight:700}
.thead .tcount{font-size:11.5px;opacity:.9}
.tsrc{font-size:10.5px;color:#94a3b8;padding:2px 10px;font-family:'JetBrains Mono',monospace;background:#f8fafc;border-bottom:1px solid #f1f5f9}
.cols{padding:4px 10px 6px}
.col{display:flex;align-items:baseline;gap:6px;font-size:12.5px;line-height:1.5;border-bottom:1px dotted #eef2f7;padding:1px 0}
.col:last-child{border-bottom:none}
.col .cn{font-family:'JetBrains Mono',monospace;font-weight:600;color:#0f172a}
.col .ct{font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:600}
.col .note{font-size:11px;color:#94a3b8;font-style:italic;margin-left:auto;text-align:right}
.textra{font-size:11.5px;color:#b45309;background:#fffbeb;padding:3px 10px;border-top:1px solid #fef3c7}
/* footer band */
.foot{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:12px}
.fpanel{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
.fpanel .ph{font-size:17px;font-weight:700;color:#fff;background:#0f172a;padding:7px 13px}
.fpanel .pb{padding:9px 12px}
.rpc{display:flex;gap:8px;align-items:baseline;font-size:13px;margin-bottom:4px;line-height:1.35}
.rpc .rn{font-family:'JetBrains Mono',monospace;font-weight:600;color:#0f172a}
.rpc .rt{font-family:'JetBrains Mono',monospace;font-size:11px;color:#b45309;flex:0 0 auto}
.rpc .rd{color:#64748b}
.rtchips{display:flex;flex-wrap:wrap;gap:5px}
.rtchip{font-size:12.5px;font-family:'JetBrains Mono',monospace;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;border-radius:6px;padding:1px 7px}
.tinylist .row1 .k{font-size:12.5px}.tinylist .row1 .v{font-size:12.5px}
.note-rls{font-size:12.5px;color:#475569;line-height:1.5;margin-top:6px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:7px 10px}
.note-rls b{color:#b91c1c}
.brand{font-size:13px;color:#94a3b8;text-align:center;margin-top:14px}
</style></head><body>
<div id="sheet">

  <div class="top">
    <div class="title">
      <h1>PT Medical System — Website Map</h1>
      <div class="sub">แผนผังไฟล์ + ฐานข้อมูลทั้งระบบ · <b>GitHub Pages + Supabase + Cloudinary</b> · v2 canonical (v1 archived → redirect)</div>
      <div class="stackchips">
        ${['HTML+Bootstrap5+vanilla JS', 'Supabase PostgreSQL', 'Leaflet/OSM', 'Chart.js', 'Cloudinary', 'Cloudflare Workers', 'GAS HR auth', 'PWA (sw.js+manifest)', 'Realtime', 'Gemini OCR', 'LINE OA+Telegram'].map(s => `<span class="chip">${s}</span>`).join('')}
      </div>
    </div>
    <div class="meta">
      repo <b>supwilaimedical/pt-medical-system</b><br>
      Supabase <b>rwxaalgvkzlsyfzdebcj</b> (SG)<br>
      ตาราง <b>${Object.keys(TABLES).length}</b> · โมดูล <b>${MODULES.length}</b> · RPC/trigger <b>${RPCS.length}</b><br>
      สร้าง: <b>${STAMP}</b>
    </div>
  </div>

  <div class="legend">
    <b style="color:#0f172a">Legend:</b>
    ${MODULES.map(m => `<span class="lg"><span class="swatch" style="background:${MOD_COLORS[m.key]}"></span>${m.name}</span>`).join('')}
    <span class="lg"><span class="fl pk">PK</span> primary key</span>
    <span class="lg"><span class="fl uq">UQ</span> unique</span>
    <span class="lg"><span class="fl fk">FK→</span> foreign key</span>
    <span class="lg">ชนิด: <span class="mono" style="color:#0369a1">TEXT</span> <span class="mono" style="color:#7c3aed">UUID</span> <span class="mono" style="color:#b45309">JSONB</span> <span class="mono" style="color:#15803d">INT/BIG/FLOAT</span> <span class="mono" style="color:#be185d">BOOL</span> <span class="mono" style="color:#475569">TS/DATE</span></span>
  </div>

  <div class="grid">
    <div class="rail">
      <div class="panel">
        <div class="ph">External Services · บริการภายนอก</div>
        <div class="pb"><div class="extsvc">
          ${EXTERNAL.map(e => `<div class="ext"><span class="dot" style="background:${e[2]}"></span><div><b>${e[0]}</b> — <span>${e[1]}</span></div></div>`).join('')}
        </div></div>
      </div>

      <div class="panel">
        <div class="ph">Shared JS Layer · <span style="font-size:13px;opacity:.8">shared/*.js (ใช้ร่วมทุกโมดูล)</span></div>
        <div class="pb"><div class="kv">
          ${SHARED_JS.map(s => `<div class="row1"><span class="k">${s[0]}</span><span class="v">${s[1]}</span></div>`).join('')}
        </div></div>
      </div>

      <div class="panel">
        <div class="ph">Edge / Workers / Proxy</div>
        <div class="pb tinylist"><div class="kv">
          ${EDGE.map(e => `<div class="row1"><span class="k">${e[0]}</span><span class="v">${e[1]}</span></div>`).join('')}
        </div></div>
      </div>

      <div class="panel">
        <div class="ph">Auth & Data Flow</div>
        <div class="pb">
          <div class="flow">
            <b>Login</b> → GAS HR API (verify employee/role) → session ใน localStorage (<span class="mono">pt_user_meta</span>, 8h)<br>
            ทุก request → Supabase <span class="mono">anon</span> client (RLS) · role check ฝั่ง client (Admin/admin)<br>
            <b>Realtime</b> → Supabase LISTEN/NOTIFY → UI sync (ไม่ต้องรีเฟรช)<br>
            <b>GPS</b> → proxy chain: Synology(1°) → Render(2°) → GAS(3°)<br>
            <b>รูป</b> → Cloudinary unsigned · รูปเก่า Drive → lh3 auto
          </div>
          <div class="note-rls"><b>⚠ RLS:</b> base layer ใช้ <span class="mono">anon</span> แบบกว้าง (USING true) — auth boundary อยู่ที่ GAS. Wave 9 เริ่มรัดกุม (notification_state, fa_event_tokens). loc_customers / gps_* anon-read แบบมีเงื่อนไข. line_*/notification = service_role.</div>
        </div>
      </div>

      <div class="panel">
        <div class="ph">Tools / Scripts</div>
        <div class="pb tinylist"><div class="kv">
          ${TOOLS.map(t => `<div class="row1"><span class="k">${t[0]}</span><span class="v">${t[1]}</span></div>`).join('')}
        </div></div>
      </div>
    </div>

    <div class="mods">
      ${MODULES.map(moduleBlock).join('')}
    </div>
  </div>

  <div class="foot">
    <div class="fpanel">
      <div class="ph">Functions / RPC / Triggers</div>
      <div class="pb">
        ${RPCS.map(r => `<div class="rpc"><span class="rn">${r[0]}</span><span class="rt">${r[1]}</span><span class="rd">— ${r[2]}</span></div>`).join('')}
      </div>
    </div>
    <div class="fpanel">
      <div class="ph">Realtime Publication · supabase_realtime</div>
      <div class="pb">
        <div class="rtchips">${REALTIME.map(t => `<span class="rtchip">${t}</span>`).join('')}</div>
        <div class="note-rls" style="background:#f0f9ff;border-color:#bae6fd"><b style="color:#0369a1">หมายเหตุ:</b> View = ไม่มี (ใช้ RLS แทน) · Enum = ไม่มี (ใช้ CHECK) · Storage bucket = ตั้งใน Dashboard · Auth = GAS (ไม่ใช้ Supabase Auth) · client = role anon</div>
      </div>
    </div>
    <div class="fpanel">
      <div class="ph">v1 → v2 · Deployment</div>
      <div class="pb tinylist"><div class="kv">
        <div class="row1"><span class="k">/v2/</span><span class="v">canonical (active app) · 3-col desktop + bottom nav mobile</span></div>
        <div class="row1"><span class="k">/v1/ root</span><span class="v">archived — ทุกหน้า meta-refresh redirect → /v2/</span></div>
        <div class="row1"><span class="k">sw.js</span><span class="v">PWA service worker (scope /v2/) · bump CACHE_NAME ตอน deploy</span></div>
        <div class="row1"><span class="k">manifest.json</span><span class="v">PWA install (มือถือ)</span></div>
        <div class="row1"><span class="k">shared.css/.js</span><span class="v">ธีม navy + drawer/kebab/print/auto-save (v2)</span></div>
        <div class="row1"><span class="k">chrome.css</span><span class="v">layout chrome หน้า admin</span></div>
        <div class="row1"><span class="k">deploy</span><span class="v">push main → GitHub Pages auto (CDN, static)</span></div>
      </div></div>
    </div>
  </div>

  <div class="brand">PT Medical System (Supwilai PT-Amb) · website map สร้างอัตโนมัติจาก migration/*.sql + sql/*.sql + v2/ pages · ${STAMP}</div>

</div>
</body></html>`;

(async () => {
  fs.writeFileSync(OUT_HTML, HTML, 'utf8');
  console.log('wrote', OUT_HTML);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 3178, height: 2245, deviceScaleFactor: 1 });
  await page.setContent(HTML, { waitUntil: 'domcontentloaded', timeout: 90000 });
  try { await Promise.race([page.evaluateHandle('document.fonts.ready'), new Promise(r => setTimeout(r, 12000))]); } catch (e) {}
  await new Promise(r => setTimeout(r, 1500));

  // Measure natural content height and scale-to-fit one A1 page if needed.
  const dims = await page.evaluate(() => {
    const s = document.getElementById('sheet');
    const rail = document.querySelector('.rail');
    const mods = document.querySelector('.mods');
    const foot = document.querySelector('.foot');
    return { w: s.scrollWidth, h: s.scrollHeight, rail: rail.offsetHeight, mods: mods.offsetHeight, foot: foot.offsetHeight };
  });
  const A1W = 3178, A1H = 2245; // px @96dpi (841x594mm)
  console.log('content', dims);
  let scale = 1;
  if (dims.h > A1H) {
    scale = A1H / dims.h;
    await page.evaluate((sc, w) => {
      const s = document.getElementById('sheet');
      s.style.transformOrigin = 'top left';
      s.style.transform = `scale(${sc})`;
      // keep full width usage by widening pre-scale so scaled width ~ A1W
      document.body.style.width = (w) + 'px';
      document.body.style.height = (3178) + 'px';
    }, scale, dims.w);
    console.log('scaled to fit, factor', scale.toFixed(3));
  }

  await page.pdf({
    path: OUT,
    width: '841mm',
    height: '594mm',
    printBackground: true,
    pageRanges: '1',
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  await browser.close();
  console.log('→ wrote', OUT);
})();
