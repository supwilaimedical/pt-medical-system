# GPS Shared Link + ETA — Design Spec

**Date:** 2026-05-26
**Author:** Brainstormed with paramedic-user (sit-pex)
**Status:** Draft → awaiting review

---

## 1. Purpose

Extend the existing **GPS Share Link** feature (`gps_shared_tokens`) so a
paramedic can share a real-time vehicle-tracking link **with a destination
attached**, and the customer-side viewer shows a **live ETA** ("ถึงใน X นาที")
that updates as the vehicle moves.

Today the share link only shows the live vehicle marker. The customer has no
sense of "when will it arrive" — they must zoom out, eyeball it, refresh.
This feature closes that gap with Google Distance Matrix, cached on the server,
displayed with a smooth client-side countdown.

### Out of scope
- Customer-side authentication (link itself is the credential — opaque token)
- Route polyline drawing (Directions API — future, expensive — not Phase 1)
- Vehicle-to-vehicle ETAs (different feature)
- Hospital pre-arrival notification automation (future Phase 2 — add LINE message hook)

---

## 2. User stories

### Paramedic (PT-Amb dispatcher / driver)
1. As a paramedic, I open the GPS Tracking page, pick the vehicle, click "Share
   Link", choose **how long** (1 / 4 / 12 / 24 hr), choose **who picks the
   destination** (I do, or the customer does), and get a copyable URL.
2. As a paramedic, when I set the destination, I want **4 input methods**:
   paste Google Maps link, type-ahead search, pick from nearby-hospital preset,
   or click on the map.
3. As a paramedic, I want to **see all my active share links** in the existing
   GPS Share panel, with **revoke** button per row.
4. As a paramedic, I want **revoked / expired** links to redirect the customer
   to a clean **"Link หมดอายุ"** screen — not a crashed page.

### Customer (ญาติคนไข้ / contractor)
5. As a family member, I open the link → see the ambulance moving on a map +
   ETA "ถึงใน 12 นาที" (countdown decreasing).
6. As a family member, if the paramedic set the destination **myself**, the link
   asks me **once**: "Where do you want to track to?" → I tap on map OR tap
   "📍 ใช้ตำแหน่งของฉัน". After I confirm, **destination is locked** — no more
   changes.
7. As a family member, if the GPS signal drops, I want to see **"ไม่มีสัญญาณ"**
   with the **last-known position** still on map — not blank.

### Admin
8. As an admin, I want the **Public Share** admin panel (existing) to keep
   working — listing all tokens regardless of who created them, with the
   destination + ETA shown.

---

## 3. Architecture

### High-level

```
                            ┌──────────────────────┐
                            │ Paramedic (gps page) │
                            └─────────┬────────────┘
              (Insert + dest)         │
                          ┌───────────▼───────────┐
                          │ gps_shared_tokens     │  Supabase Postgres
                          │  (extended schema)    │  (single source of truth)
                          └──────────┬────────────┘
                                     │  realtime channel (existing)
                                     │
                ┌────────────────────┼────────────────────────────┐
                │                    │                            │
        ┌───────▼────────┐   ┌───────▼────────┐    ┌──────────────▼───────┐
        │ CF Worker       │   │ Customer       │    │ Admin panel          │
        │ /eta/refresh    │   │ share.html     │    │ (Public Share, list) │
        │   • call Google │   │   • read cache │    │                      │
        │     Distance Mx │   │   • countdown  │    └──────────────────────┘
        │   • write cache │   │   • lock dest  │
        │   • adaptive    │   └────────────────┘
        │     cadence     │
        └─────────────────┘
```

### Component responsibilities

**Customer share viewer (`v2/gps/share.html` — extended):**
- Reads token from URL `?token=TK-XXXXXXXX`
- Fetches `gps_shared_tokens` row + vehicle's latest position (existing realtime channel)
- If `dest_mode='customer_choose'` and `dest_locked_at IS NULL` → show dest-picker UI
- Once dest is set → call Worker `/eta/refresh?token=...` (Worker writes back to DB)
- Subscribe to `gps_shared_tokens` realtime channel → update `last_eta_seconds` on row change
- Show ETA as countdown: server tells you "ETA was X seconds at timestamp T" → client computes "now is T+Δ → ETA = X − Δ" every second, smooth display
- If GPS position stale (>2 min) → show "ไม่มีสัญญาณ" + last-known marker grayed
- If `status='Revoked'` or `expires_at < now()` → redirect to `/v2/gps/share-expired.html` (new tiny page)

**Cloudflare Worker (`cloudflare/ocr-proxy-worker.js` — extended):**
- New route: `GET /eta/refresh?token=...`
- Service-role Supabase client: read token row, read vehicle current position
- Decide cadence: if vehicle moving (last 5 min position-delta > 50 m) → cap one refresh per **5 min** per token. If stopped → one per **2 min**. If just-locked → call immediately regardless.
- If cooldown not met → return cached row, do NOT call Distance Matrix
- If cooldown met:
  - Call `https://maps.googleapis.com/maps/api/distancematrix/json?origins=lat,lng&destinations=lat,lng&key=...&departure_time=now&mode=driving&language=th`
  - Parse `duration_in_traffic.value` (seconds) and `distance.value` (meters)
  - `UPDATE gps_shared_tokens SET last_eta_seconds=?, last_eta_at=NOW(), last_distance_m=? WHERE token=?`
  - Return fresh values
- Race-condition guard: SELECT ... FOR UPDATE NOWAIT to prevent two parallel refreshes (cheap PG advisory lock OR client_id query param de-dupe — see §5)
- Reuse Worker's existing Google key infrastructure (we already have it for Monitoring API quota dashboard).

**Database (`gps_shared_tokens` table — extended):**
- Add 10 columns (see §4)
- RLS: customer share viewer reads via `anon` role with `WHERE token = $1 AND status='Active' AND expires_at > NOW()` (existing pattern)
- Worker writes via `service_role` (existing pattern)
- Paramedic-side writes via `authenticated` (existing pattern)

---

## 4. Schema

### Existing table (DO NOT recreate — extend with ALTER)

```sql
-- /migration/gps_schema.sql  (already deployed)
CREATE TABLE gps_shared_tokens (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  token       TEXT UNIQUE NOT NULL,        -- 'TK-XXXXXXXX'
  device_id   TEXT NOT NULL,
  provider    TEXT REFERENCES gps_providers(id),
  expires_at  TIMESTAMPTZ NOT NULL,
  created_by  TEXT,
  reason      TEXT,
  status      TEXT DEFAULT 'Active',       -- 'Active' | 'Revoked'
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  allow_camera BOOLEAN DEFAULT false       -- from /migration/gps_share_camera.sql
);
```

### Migration to add ETA columns (`/migration/gps_share_eta.sql`)

```sql
ALTER TABLE gps_shared_tokens
  ADD COLUMN IF NOT EXISTS ttl_hours        INT  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dest_mode        TEXT NOT NULL DEFAULT 'paramedic_set'
    CHECK (dest_mode IN ('paramedic_set', 'customer_choose')),
  ADD COLUMN IF NOT EXISTS dest_lat         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dest_lng         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dest_name        TEXT,
  ADD COLUMN IF NOT EXISTS dest_source      TEXT
    CHECK (dest_source IN ('link', 'search', 'preset', 'map_click',
                           'customer_map_pick', 'customer_geo') OR dest_source IS NULL),
  ADD COLUMN IF NOT EXISTS dest_locked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audience         TEXT
    CHECK (audience IN ('family', 'contractor') OR audience IS NULL),
  ADD COLUMN IF NOT EXISTS last_eta_seconds INT,
  ADD COLUMN IF NOT EXISTS last_eta_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_distance_m  INT;

-- Index for Worker cooldown lookups
CREATE INDEX IF NOT EXISTS gps_shared_tokens_token_active_idx
  ON gps_shared_tokens (token)
  WHERE status = 'Active';

-- Index for paramedic's "my active links" view
CREATE INDEX IF NOT EXISTS gps_shared_tokens_created_by_active_idx
  ON gps_shared_tokens (created_by, expires_at DESC)
  WHERE status = 'Active';
```

### Field semantics

| Field | Mode `paramedic_set` | Mode `customer_choose` |
|---|---|---|
| `dest_lat`, `dest_lng` | Set at INSERT | NULL → set when customer locks |
| `dest_name` | Set at INSERT | NULL → "ตำแหน่งของคุณ" / "จุดที่คุณเลือก" |
| `dest_source` | `link \| search \| preset \| map_click` | `customer_map_pick \| customer_geo` |
| `dest_locked_at` | = `created_at` (immediate) | NULL → NOW() on first customer lock |
| `last_eta_*` | populated by Worker after first refresh | populated after lock + first refresh |

### TTL options (radio in paramedic UI)

| Value | Label | Default? |
|---|---|---|
| `1`  | 1 ชั่วโมง (Quick run) | ✅ |
| `4`  | 4 ชั่วโมง (Standard) |   |
| `12` | 12 ชั่วโมง (Long run) |   |
| `24` | 24 ชั่วโมง (Overnight) |   |

`expires_at = created_at + ttl_hours * 1 hour`. TTL countdown starts from
`created_at` (not `dest_locked_at`) — guarantees no abandoned links linger.

---

## 5. Race condition prevention

Three concurrency hazards:

### H1: Two customers tap "Lock destination" simultaneously
**Mode customer_choose** — multiple tabs/devices open the same link, all submit different destinations.

**Fix:** PATCH uses `WHERE dest_locked_at IS NULL` as a guard. The second
UPDATE matches zero rows, returns `0 rowcount` to the second caller — they see
"This link's destination is already set" message + reload to view live ETA.

```js
// share.html — customer dest lock
const { data, error } = await supabase
  .from('gps_shared_tokens')
  .update({
    dest_lat: pickedLat,
    dest_lng: pickedLng,
    dest_name: pickedName,
    dest_source: pickedSource,   // 'customer_map_pick' | 'customer_geo'
    dest_locked_at: new Date().toISOString()
  })
  .eq('token', token)
  .is('dest_locked_at', null)    // ← the guard
  .select();

if (!data || data.length === 0) {
  // Already locked by someone else — refetch and show ETA view
  await refreshTokenRow();
  showEtaView();
  return;
}
```

### H2: Two share viewers trigger `/eta/refresh` at the same instant
Both think cooldown has passed → both call Distance Matrix → 2× billed elements.

**Fix:** Worker SELECT ... `FOR UPDATE NOWAIT` on the token row (PG locks row,
second transaction errors immediately). On error, second caller skips the
Google call and returns the (just-written) cached value.

```js
// Worker pseudocode
BEGIN;
SELECT last_eta_at, ... FROM gps_shared_tokens
  WHERE token = $1 AND status = 'Active' AND expires_at > NOW()
  FOR UPDATE NOWAIT;            -- ← H2 guard
-- If error code 55P03 (lock_not_available): return current cached row
IF cooldown_not_met: return cached_row;
ELSE: call DistanceMatrix; UPDATE row; COMMIT;
```

### H3: Stale cache after vehicle stops at hospital
ETA cached says "5 min remaining" but vehicle has been parked for 20 min.

**Fix:** Customer-side countdown caps display at `max(0, eta_at + last_eta_seconds - now())`. If vehicle hasn't moved in 3+ minutes AND `last_distance_m < 100` → show "**ถึงปลายทางแล้ว**" badge, stop countdown.

---

## 6. Adaptive cadence (free-tier budget)

Goal: stay well under 10k Distance Matrix calls per month while keeping ETA
fresh enough that the customer doesn't notice staleness.

| State (per token) | Refresh cadence | Detection |
|---|---|---|
| Vehicle moving | **every 5 min** | last 5-min position delta > 50 m |
| Vehicle stopped | **every 2 min** | last 5-min position delta ≤ 50 m AND `last_distance_m > 100` |
| Vehicle "arrived" | **stop refreshing** | `last_distance_m < 100` and stopped 3 min |
| Just locked | **immediate (1× burst)** | `last_eta_at IS NULL` |

**Cost back-of-napkin:** A typical transfer is ~30 min. At 5-min cadence
moving, that's 6 calls per transfer. With ~50 transfers/day × 6 calls = 300
calls/day = 9000/month — well within 10k free tier. Multiple concurrent
customers viewing the same token **share the same cached row** (the Worker
returns cache, doesn't re-call Google), so audience size doesn't multiply cost.

**Frontend countdown** smooths the gap: between Worker refreshes, the share
page locally decrements `(last_eta_seconds - elapsed_since_last_eta_at)` every
second so the number always looks alive.

---

## 7. UI specification

### Paramedic side — Share dialog (extend existing modal)

The existing share dialog in `v2/gps/index.html` has:
- Device selector
- TTL hours (currently free-text or fixed)
- Reason (text)
- Allow-camera toggle

**New additions:**

```
─────────────────────────────────────────────
ปลายทาง  (radio toggle, default "ตั้งเอง")
  ● ฉันตั้งปลายทางเลย
  ○ ให้ลูกค้าเลือกเอง
─────────────────────────────────────────────
[ Expands when "ตั้งเอง" selected: ]

  วิธีตั้ง:  [📋 Paste Link] [🔍 ค้นหา] [🏥 รพ.ใกล้] [📍 บนแผนที่]

  วิธี 1 — Paste Google Maps link:
    [ https://maps.app.goo.gl/...                              ]
    [Decode]   → ✓ พบพิกัด: 15.7008, 100.1362 (รพ.ร่มฉัตร)

  วิธี 2 — ค้นหา:
    [ พิมพ์ชื่อสถานที่...                         ] (Places autocomplete)

  วิธี 3 — รพ. ใกล้รถ:
    Dropdown ใช้ผลจาก searchHospitalsCombined()
    (15 รพ. — sorted by distance)

  วิธี 4 — บนแผนที่:
    [ปุ่ม "เลือกบนแผนที่"] → opens full-screen map picker
─────────────────────────────────────────────
ระยะเวลา
  ○ 1 ชม.   ● 1 ชม. (default)   ○ 4 ชม.   ○ 12 ชม.   ○ 24 ชม.
─────────────────────────────────────────────
ประเภทผู้รับ (optional)
  ○ ญาติคนไข้   ○ Contractor
─────────────────────────────────────────────
อนุญาตให้ดูกล้อง (existing checkbox)
─────────────────────────────────────────────
[สร้างลิงก์]
```

### Paramedic side — Active links list (existing panel, augment row)

Each row in the existing token list gains:

```
TK-A1B2C3D4                       [● Active]
รถ: คันที่ 1 (ALS) · สิทธาคม · 3 ชม. เหลือ
ปลายทาง: รพ.ร่มฉัตร · ETA 8 นาที (อัปเดต 2 นาทีก่อน)
   [📋 Copy URL]  [🔄 รีเฟรช ETA]  [⛔ Revoke]  [🗑️ Delete]
```

When `dest_mode='customer_choose'` and `dest_locked_at IS NULL`:
```
ปลายทาง: รอลูกค้าเลือก... · ETA: —
```

### Customer side — `share.html` (extend existing viewer)

Three states:

**State A — Awaiting destination (customer_choose only):**
```
┌─────────────────────────────────────────────┐
│ 🚑 รถคันที่ 1 (ALS) · ออกจาก รพ.ร่มฉัตร       │
│ (live map with vehicle marker)              │
├─────────────────────────────────────────────┤
│ คุณจะติดตามรถถึงที่ไหน?                       │
│                                             │
│   [🗺️ เลือกบนแผนที่]    [📍 ใช้ตำแหน่งฉัน]   │
└─────────────────────────────────────────────┘
```

**State B — Locked, live ETA:**
```
┌─────────────────────────────────────────────┐
│ 🚑 รถคันที่ 1 (ALS)                          │
│ (live map with vehicle + dest marker + line) │
├─────────────────────────────────────────────┤
│  ⏱  ถึงใน 8 นาที 23 วินาที                  │
│  📍 1.4 กม. · 60 กม./ชม. · เวลา 19:42       │
│  (countdown ticks every second)             │
└─────────────────────────────────────────────┘
```

**State C — Arrived / signal lost / expired:**
```
ถึงปลายทางแล้ว ✓
ไม่มีสัญญาณ — ตำแหน่งล่าสุด 5 นาทีที่แล้ว
ลิงก์นี้หมดอายุแล้ว (redirect ไป share-expired.html)
```

### Customer side — destination picker (state A → B)

Map-pick: tap-on-map mode, single pin, "ยืนยัน" button. On confirm, PATCH with `dest_source='customer_map_pick'`.

Geolocation: tap "📍 ใช้ตำแหน่งฉัน" → browser native `navigator.geolocation.getCurrentPosition()` → on accept, PATCH with `dest_source='customer_geo'`. If user denies → toast "ต้องอนุญาตการเข้าถึงตำแหน่งก่อน" + back to picker.

---

## 8. Endpoint contracts

### Worker — `GET /eta/refresh?token=TK-XXXXXXXX`

```
Response 200 (cache hit or refreshed):
{
  "ok": true,
  "eta_seconds": 503,
  "eta_at": "2026-05-26T19:42:13Z",
  "distance_m": 1420,
  "fresh": true,          // true if just-called Google, false if served cached
  "next_refresh_in": 287  // seconds until next allowed refresh
}

Response 404 (token revoked / expired / not found):
{ "ok": false, "error": "TOKEN_INVALID" }

Response 409 (dest not yet locked — customer_choose mode):
{ "ok": false, "error": "DEST_NOT_LOCKED" }

Response 503 (Google Distance Matrix returned error):
{ "ok": false, "error": "DISTANCE_MATRIX_FAILED", "detail": "..." }
```

### Frontend polling

`share.html` polls `/eta/refresh` once on dest-lock, then aligns to the
`next_refresh_in` window (typically 2-5 min). In between, runs a 1 Hz local
countdown timer based on `eta_seconds + (now - eta_at)`.

---

## 9. Security & RLS

### Token entropy
Existing token format `TK-` + 8 hex chars = ~32 bits ≈ 4 billion combinations.
For a public-share use case with no PII beyond vehicle position + ETA, that's
acceptable. We do NOT need to upgrade to UUID-128 here (existing decision —
see `memory/working_rules.md` and earlier wave hardening).

### RLS

```sql
-- Anonymous read for share viewer (existing pattern)
CREATE POLICY "anon_select_active" ON gps_shared_tokens
  FOR SELECT TO anon
  USING (status = 'Active' AND expires_at > NOW());

-- Anon UPDATE for dest lock (NEW — limited to fields + guard)
CREATE POLICY "anon_lock_dest" ON gps_shared_tokens
  FOR UPDATE TO anon
  USING (
    status = 'Active'
    AND expires_at > NOW()
    AND dest_locked_at IS NULL
    AND dest_mode = 'customer_choose'
  )
  WITH CHECK (
    status = 'Active'              -- can't escalate
    AND dest_locked_at IS NOT NULL -- must set lock timestamp
    AND dest_lat IS NOT NULL
    AND dest_lng IS NOT NULL
    AND dest_source IN ('customer_map_pick', 'customer_geo')
  );
```

The customer can only ever PATCH the destination ONCE and only into the two
customer-source values. They cannot revoke, change TTL, change vehicle, etc.

### Worker auth to Supabase
Reuses existing `WEBHOOK_SECRET` + service-role pattern from notification chain
(see `memory/notification_plan.md`).

---

## 10. Failure modes & UX

| Scenario | Customer sees | Paramedic sees |
|---|---|---|
| Token revoked mid-view | Redirect to `/share-expired.html` | Row badge "Revoked" |
| Token expired (TTL) | Same as revoked | Row faded, "Expired" badge |
| GPS signal lost (vehicle > 2 min stale) | "ไม่มีสัญญาณ" banner over map, last-known marker dimmed | Same indicator in token list |
| Distance Matrix API down | Last cached ETA still shows; banner "อัปเดต ETA ล่าช้า" | — |
| Vehicle ARRIVED (within 100m, stopped) | "ถึงปลายทางแล้ว ✓" badge, countdown stops | Row label "Arrived" |
| Two customers lock dest concurrently | First wins; second sees locked view immediately | No effect |
| Worker cold-start (Cloudflare) | First load slightly slower; subsequent refreshes fast | No effect |

---

## 11. Files to touch (decomposition)

### New files
- `migration/gps_share_eta.sql` — 10 ALTER COLUMN + 2 indexes + 1 RLS policy
- `v2/gps/share-expired.html` — tiny static page, no JS, just message + back-to-home

### Extend
- `v2/gps/index.html` — share dialog (4 dest-input methods, TTL radio, audience radio); active-list row (dest + ETA + revoke wired); state badges
- `v2/gps/share.html` — 3-state viewer (awaiting / locked / arrived); destination picker; countdown timer; realtime subscription
- `shared/places-api.js` — already has `searchHospitalsCombined` (just-added). Add `decodeGoogleMapsLink(url)` helper for paste-link method.
- `cloudflare/ocr-proxy-worker.js` — add `/eta/refresh` route + Distance Matrix call + advisory lock via `FOR UPDATE NOWAIT` + adaptive cadence calc

### No change required
- `gps_shared_tokens` existing RLS policies (anon SELECT, authenticated CRUD) stay
- `gps_vehicles` realtime channel (already publishes positions)
- Admin Public Share panel (reads same columns — will just show extra fields)

---

## 12. Test plan

### Manual smoke tests (paramedic-tester)
1. **T1 — Paramedic-set, link decode:** paste `https://maps.app.goo.gl/abc`, expect lat/lng decoded + place name shown. → SHARE → open URL in incognito → expect ETA within 10 s.
2. **T2 — Paramedic-set, search:** type "รพ.ร่มฉัตร" → autocomplete shows → pick → SHARE → open in incognito → ETA shows.
3. **T3 — Paramedic-set, preset:** click "🏥 รพ.ใกล้" → list of 15 (verify count) → pick → SHARE → open → ETA shows.
4. **T4 — Paramedic-set, map click:** open picker → tap on map → confirm → SHARE → open → ETA shows.
5. **T5 — Customer-choose, map pick:** create share with mode=customer → open in incognito → "เลือกบนแผนที่" → tap → confirm → ETA shows.
6. **T6 — Customer-choose, geolocation:** open share → tap "📍 ใช้ตำแหน่งฉัน" → accept → ETA shows.
7. **T7 — Race condition:** open share in 2 tabs simultaneously → both tap "เลือกบนแผนที่" with different points → tap "confirm" within 200 ms of each other → first wins, second auto-flips to live ETA view (no error toast at customer).
8. **T8 — TTL options:** create with TTL=1 → expires_at exactly 1 hr from now (±5 s). Same for 4/12/24.
9. **T9 — Expired link:** manually backdate expires_at < NOW() → open link → redirected to `/share-expired.html`.
10. **T10 — Revoke:** click revoke in paramedic list → status='Revoked' → open link → same expired screen.
11. **T11 — Arrival detection:** drive vehicle to within 50m of dest, stop 3 min → customer sees "ถึงปลายทางแล้ว ✓", paramedic row shows "Arrived" label.
12. **T12 — GPS offline:** kill vehicle GPS (or simulate by stopping position updates 3 min) → customer sees "ไม่มีสัญญาณ" banner, last-known marker dimmed.
13. **T13 — Quota budget:** trigger 100 refreshes in 1 hour from 50 concurrent customers viewing 1 token → verify only ~12 Distance Matrix calls made (cooldown + cache sharing).

### Worker tests (via curl)
- `GET /eta/refresh?token=TK-INVALID` → 404
- `GET /eta/refresh?token=TK-VALID&dest=NULL` → 409
- `GET /eta/refresh?token=TK-VALID` (fresh, cooldown not met) → 200 fresh=false
- `GET /eta/refresh?token=TK-VALID` (cooldown met) → 200 fresh=true

### Quota verification (post-deploy)
After 24 hr of production use, check admin → GPS Tracking → Map Provider → "Usage เดือนนี้" panel. Distance Matrix should show < 300 calls/day at typical 50 transfers/day volume.

---

## 13. Phased rollout

1. **Phase 1 — Schema + Worker** (1 commit each)
   - Migration deploy to Supabase prod (additive only — safe)
   - Worker `/eta/refresh` endpoint + tests (via curl)

2. **Phase 2 — Paramedic UI** (2 commits)
   - Share dialog extension (4 input methods + TTL + audience)
   - Active links list row enhancement (dest + ETA + revoke)

3. **Phase 3 — Customer share.html** (2 commits)
   - State machine (awaiting / locked / arrived / expired)
   - Destination picker + Geolocation + Map-pick

4. **Phase 4 — Polish + verification**
   - `share-expired.html` static page
   - Cross-browser test (Safari iOS, Chrome Android, Edge desktop)
   - Quota dashboard check at 24h mark

Each phase is independently deployable. Phases 2 + 3 can ship in either order
(paramedic UI is useful even without ETA viewer; viewer is useful even with
the old `?token=` interface as a fallback).

---

## 14. Open questions (resolved during brainstorming)

| Q | Answer |
|---|---|
| Provider for distance/ETA? | Google Distance Matrix (~10k free tier covers our volume) |
| Who picks destination? | Toggle: paramedic_set (default) OR customer_choose |
| If customer choose, how? | They pick: map-tap OR geolocation (one or the other, locks once) |
| Race condition handling? | DB guard `WHERE dest_locked_at IS NULL` + Worker `FOR UPDATE NOWAIT` |
| GPS offline? | Banner + last-known marker dimmed |
| TTL options? | 1 / 4 / 12 / 24 hr — paramedic picks at share time, default 1 hr |
| Where to list active links? | Existing GPS module share panel (already exists) — augment rows |
| Revoke flow? | Existing revoke button extended; link expires immediately on revoke |
| Expired/revoked landing? | `/share-expired.html` clean message page |
| ETA cache location? | DB columns `last_eta_*` on the token row (Option A) |
| Worker auth to Google? | Reuse existing service-account / API-key setup from Monitoring proxy |
| Refresh cadence? | Adaptive: 5 min moving, 2 min stopped, stop on arrival |
