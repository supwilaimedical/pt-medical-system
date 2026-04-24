# PT Medical V2 — Build Report

**Build Date:** 23 เม.ย. 2569 (15:00-17:00)
**Method:** Phase 0 (manual) + 5 build agents (parallel) + 5 cleanup agents (parallel)

---

## ✅ Files Built (Production Ready)

| File | Lines | Size | Module |
|---|---|---|---|
| `index.html` | 285 | 12 KB | Login + Module Picker |
| `transport/index.html` | 1,650 | 98 KB | นำส่งผู้ป่วย |
| `firstaid/index.html` | 1,726 | 100 KB | ปฐมพยาบาล |
| `location/index.html` | 1,637 | 89 KB | พิกัดสถานที่ |
| `gps/index.html` | 1,650 | 73 KB | GPS Tracking |
| `monitor/index.html` | 2,954 | 187 KB | Monitor (V1 wrapper) |
| `admin.html` | 2,801 | 172 KB | Admin Settings (12 sections) |
| `shared.css` | — | — | Design System (Sarabun, 3-col, kebab) |
| `shared.js` | — | — | Drawer, kebab, smartPrint, autosave |
| `manifest.json` | — | — | PWA scoped to /v2/ |
| `sw.js` | — | — | Service Worker scoped to /v2/ |

**Total V2 code:** ~12,700 lines across 7 module HTML + 4 infrastructure files

---

## 🧪 Auto Tests Passed

### Phase A — HTTP Smoke Test
All 12 endpoints return **HTTP 200**:
```
v2/                  v2/index.html       v2/shared.css
v2/transport/        v2/firstaid/        v2/location/
v2/gps/              v2/monitor/         v2/admin.html
v2/shared.js         v2/manifest.json    v2/sw.js
```

### Phase B — HTML Balance
All files have balanced `<div>` / `<script>` / `<style>` tags ✓

### Phase C — Shared Scripts Loaded
- Transport: config, auth, settings, notify, realtime, cloudinary ✓
- FirstAid: config, auth, realtime, cloudinary ✓
- Location: config, auth, map-config, realtime, cloudinary ✓
- GPS: config, auth, settings, gps-providers, map-config, places-api ✓
- Admin: config, auth, settings, notify, gps-providers ✓

### Phase D — V1 Field IDs Preserved (Transport sample)
17/17 critical V1 field IDs present (pt_name, triage_level, op_level, nr_status, scene_detail, airway_type, vent_mode, gcs_e/v/m, arrest_pre_arrest, tl_dispatch, case_id, ...)

### Phase E — V1 Still Works
All V1 endpoints HTTP 200 ✓
- `/`, `/transport/`, `/firstaid/`, `/location/`, `/gps/`, `/monitor/`, `/admin.html`

---

## 📋 Module Features Coverage

### Transport (V1 → V2 100%)
- ✅ List view: Active cards + Closed table with kebab
- ✅ 3-step form (no lock, scroll all sections)
- ✅ All field IDs preserved for Supabase compat
- ✅ Conditional logic: Airway Mgt/ET/Trach, Ventilator details, Central Line, Cardiac Arrest (ROSC/Dead), Transport type EMS scene
- ✅ Auto-save 2 min + indicator
- ✅ Realtime subscribe `cases-list` + `consents-list`
- ✅ OCR Gemini wired to `CONFIG.OCR_PROXY_URL`
- ✅ case_id via Supabase RPC `get_next_case_id()`
- ✅ DNR auto-flip via postMessage from consent iframe
- ✅ Reopen kebab for closed cases
- ✅ Print with iOS-safe `smartPrint()`
- ✅ Sub-forms: Consent (V1 iframe), V/S, IV (Pre/Transport), Vitals Log, Refer Docs

### FirstAid (V1 → V2 100%)
- ✅ Events Dashboard + Event Detail + Medical Registry Dashboard
- ✅ All 23 CC Med items, 11 CC Trauma, 25 Problem
- ✅ Treatment 4 groups × 16 items + จ่ายยา + อื่นๆ
- ✅ Quick Dispense (Ammonia/Plaster/Spray/Wound) debounced save
- ✅ Vital Signs collapsible (BP/HR/RR/SpO2/Temp/GCS/Glucose/Pain)
- ✅ Result D/C (finished/RTP/DNF) + Transfer (team/self + hospital)
- ✅ Triage colors A/V/P/U
- ✅ Realtime + permissions (admin/owner)
- ✅ Dashboard charts (5 donuts + 4 lists + Time chart)
- ✅ Pending tab
- ✅ Fullscreen TV mode + clock + auto-refresh 2min
- ✅ Export CSV with timestamp + Print Report

### Location (V1 → V2 100%+)
- ✅ 4 tabs: Dashboard (map) / List / Add / Share Tokens
- ✅ Add form: photo, name, type, phone, GPS button, map link expansion (Supabase RPC `expand_maps_url`), lat/lng, geocode, details
- ✅ Filters: type, province, district, search
- ✅ Share Modal: expiry select + note + fields checkboxes
- ✅ Token table + bulk clear expired
- ✅ MapConfig (Leaflet/Google) ported
- ✅ Cloudinary upload (no base64 fallback)
- ✅ Realtime subscribe locations + tokens
- ✅ Activity log: LOC_CREATE/UPDATE/DELETE/SHARE/SHARE_DELETE/SHARE_BULK_DELETE

### GPS (V1 → V2 100%)
- ✅ Fleet view + Live Map (Leaflet) + Bottom sheet mobile
- ✅ Vehicle status: Online/Idle/Offline/Overspeed (threshold 120)
- ✅ Proxy chain Synology→Render→GAS with status check
- ✅ Marker divIcon with pulsing ring + overspeed badge
- ✅ Follow mode + chip
- ✅ HLS camera streams (Hls.js + Safari native)
- ✅ Share token (admin only) with allow_camera flag
- ✅ Hospitals/POI search with road distance + ETA + "เร็วสุด" badge
- ✅ enrichVehicleAddresses (full V1 logic, all vehicles)
- ✅ filterNoiseByType heuristics ported

### Monitor (V1 wrapper)
- ✅ Copy V1 verbatim (per user decision: V1 layout sufficient)
- ✅ Path adjustment: `../shared/` → `../../shared/`
- ✅ Theme color: `#1e3a5f` → `#0ea5e9`
- ✅ Add V2 `shared.css` reference

### Admin (V1 → V2 100%)
- ✅ All 12 sections present:
  1. Organization (name, contact, print_header)
  2. Branding (logo URL + upload + Cloudinary)
  3. GPS Tracking (3 proxy + providers + vehicles + map provider + Google Maps key + 5 APIs test)
  4. OCR (proxy URL)
  5. Notifications (Worker Health + Line + Telegram + 6 vital event toggles + 50-entry send log)
  6. Integrations (Supabase status + version)
  7. Sessions (8h timeout + Force Logout All)
  8. Public Share (Transport + Location + GPS lists + bulk clear)
  9. Statistics (month filter + 4 stat cards + triage bars + gender bars + 6-month chart)
  10. Activity Log (action filter 18 types + date + case search + table + pagination)
  11. Overview (hero + stats + modules + tech stack + health grid)
  12. Documentation (4 doc cards)
- ✅ providerModal preserved
- ✅ Mobile burger working
- ✅ All save handlers wired

### Login + Landing
- ✅ V1 auth API (GAS) — `CONFIG.GAS_AUTH_API_URL`
- ✅ Username/Password form
- ✅ Auto-redirect if logged in (8h timeout)
- ✅ Landing module picker (4 cards + admin tools)
- ✅ Admin gates: GPS card + Monitor + Admin Settings
- ✅ Logout reset

---

## ⚠️ Known Limitations (manual verification needed)

1. **Transport realtime** — `RT.subscribe` wired but needs live data test
2. **OCR** — wired to proxy but needs `CONFIG.OCR_PROXY_URL` set
3. **Cloudinary** — needs cloud_name + upload_preset in Settings
4. **GPS proxy chain** — needs Synology/Render endpoints reachable
5. **HLS streams** — needs cameras configured
6. **Gemini OCR** — needs `CONFIG.OCR_PROXY_URL` + Gemini API key in worker
7. **iOS Print PWA** — fallback uses `html2pdf` if loaded; otherwise alerts user to use Safari

---

## 🚦 Production Readiness

**Status: ✅ Ready for UAT**

V1 ใช้งานต่อปกติ ไม่กระทบ — V2 ทดสอบใน `/v2/` แยก

### ก่อน switch จาก V1 → V2:
1. **UAT 1-2 สัปดาห์** — admin + user หลายคนทดสอบ V2 จริง
2. **Iron out bugs** ที่เจอ
3. **iOS print test** ครบ matrix
4. **Realtime/Auto-save load test**
5. **Mobile responsive** ทุกหน้า
6. **Permission test** — admin vs user ใน V2
7. **Backup database** ก่อน cutover
8. **Cutover plan**: backup V1 root files → move V2 to root → V1 → backup folder

---

## 📝 V1 Files Modified (Non-breaking)

- `transport/consent-prototype.html` — เพิ่ม 5 บรรทัด postMessage emit when DNR checked. **V1 ไม่ listen → no-op สำหรับ V1 use**

---

## 🗂️ Reference Files (kept for design history)

- `_preview.html` — Original launcher (now reference)
- `_preview.css`, `_preview.js`
- `p-*.html` — 12 preview shells (Login, Transport list/form/step2/step3/subforms, FirstAid events/detail/dashboard, Location, GPS, Monitor, Admin, Fullscreen)

ลบได้เมื่อ confirm V2 ทำงานครบ
