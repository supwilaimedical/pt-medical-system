# GPS Shared Link + ETA System — Portable Spec

> **Purpose:** Self-contained spec สำหรับ port ระบบ "แชร์ตำแหน่งรถพยาบาล + ETA real-time ให้ลูกค้า/ญาติ" ไปยังระบบอื่น (เช่น The Good PT)
>
> **Origin:** PT Medical System (Supwilai), commit reference: v2/gps/share.html + v2/gps/index.html + Cloudflare Worker
>
> **Date:** 2026-05-27

---

## Table of Contents

1. [Goal](#goal)
2. [Architecture](#architecture)
3. [Database Schema](#database-schema-supabase--postgres)
4. [Cloudflare Worker Endpoints](#cloudflare-worker-endpoints)
5. [Frontend Pages](#frontend-pages)
6. [Security & Privacy](#security--privacy)
7. [Google APIs Required](#google-apis-required)
8. [Gotchas](#gotchas-ที่เจอจริง-สำคัญ)
9. [File Structure](#file-structure)
10. [Acceptance Criteria](#acceptance-criteria)
11. [Reference Code Snippets](#reference-code-snippets)

---

## Goal

ระบบให้ paramedic แชร์ตำแหน่งรถพยาบาลแบบ real-time ให้ลูกค้า / ญาติคนไข้ / contractor ดูได้ พร้อม **ETA countdown** ที่ลดลงตามจริง โดยลูกค้าไม่ต้อง login

**Audience scope:**
- `customer` — ลูกค้าทั่วไป (เช่น คนจ้างเหมารถ)
- `relative` — ญาติคนไข้ที่อยู่ปลายทาง
- `contractor` — บริษัทรับงาน, ประกัน

---

## Architecture

```
[Paramedic Page]         [Customer Page]              [Cloudflare Worker]
gps/index.html    ─────► gps/share.html    ──────────► /api/route/refresh
  (auth required)          (anonymous, token-based)      ↓
       │                         │                  [Google APIs]
       │ create token            │ poll status        Directions API
       │                         │                    Distance Matrix
       ▼                         ▼                    Places API (New)
   [Supabase: gps_shared_tokens table]                Geocoding
       │                         ▲
       │ realtime row              │ read polyline + ETA
       └──── vehicle GPS row ◄────┘
```

**Key principle:** Google API key ห้ามอยู่ฝั่ง customer (anonymous) → ทุก Directions / Distance call ต้องผ่าน CF Worker

---

## Database Schema (Supabase / Postgres)

### Main table

```sql
CREATE TABLE gps_shared_tokens (
  token             TEXT PRIMARY KEY,           -- "TK-XXXXXXXX" (8-hex)
  vehicle_id        UUID NOT NULL REFERENCES vehicles(id),
  created_by        UUID NOT NULL REFERENCES auth.users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,        -- default +6 hours
  status            TEXT NOT NULL DEFAULT 'awaiting',
                    -- 'awaiting' | 'live' | 'arrived' | 'revoked' | 'expired'
  audience          TEXT NOT NULL,               -- 'customer' | 'relative' | 'contractor'
  reason            TEXT,                        -- log ทำไมแชร์
  show_speed        BOOLEAN NOT NULL DEFAULT TRUE,  -- paramedic toggle

  -- Destination (paramedic ตั้ง หรือ customer เลือก)
  dest_lat          DOUBLE PRECISION,
  dest_lng          DOUBLE PRECISION,
  dest_label        TEXT,
  dest_locked_at    TIMESTAMPTZ,                 -- เมื่อ customer ยืนยัน lock ห้ามเปลี่ยน

  -- Cached route data (อัปเดตจาก Worker)
  route_polyline    TEXT,                        -- Google encoded polyline
  route_updated_at  TIMESTAMPTZ,
  last_eta_seconds  INT,
  last_eta_at       TIMESTAMPTZ,
  last_distance_m   INT
);

CREATE INDEX idx_gps_tokens_vehicle ON gps_shared_tokens(vehicle_id, status);
CREATE INDEX idx_gps_tokens_expires ON gps_shared_tokens(expires_at)
  WHERE status IN ('awaiting','live');
```

### Cleanup trigger (clear ของหนักเมื่อ revoke)

```sql
CREATE OR REPLACE FUNCTION gps_shared_tokens_clear_on_revoke()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'Revoked' AND OLD.status <> 'Revoked' THEN
    NEW.route_polyline := NULL;
    NEW.route_updated_at := NULL;
    NEW.last_eta_seconds := NULL;
    NEW.last_eta_at := NULL;
    NEW.last_distance_m := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gps_shared_tokens_clear_on_revoke
  BEFORE UPDATE ON gps_shared_tokens
  FOR EACH ROW
  EXECUTE FUNCTION gps_shared_tokens_clear_on_revoke();
```

### Cleanup function (รัน periodic ผ่าน pg_cron)

```sql
CREATE OR REPLACE FUNCTION gps_shared_tokens_cleanup()
RETURNS TABLE(cleared_count INT, deleted_count INT)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_cleared INT;
  v_deleted INT;
BEGIN
  -- a) Clear heavy fields on tokens past expires_at
  UPDATE gps_shared_tokens
  SET route_polyline = NULL, route_updated_at = NULL,
      last_eta_seconds = NULL, last_eta_at = NULL, last_distance_m = NULL
  WHERE expires_at < NOW() AND route_polyline IS NOT NULL;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  -- b) DELETE old Revoked + very old Expired
  DELETE FROM gps_shared_tokens
  WHERE (status = 'Revoked' AND created_at < NOW() - INTERVAL '7 days')
     OR (expires_at < NOW() - INTERVAL '30 days');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_cleared, v_deleted;
END;
$$;
```

### RPC: `lock_customer_dest` (SECURITY DEFINER)

ให้ anonymous lock dest ได้ แต่ไม่ให้แก้ field อื่น:

```sql
CREATE OR REPLACE FUNCTION lock_customer_dest(
  p_token TEXT, p_lat FLOAT, p_lng FLOAT, p_label TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE gps_shared_tokens
  SET dest_lat = p_lat, dest_lng = p_lng, dest_label = p_label,
      dest_locked_at = NOW(), status = 'live'
  WHERE token = p_token AND status = 'awaiting' AND expires_at > NOW();
END;
$$;
GRANT EXECUTE ON FUNCTION lock_customer_dest TO anon;
```

### Row Level Security (RLS)

```sql
ALTER TABLE gps_shared_tokens ENABLE ROW LEVEL SECURITY;

-- anon: read เฉพาะ token ที่ยัง active
CREATE POLICY gps_tokens_anon_read ON gps_shared_tokens
  FOR SELECT TO anon
  USING (
    status IN ('awaiting','live','arrived')
    AND expires_at > NOW()
  );

-- paramedic: read/write เฉพาะ row ที่ตัวเองสร้าง
CREATE POLICY gps_tokens_owner_all ON gps_shared_tokens
  FOR ALL TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());
```

---

## Cloudflare Worker Endpoints

### Secrets

| Secret | Purpose |
|--------|---------|
| `GOOGLE_MAPS_KEY_SERVER` | Google API key (no referrer restriction) |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE` | Write polyline / ETA back to DB |
| `GOOGLE_SA_JSON` | Service Account JSON (for Usage panel) |

### `POST /api/route/refresh`

```json
// Request
{ "token": "TK-XXXXXXXX" }

// Response
{
  "ok": true,
  "eta_seconds": 845,
  "distance_m": 12400,
  "polyline": "encoded_polyline_string",
  "updated_at": "2026-05-27T10:30:00Z"
}
```

**Logic:**
1. Load token from Supabase → get `vehicle_id`, `dest_lat/lng`
2. Load latest vehicle GPS row (origin)
3. Call Google Directions API: origin → dest, `mode=driving`, `traffic_model=best_guess`
4. Write polyline + `duration_in_traffic` + distance back to `gps_shared_tokens`
5. Return ETA + polyline to caller

**Rate limit:** customer polls every 30s, debounce server-side ถ้าเรียกถี่กว่านี้

### `GET /api/quota/google`

อ่าน Cloud Monitoring API → return usage per SKU (สำหรับ admin Usage panel):

```
https://monitoring.googleapis.com/v3/projects/{PROJECT_ID}/timeSeries
?filter=metric.type="serviceruntime.googleapis.com/api/request_count"
&interval.endTime={NOW}
&interval.startTime={NOW-24h}
```

ใช้ Service Account JWT → exchange for access token → call Monitoring API

---

## Frontend Pages

### Paramedic: `gps/index.html` (authenticated)

**Share dialog ต้องมี:**

1. **เลือกรถ** — vehicle dropdown
2. **Dest mode toggle:**
   - "ตั้งจุดหมายให้เลย" → paramedic pick on map / search
   - "ให้ลูกค้าเลือก" → status เริ่มที่ `awaiting`
3. **Audience radio:** customer / relative / contractor
4. **Reason textarea** (required) — เก็บไว้ audit
5. **Toggle: แสดงความเร็วรถ** (default ON)
   - OFF = hide ตัวเลข speed ในหน้า customer (ยังเห็น pulse ring บอกว่ารถวิ่งอยู่)
6. **ปุ่ม "สร้างลิงก์"** → POST insert row → return token → show share URL + QR + copy button

**Loading state:** ตอน Directions API กำลังโหลด show spinner badge มุมบนขวาของแผนที่

**CSS pattern (toggle card):**
```css
.speed-toggle-card {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 12px;
  background: var(--navy-50, #eef2f8);
  border: 1px solid var(--navy-200, #c7d2e3);
  cursor: pointer;
  transition: background 120ms;
}
.speed-toggle-card:hover { background: var(--navy-100, #dde4ef); }
.speed-toggle-card input[type=checkbox] {
  width: 20px; height: 20px; accent-color: var(--navy-700, #1e3a8a);
}
```

### Customer: `gps/share.html?token=TK-XXXXXXXX` (anonymous)

**State machine:**

| Status | UI |
|--------|-----|
| `awaiting` | Centered modal ให้ลูกค้าเลือกจุดหมาย |
| `live` | แผนที่ + รถ marker + polyline + ETA countdown |
| `arrived` | "รถถึงปลายทางแล้ว ✅" |
| `revoked` | "ลิงก์ถูกยกเลิก" |
| `expired` | "ลิงก์หมดอายุ" |

**Dest picker modal (สำคัญ — ห้ามใช้ map-tap บน iOS):**

```html
<div class="dest-modal-overlay">
  <!-- fullscreen, position:fixed, inset:0, backdrop-filter:blur(8px) -->
  <div class="dest-modal-card">
    <!-- centered, max-width:420px, pop-in 180ms animation -->
    <div style="text-align:center; margin-bottom:16px;">
      <div style="font-size:2rem;">📍</div>
      <div>คุณจะติดตามรถถึงที่ไหน?</div>
    </div>

    <!-- Places text search (debounced 300ms) -->
    <input id="dest-search-input"
           placeholder="พิมพ์ชื่อสถานที่ (≥3 ตัว)..."
           style="width:100%; padding:12px; font-size:16px;">
    <div id="dest-search-results"></div>

    <div style="text-align:center; margin:12px 0; color:#888;">หรือ</div>

    <!-- Geolocation button -->
    <button id="btn-pick-geo">ใช้ตำแหน่งของฉัน</button>
  </div>
</div>
```

**CSS:**
```css
.dest-modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
}
.dest-modal-card {
  background: white;
  border-radius: 16px;
  padding: 24px;
  max-width: 420px; width: 100%;
  box-shadow: 0 20px 60px rgba(0,0,0,0.3);
  animation: pop-in 180ms ease-out;
}
@keyframes pop-in {
  from { opacity: 0; transform: scale(0.92); }
  to   { opacity: 1; transform: scale(1); }
}
```

**Search flow:**

```js
let _searchTimer;
document.getElementById('dest-search-input').addEventListener('input', (e) => {
  clearTimeout(_searchTimer);
  const q = e.target.value.trim();
  if (q.length < 3) return;
  _searchTimer = setTimeout(async () => {
    const places = await PlacesAPI.searchText({
      query: q,
      lat: userLat, lng: userLng,  // bias to current location if known
      radius: 50000,
      maxResults: 6
    });
    renderResults(places);
  }, 300);
});

function renderResults(places) {
  const html = places.map((p, i) =>
    `<button data-idx="${i}" data-lat="${p.lat}" data-lng="${p.lng}"
             data-label="${p.name}">
       <strong>${p.name}</strong><br>
       <small>${p.address}</small>
     </button>`
  ).join('');
  document.getElementById('dest-search-results').innerHTML = html;
}

// On result click → Swal confirm → lock
document.getElementById('dest-search-results').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-idx]');
  if (!btn) return;
  const { lat, lng, label } = btn.dataset;
  const ok = await Swal.fire({
    title: 'ยืนยันจุดหมาย?',
    text: label,
    showCancelButton: true,
    confirmButtonText: 'ใช่, ติดตามรถถึงที่นี่'
  });
  if (!ok.isConfirmed) return;
  await _supabase.rpc('lock_customer_dest', {
    p_token: TOKEN, p_lat: +lat, p_lng: +lng, p_label: label
  });
  // status will flip to 'live' → main poll loop picks it up
});
```

**ETA Countdown logic:**

```js
let _lastEtaSeconds = null;
let _lastEtaAt = null;

// Poll Worker every 30s
async function refreshRouteFromWorker() {
  showSpinner();
  try {
    const res = await fetch(WORKER_URL + '/api/route/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: TOKEN })
    });
    const data = await res.json();
    _lastEtaSeconds = data.eta_seconds;
    _lastEtaAt = Date.now();
    drawPolyline(data.polyline);
  } finally {
    hideSpinner();
  }
}
setInterval(refreshRouteFromWorker, 30_000);

// Local countdown ticks every 1s
setInterval(() => {
  if (_lastEtaSeconds == null) return;
  const elapsed = (Date.now() - _lastEtaAt) / 1000;
  const eta = Math.max(0, _lastEtaSeconds - elapsed);
  document.getElementById('eta-display').textContent = formatETA(eta);
}, 1000);

function formatETA(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m} นาที ${s} วินาที`;
}
```

**Speed display (conditional):**

```js
const showSpeed = (tokenData.show_speed !== false);
document.getElementById('speedDisplay').textContent =
  showSpeed ? speedNum.toFixed(1) : '—';

const speedUnit = document.querySelector('.speed-display .unit');
if (speedUnit) speedUnit.style.display = showSpeed ? '' : 'none';
// Pulse ring แสดงเสมอ — บอกว่ารถยังเคลื่อนไหวอยู่
```

---

## Security & Privacy

1. **Token entropy:** UUIDv4 หรือ 8-hex random (≥ 32 bits) — guess-resistant
2. **Expires:** default 6 ชั่วโมง, paramedic ตั้งได้
3. **RLS** บน `gps_shared_tokens`:
   - anon: SELECT เฉพาะ active token
   - paramedic: SELECT/UPDATE เฉพาะ row ตัวเอง
4. **No API key on client** — ทุก Directions/Distance call ผ่าน Worker
5. **Audit:** ทุกการสร้าง token log ลง activity table พร้อม reason
6. **Revoke flow:** paramedic กดปุ่ม revoke → status='Revoked' → trigger clear polyline ทันที
7. **PDPA:** dest_label ของลูกค้าเก็บไว้เท่าที่จำเป็น, cleanup function ลบ Revoked > 7d, Expired > 30d
8. **CORS on Worker:** allow เฉพาะ domain ของ frontend (อย่าเปิด `*`)

---

## Google APIs Required

### เปิดใน GCP project

| API | ใช้ที่ไหน |
|-----|---------|
| **Maps JavaScript API** | render แผนที่ฝั่ง paramedic |
| **Places API (New)** | `places.googleapis.com/v1/places:searchText` (text search) |
| **Directions API** | Worker เรียก route + ETA |
| **Distance Matrix API** | backup สำหรับ multi-stop ETA |
| **Geocoding API** | reverse geocode coords → label |

### 2 API Keys

| Key | Restriction | ใช้ที่ไหน |
|-----|------------|---------|
| **Frontend** | HTTP referrer allowlist (your domain) | Maps JS only |
| **Server** | None (or IP-restrict to CF Worker) | Directions / Places / Geocoding |

### Service Account (optional, สำหรับ Usage panel)

- Role: `roles/monitoring.viewer`
- เก็บ JSON ใน Worker secret `GOOGLE_SA_JSON`
- เรียก `monitoring.googleapis.com/v3/projects/{id}/timeSeries`

---

## Gotchas ที่เจอจริง (สำคัญ!)

1. **iOS Safari map-tap ผ่าน overlay ไม่ได้** — pointer-events ไม่ผ่าน fullscreen overlay reliably → ใช้ **search + geolocation only** ห้ามให้กดบนแผนที่
2. **SweetAlert ต้อง load CDN** — `<script src="https://cdn.jsdelivr.net/npm/sweetalert2@11"></script>` ไม่งั้น `Swal.fire()` silent fail (ReferenceError ที่ไม่มี user feedback)
3. **API key typo l/I** — Google key มี character ที่ดูเหมือนกัน (lowercase L vs uppercase I) → **copy-paste เท่านั้น** อย่าพิมพ์เอง verify ด้วย char-by-char compare
4. **CF Worker secret update บน Windows** — `wrangler secret put` มี newline ปนเข้ามา → ใช้ Dashboard paste แทน หรือใช้ CF REST API
5. **Service Worker cache** — bump `CACHE_NAME` ทุกครั้งที่แก้ CSS / JS ของ share viewer ไม่งั้นลูกค้าเห็น cached เก่า
6. **Speed = 0 ไม่ได้แปลว่ารถจอด** — GPS noise; ใช้ moving average หรือ threshold > 2 km/h ถึงจะถือว่าวิ่ง
7. **ETA bouncing** — Directions API คืน ETA ที่ขึ้น/ลงได้ เพราะ traffic model อัปเดต → ไม่ใช่ bug, อธิบายให้ user เข้าใจ ("ETA อาจเพิ่มขึ้นถ้ารถติด")
8. **Polyline decoding** — Google ใช้ encoded polyline format ของตัวเอง ต้อง decode ก่อน plot บน Leaflet (ใช้ `@mapbox/polyline` หรือ inline decoder)
9. **Anonymous role permission** — RPC `lock_customer_dest` ต้อง `SECURITY DEFINER` + `GRANT EXECUTE TO anon` ไม่งั้น anon เรียกไม่ได้
10. **Realtime row filter** — ถ้าใช้ Supabase Realtime subscribe vehicle GPS, RLS ต้อง allow anon อ่าน vehicle row นั้นด้วย (filter by vehicle_id ใน RLS policy) — ไม่งั้น realtime ไม่ทำงาน

---

## File Structure

```
/v2/gps/
  index.html              # paramedic share creator
  share.html              # customer viewer (anonymous)
/shared/
  map-config.js           # load Google Maps key from settings table
  places-api.js           # Places API (New) wrapper
  gps-providers.js        # vehicle GPS adapter (extensible)
/migration/
  gps_share_show_speed.sql
  gps_share_eta_cleanup.sql
/worker/
  index.js                # CF Worker: /api/route/refresh, /api/quota/google
  wrangler.toml
/v2/
  sw.js                   # Service Worker (bump CACHE_NAME on share.html change!)
```

---

## Acceptance Criteria

- [ ] Paramedic สร้าง link ได้ภายใน 3 คลิก
- [ ] Customer เปิด link → ไม่ต้อง login → เห็นแผนที่ภายใน 2 วินาที
- [ ] ETA countdown ลดลงทุก 1 วินาที, refresh จริงทุก 30 วินาที
- [ ] Polyline render ภายใน 1 วินาทีหลัง dest lock
- [ ] Toggle `show_speed` ทำงานทั้ง 2 ทิศ (ON/OFF) reflect ในหน้า customer ทันที (next poll)
- [ ] Revoke → customer page เปลี่ยน state ภายใน 30s + polyline หาย
- [ ] Token หมดอายุ → state เป็น expired, polyline clear
- [ ] Mobile (iOS Safari + Android Chrome) modal + search ใช้งานได้
- [ ] Google API quota panel แสดง usage real (ผ่าน SA + Monitoring API)
- [ ] No Google API key exposed in client source / network tab

---

## Reference Code Snippets

### Places API (New) Wrapper

```js
// shared/places-api.js
window.PlacesAPI = {
  async searchText({ query, lat, lng, radius = 50000, maxResults = 6 }) {
    const key = await MapConfig.get('frontend_key');
    const body = {
      textQuery: query,
      maxResultCount: maxResults,
      locationBias: lat && lng ? {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radius
        }
      } : undefined,
      languageCode: 'th',
      regionCode: 'TH'
    };
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    return (data.places || []).map(p => ({
      name: p.displayName?.text,
      address: p.formattedAddress,
      lat: p.location?.latitude,
      lng: p.location?.longitude
    }));
  }
};
```

### CF Worker — Directions API call

```js
// worker/index.js (excerpt)
async function refreshRoute(env, token) {
  // 1. Load token + vehicle position
  const supa = createSupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE);
  const { data: tk } = await supa.from('gps_shared_tokens')
    .select('vehicle_id, dest_lat, dest_lng, status')
    .eq('token', token).single();

  if (!tk || tk.status !== 'live') {
    return { ok: false, error: 'token_not_live' };
  }

  const { data: gps } = await supa.from('vehicle_gps_latest')
    .select('lat, lng').eq('vehicle_id', tk.vehicle_id).single();

  // 2. Call Google Directions
  const url = `https://maps.googleapis.com/maps/api/directions/json?` +
    `origin=${gps.lat},${gps.lng}&destination=${tk.dest_lat},${tk.dest_lng}` +
    `&mode=driving&departure_time=now&traffic_model=best_guess` +
    `&key=${env.GOOGLE_MAPS_KEY_SERVER}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') return { ok: false, error: data.status };

  const route = data.routes[0];
  const leg = route.legs[0];
  const polyline = route.overview_polyline.points;
  const etaSec = leg.duration_in_traffic?.value || leg.duration.value;
  const distM = leg.distance.value;

  // 3. Write back
  await supa.from('gps_shared_tokens').update({
    route_polyline: polyline,
    route_updated_at: new Date().toISOString(),
    last_eta_seconds: etaSec,
    last_eta_at: new Date().toISOString(),
    last_distance_m: distM
  }).eq('token', token);

  return {
    ok: true,
    eta_seconds: etaSec,
    distance_m: distM,
    polyline,
    updated_at: new Date().toISOString()
  };
}
```

### Leaflet polyline decoder (no external lib)

```js
function decodePolyline(str, precision = 5) {
  let index = 0, lat = 0, lng = 0;
  const coordinates = [];
  const factor = Math.pow(10, precision);
  while (index < str.length) {
    let result = 1, shift = 0, b;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    result = 1; shift = 0;
    do {
      b = str.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coordinates.push([lat / factor, lng / factor]);
  }
  return coordinates;
}

// Usage
const latlngs = decodePolyline(data.polyline);
L.polyline(latlngs, { color: '#1e3a8a', weight: 5 }).addTo(map);
```

---

## Cost Estimation (Google Maps API)

ที่ usage ปกติ (~100 share links/day, ETA refresh ทุก 30s, share อายุเฉลี่ย 30 นาที):

| SKU | Calls/day | Cost/1000 | Daily |
|-----|-----------|-----------|-------|
| Directions API | ~6,000 | $5 | $30 |
| Places (Text Search) | ~200 | $32 | $6.40 |
| Maps JS (load) | ~500 | $7 | $3.50 |
| Geocoding | ~100 | $5 | $0.50 |
| **Total** | | | **~$40/day = ~$1,200/month** |

**Mitigation:**
- Cache polyline ใน DB → ไม่ต้อง call ซ้ำถ้า dest ไม่เปลี่ยน
- Distance Matrix แทน Directions ถ้าไม่ต้องการ polyline (ถูกกว่า)
- $200/month free credit ของ Google คุ้มแค่ ~5,000 Directions calls

---

## Migration Order (เมื่อ port ไปยัง The Good PT)

1. **DB schema** — รัน `gps_shared_tokens` table + trigger + RPC + RLS
2. **GCP project setup** — เปิด APIs, สร้าง 2 keys, สร้าง SA
3. **CF Worker** — deploy พร้อม secrets
4. **Settings table** — เก็บ `frontend_key` + `worker_url`
5. **Paramedic page** — share dialog
6. **Customer page** — `share.html` + modal + ETA
7. **Service Worker** — bump cache version
8. **Admin Usage panel** — quota viewer
9. **E2E test** — สร้าง token → ลูกค้าเลือก dest → ETA นับ → revoke → cleanup

---

**ติดต่อ owner สำหรับ reference code:**
- Repo: `https://github.com/supwilaimedical/pt-medical-system`
- Live demo (paramedic): `https://supwilaimedical.github.io/pt-medical-system/v2/gps/`
- Live share viewer: `https://supwilaimedical.github.io/pt-medical-system/v2/gps/share.html?token=<TOKEN>`

---

*Generated: 2026-05-27 — PT Medical System V2*
