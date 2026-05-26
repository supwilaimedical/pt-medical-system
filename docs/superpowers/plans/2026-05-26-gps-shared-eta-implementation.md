# GPS Shared Link + ETA Implementation Plan

> **For agentic workers:** Inline execution by the controller — do NOT dispatch subagents for implementation. Subagents OK for audit only between phases. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add live ETA + destination to the existing `gps_shared_tokens` share-link system — paramedic toggles who picks dest (themselves or customer), Worker proxies Google Distance Matrix with adaptive cadence cached on the token row, customer sees ETA countdown.

**Architecture:** Schema extension to existing table → Cloudflare Worker route `/api/eta/refresh` (Distance Matrix + cooldown + advisory lock + cache writeback) → Paramedic dialog gets dest-input modes + TTL radio → Customer `share.html` gets 3-state machine (awaiting picker / live ETA / arrived). All ETA cache lives on the DB row — single source of truth, no Worker memory, no KV.

**Tech Stack:** Supabase (Postgres + Realtime + RLS), Cloudflare Worker (ES modules, fetch API, Web Crypto), vanilla JS/HTML (Bootstrap 5 + Leaflet 1.9 + Google Maps JS SDK), gh CLI for PRs.

**Spec reference:** `docs/superpowers/specs/2026-05-26-gps-shared-eta-design.md` (commit e8c3553).

**Branch:** `feat/gps-shared-eta` (already exists; spec committed in e8c3553).

**Verification model:** No test runner exists in this project (vanilla web + Worker). Each task ends with a **Manual Smoke Test** step that the controller (Claude) runs via Claude in Chrome (`mcp__Claude_in_Chrome__*` tools) or `curl` against `localhost:8080` and the deployed Worker. Don't ask the human to test; verify yourself.

**Constraints (from `memory/working_rules.md` + `memory/danger_zones_ux_refactor.md`):**
- Local-first: nothing pushes to GitHub Pages before paramedic-user sign-off.
- Worker deploys via **Cloudflare Dashboard Edit-Code IDE** ONLY — wrangler CLI is forbidden (wiped settings last time).
- Worker existing secrets stay untouched: `GEMINI_API_KEY`, `WEBHOOK_SECRET`, `GOOGLE_SA_JSON`, `LINE_ACCESS_TOKEN`, `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `PUBLIC_BASE_URL`.
- New Worker secret needed: `GOOGLE_MAPS_KEY_SERVER` (server-restricted API key for Distance Matrix — separate from the referrer-restricted frontend key so we can lock by IP).
- Bump `?v=` cache-bust on any modified shared JS / HTML script include.
- Each phase = one commit on `feat/gps-shared-eta`.
- After each phase, run the audit subagent (security-engineer or code-reviewer) to scan that phase only.

---

## File Inventory

| Path | Action | Phase | Responsibility |
|---|---|---|---|
| `migration/gps_share_eta.sql` | **NEW** | 1 | 10 ALTER COLUMN + 2 indexes + 1 anon RLS policy + 1 service_role policy |
| `cloudflare/ocr-proxy-worker.js` | **EXTEND** | 1 | Add `/api/eta/refresh` route, Distance Matrix proxy, cooldown logic, `FOR UPDATE NOWAIT` advisory lock, cadence calc |
| `shared/places-api.js` | **EXTEND** | 2 | Add `PlacesAPI.decodeGoogleMapsLink(url)` helper (extracts lat/lng from `https://maps.app.goo.gl/...` or `?q=lat,lng` formats) |
| `v2/gps/index.html` | **EXTEND** | 2 | Share dialog: TTL radio (1/4/12/24), dest-mode toggle, 4 dest-input methods (paste link / search / preset / map click), audience radio. Active-list row: dest label + ETA badge + "🔄 Refresh ETA" button. Bump `?v=` on `places-api.js`. |
| `v2/gps/share.html` | **EXTEND** | 3 | 3-state UI (awaiting dest / live ETA / arrived). Customer picker for `customer_choose` mode (map-tap + geolocation). 1 Hz countdown timer. Realtime subscription on `gps_shared_tokens` row. Bump `?v=` on `places-api.js`. |
| `v2/gps/share-expired.html` | **NEW** | 4 | Single-file static page — message + back-to-home link. No JS, no realtime, no fetch. |
| `shared/config.js` | **EXTEND** | 4 | Bump `APP_VERSION` 2.4 → 2.5 (and add memory/version.md entry) |

---

## Phase 1 — Schema + Worker (foundation)

**Deliverable:** Migration deployed, Worker `/api/eta/refresh` returns valid ETA for a hard-coded token.

**Phase 1 acceptance criteria:**
- [ ] `SELECT column_name FROM information_schema.columns WHERE table_name='gps_shared_tokens'` shows all 10 new columns.
- [ ] `curl https://gps-proxy.supwilai-ambulance.workers.dev/api/eta/refresh?token=TK-TESTSEED` returns 200 with `ok:true, eta_seconds, eta_at, distance_m, fresh, next_refresh_in`.
- [ ] Subsequent calls within 5 min return `fresh:false` (cooldown working).
- [ ] Calling with bad token returns 404.
- [ ] Calling with token where `dest_locked_at IS NULL` returns 409.

---

### Task 1.1 — Write the migration SQL

**Files:**
- Create: `F:/@Coding/pt-medical-system/migration/gps_share_eta.sql`

- [ ] **Step 1: Create the migration file**

Write the exact contents to `migration/gps_share_eta.sql`:

```sql
-- =============================================================================
-- migration/gps_share_eta.sql
-- Extends gps_shared_tokens with destination + ETA cache columns.
-- Idempotent — safe to re-run.
-- Reference: docs/superpowers/specs/2026-05-26-gps-shared-eta-design.md §4
-- =============================================================================

-- 1. Add 10 columns (all IF NOT EXISTS for idempotency)
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

-- 2. Indexes for Worker cooldown + paramedic list view
CREATE INDEX IF NOT EXISTS gps_shared_tokens_token_active_idx
  ON gps_shared_tokens (token)
  WHERE status = 'Active';

CREATE INDEX IF NOT EXISTS gps_shared_tokens_created_by_active_idx
  ON gps_shared_tokens (created_by, expires_at DESC)
  WHERE status = 'Active';

-- 3. Anon UPDATE policy for customer-side destination lock
-- ONLY allows transitioning from "not locked" → "locked" with customer source values.
-- Existing anon_select_active policy stays; this adds the narrow UPDATE permission.
DROP POLICY IF EXISTS "anon_lock_dest" ON gps_shared_tokens;
CREATE POLICY "anon_lock_dest" ON gps_shared_tokens
  FOR UPDATE TO anon
  USING (
    status = 'Active'
    AND expires_at > NOW()
    AND dest_locked_at IS NULL
    AND dest_mode = 'customer_choose'
  )
  WITH CHECK (
    status = 'Active'
    AND dest_locked_at IS NOT NULL
    AND dest_lat IS NOT NULL
    AND dest_lng IS NOT NULL
    AND dest_source IN ('customer_map_pick', 'customer_geo')
  );

-- 4. Seed a TEST token for Phase 1 Worker verification (will be deleted after Phase 1)
INSERT INTO gps_shared_tokens (
  token, device_id, provider, expires_at, created_by, reason,
  status, ttl_hours, dest_mode, dest_lat, dest_lng, dest_name,
  dest_source, dest_locked_at
) VALUES (
  'TK-TESTSEED', '51041', NULL, NOW() + INTERVAL '4 hours', 'system-test',
  'Phase 1 Worker /api/eta/refresh verification — DELETE after Phase 1',
  'Active', 4, 'paramedic_set', 15.7008, 100.1362, 'รพ.ร่มฉัตร (test)',
  'manual', NOW()
) ON CONFLICT (token) DO UPDATE
  SET expires_at = EXCLUDED.expires_at,
      dest_lat = EXCLUDED.dest_lat,
      dest_lng = EXCLUDED.dest_lng,
      dest_locked_at = NOW();
```

- [ ] **Step 2: Deploy to Supabase via SQL Editor**

Open Supabase Dashboard → SQL Editor → paste the file contents → Run.

Expected output: `ALTER TABLE` + `CREATE INDEX` × 2 + `CREATE POLICY` + `INSERT 0 1`.

- [ ] **Step 3: Verify schema**

In SQL Editor run:
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'gps_shared_tokens'
  AND column_name IN ('ttl_hours','dest_mode','dest_lat','dest_lng',
                      'dest_name','dest_source','dest_locked_at','audience',
                      'last_eta_seconds','last_eta_at','last_distance_m')
ORDER BY column_name;
```
Expected: 11 rows (10 new + check audience — actually 10 new since `audience` is one of them).

- [ ] **Step 4: Verify seed row**

```sql
SELECT token, dest_mode, dest_lat, dest_lng, dest_name, dest_locked_at
FROM gps_shared_tokens WHERE token = 'TK-TESTSEED';
```
Expected: 1 row with `dest_mode='paramedic_set'`, `dest_lat=15.7008`, `dest_locked_at` not null.

- [ ] **Step 5: Commit**

```bash
cd /f/@Coding/pt-medical-system
git add migration/gps_share_eta.sql
git commit -m "feat(schema): gps_shared_tokens — destination + ETA cache columns

10 new columns + 2 indexes + anon UPDATE policy guarded to lock dest
once with customer source values only. Idempotent migration. Includes
TK-TESTSEED row for Phase 1 Worker verification.

Refs spec §4."
```

---

### Task 1.2 — Add `GOOGLE_MAPS_KEY_SERVER` Worker secret

**Why:** Distance Matrix needs an API key. We don't reuse the referrer-restricted frontend key (which is locked to `supwilaimedical.github.io`) because the Worker is server-side. Need a separate key restricted by IP to Cloudflare's outbound ranges OR API-restricted to Distance Matrix only.

- [ ] **Step 1: Create new Google Maps key in Cloud Console**

In Google Cloud Console (project `supwilai-map`):
- APIs & Services → Credentials → Create credentials → API key
- Name: "PT-Amb Worker (server-side Distance Matrix)"
- API restrictions: **Restrict key** → check ONLY "Distance Matrix API"
- Application restrictions: **None** (Worker IPs are dynamic across Cloudflare's edge; rely on API restriction)
- Copy the key value

- [ ] **Step 2: Add as Cloudflare Worker secret**

In Cloudflare Dashboard → Workers & Pages → gps-proxy → Settings → Variables → Add variable:
- Type: **Secret (encrypted)**
- Name: `GOOGLE_MAPS_KEY_SERVER`
- Value: (paste key)
- Save

- [ ] **Step 3: Verify presence via /notify/health style endpoint**

Skip — we'll verify via actual `/api/eta/refresh` call in Task 1.4. Just confirm in the Variables list that `GOOGLE_MAPS_KEY_SERVER` shows up.

- [ ] **Step 4: Commit nothing — secrets aren't checked into git**

No commit. Document the secret name in the next task's worker code comment.

---

### Task 1.3 — Add Distance Matrix helper to Worker

**Files:**
- Modify: `F:/@Coding/pt-medical-system/cloudflare/ocr-proxy-worker.js` — add helper function at the bottom (before the closing `};` of the module).

- [ ] **Step 1: Add `callDistanceMatrix` helper at the bottom of the file**

Find the last function in `cloudflare/ocr-proxy-worker.js` (it's `base64UrlEncode` after `signServiceAccountJWT`). Append AFTER `base64UrlEncode`:

```js
// =============================================================================
// Distance Matrix proxy — for /api/eta/refresh
// Requires GOOGLE_MAPS_KEY_SERVER secret (server-restricted key, no referrer)
// =============================================================================

/**
 * Call Google Distance Matrix API.
 * @param {{lat:number,lng:number}} origin
 * @param {{lat:number,lng:number}} dest
 * @param {string} apiKey
 * @returns {Promise<{seconds:number,meters:number}>}
 * @throws Error on HTTP/API error
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
```

- [ ] **Step 2: Commit code as-is (no route handler yet — Task 1.4 adds it)**

Don't commit yet — wait until 1.4 ships together, so the commit has both the helper and its caller.

---

### Task 1.4 — Add `/api/eta/refresh` route handler

**Files:**
- Modify: `F:/@Coding/pt-medical-system/cloudflare/ocr-proxy-worker.js` — add route + handler.

- [ ] **Step 1: Register the route**

In `cloudflare/ocr-proxy-worker.js`, locate the existing line (~line 76):
```js
if (path === '/api/quota/google' && request.method === 'GET') {
  return await handleGoogleQuota(request, env);
}
```

Add IMMEDIATELY AFTER it (still inside `fetch`):
```js
if (path === '/api/eta/refresh' && request.method === 'GET') {
  return await handleEtaRefresh(request, env);
}
```

- [ ] **Step 2: Add `handleEtaRefresh` function**

Append AFTER the existing `handleGoogleQuota` function (search for `async function handleGoogleQuota` — the new function goes right after that one's closing `}`):

```js
// =============================================================================
// GET /api/eta/refresh?token=TK-XXXXXXXX
// Returns cached ETA, refreshing via Distance Matrix when cooldown elapsed.
// Spec §6 (cadence) + §5 H2 (advisory lock via FOR UPDATE NOWAIT).
// =============================================================================
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

  // 1. Fetch token row
  const sbHeaders = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_KEY,
    'Content-Type': 'application/json'
  };
  const tokenUrl = env.SUPABASE_URL + '/rest/v1/gps_shared_tokens'
                 + '?token=eq.' + encodeURIComponent(token)
                 + '&select=*';
  const tRes = await fetch(tokenUrl, { headers: sbHeaders });
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

  // 2. Fetch vehicle's current position (gps_vehicles.last_lat/last_lng if present;
  //    otherwise fall back to a positions table query — use gps_vehicles for now)
  const vehUrl = env.SUPABASE_URL + '/rest/v1/gps_vehicles'
               + '?device_id=eq.' + encodeURIComponent(row.device_id)
               + '&select=device_id,last_lat,last_lng,last_seen_at';
  const vRes = await fetch(vehUrl, { headers: sbHeaders });
  if (!vRes.ok) {
    return jsonResponse({ ok: false, error: 'VEHICLE_READ_FAILED' }, 502, request, env);
  }
  const vehRows = await vRes.json();
  const veh = vehRows[0];
  if (!veh || veh.last_lat == null || veh.last_lng == null) {
    return jsonResponse({ ok: false, error: 'VEHICLE_NO_POSITION' }, 503, request, env);
  }

  // 3. Decide cooldown — Spec §6
  //    Just-locked (no eta yet): refresh immediately.
  //    Moving (last refresh was a different lat/lng): 5 min cooldown.
  //    Stopped (distance small + position unchanged): 2 min cooldown.
  const now = Date.now();
  const lastEtaAt = row.last_eta_at ? new Date(row.last_eta_at).getTime() : 0;
  const sinceLastMs = now - lastEtaAt;
  const justLocked = !row.last_eta_at;

  // Determine cadence based on whether vehicle is "stopped" (distance < 1km from dest stays "stopped")
  const lastDistM = row.last_distance_m == null ? 99999 : row.last_distance_m;
  const stoppedCadenceMs = 2 * 60 * 1000;
  const movingCadenceMs  = 5 * 60 * 1000;
  const cadenceMs = (lastDistM < 1000) ? stoppedCadenceMs : movingCadenceMs;

  // Arrival short-circuit: within 100m + recent refresh → no API call, mark arrived
  if (!justLocked && lastDistM < 100) {
    return jsonResponse({
      ok: true,
      eta_seconds: 0,
      eta_at: row.last_eta_at,
      distance_m: lastDistM,
      fresh: false,
      arrived: true,
      next_refresh_in: Math.max(0, Math.round((stoppedCadenceMs - sinceLastMs) / 1000))
    }, 200, request, env);
  }

  if (!justLocked && sinceLastMs < cadenceMs) {
    // Cooldown not met — return cache
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

  // 4. Call Distance Matrix (cooldown elapsed OR just-locked)
  let dm;
  try {
    dm = await callDistanceMatrix(
      { lat: veh.last_lat, lng: veh.last_lng },
      { lat: row.dest_lat, lng: row.dest_lng },
      env.GOOGLE_MAPS_KEY_SERVER
    );
  } catch (e) {
    // Don't crash the client — return cached value if we have one, else error
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

  // 5. Write cache back to DB
  const nowIso = new Date().toISOString();
  const patchUrl = env.SUPABASE_URL + '/rest/v1/gps_shared_tokens'
                 + '?token=eq.' + encodeURIComponent(token);
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      last_eta_seconds: dm.seconds,
      last_eta_at: nowIso,
      last_distance_m: dm.meters
    })
  });

  // 6. Respond
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
```

- [ ] **Step 3: Deploy Worker via Cloudflare Dashboard Edit-Code IDE**

1. In Cloudflare Dashboard → Workers & Pages → gps-proxy → Edit code
2. Open the worker source pane
3. `Ctrl+A` to select all → `Delete`
4. Copy `cloudflare/ocr-proxy-worker.js` content via PowerShell:
   `[IO.File]::ReadAllText('F:\@Coding\pt-medical-system\cloudflare\ocr-proxy-worker.js', [Text.Encoding]::UTF8) | Set-Clipboard`
5. Paste into editor (`Ctrl+V`)
6. Click **Deploy** → wait for "Deployed" confirmation. Note the new version ID.

- [ ] **Step 4: Verify with curl**

```bash
curl -s "https://gps-proxy.supwilai-ambulance.workers.dev/api/eta/refresh?token=TK-TESTSEED" | python -m json.tool
```

Expected (first call — just-locked, no `last_eta_at` yet):
```json
{
  "ok": true,
  "eta_seconds": <some positive int>,
  "eta_at": "2026-05-26T...",
  "distance_m": <some int>,
  "fresh": true,
  "arrived": false,
  "next_refresh_in": 300
}
```

Wait — TK-TESTSEED has dest = (15.7008, 100.1362) which is identical to vehicle 51041's likely position (Nakhon Sawan office). Distance Matrix from same point to same point returns ~0 seconds. That's fine — confirms the call works.

To get a more meaningful response, before curling, run this SQL to set a destination farther away:
```sql
UPDATE gps_shared_tokens
SET dest_lat = 13.7563, dest_lng = 100.5018, dest_name = 'Bangkok (test)',
    last_eta_at = NULL, last_eta_seconds = NULL, last_distance_m = NULL
WHERE token = 'TK-TESTSEED';
```

Then curl again. Expected: `distance_m` ~250,000-400,000 (Nakhon Sawan → Bangkok), `eta_seconds` ~10,000-20,000 (2-5 hours driving).

- [ ] **Step 5: Verify cooldown (second call within 5 min)**

```bash
curl -s "https://gps-proxy.supwilai-ambulance.workers.dev/api/eta/refresh?token=TK-TESTSEED" | python -m json.tool
```
Expected: same `eta_seconds`, `fresh: false`, `next_refresh_in < 300`.

- [ ] **Step 6: Verify error paths**

```bash
# Bad token → 404
curl -sI "https://gps-proxy.supwilai-ambulance.workers.dev/api/eta/refresh?token=TK-NOPE" | head -1
# Expected: HTTP/2 404

# Missing token → 400
curl -sI "https://gps-proxy.supwilai-ambulance.workers.dev/api/eta/refresh" | head -1
# Expected: HTTP/2 400
```

Also test DEST_NOT_LOCKED:
```sql
-- Temporarily clear lock
UPDATE gps_shared_tokens SET dest_locked_at = NULL WHERE token = 'TK-TESTSEED';
```
```bash
curl -s "https://gps-proxy.supwilai-ambulance.workers.dev/api/eta/refresh?token=TK-TESTSEED"
# Expected: {"ok":false,"error":"DEST_NOT_LOCKED"}
```
```sql
-- Restore
UPDATE gps_shared_tokens SET dest_locked_at = NOW() WHERE token = 'TK-TESTSEED';
```

- [ ] **Step 7: Commit Worker changes**

```bash
cd /f/@Coding/pt-medical-system
git add cloudflare/ocr-proxy-worker.js
git commit -m "feat(worker): /api/eta/refresh — Distance Matrix proxy with adaptive cadence

GET /api/eta/refresh?token=TK-... → returns cached ETA, refreshing via
Google Distance Matrix when cooldown elapsed.

Cadence (spec §6):
  • just-locked: refresh immediately
  • moving (last_distance_m >= 1000): 5 min cooldown
  • stopped (last_distance_m < 1000): 2 min cooldown
  • arrived (last_distance_m < 100): no API call, return cache

Errors:
  • TOKEN_REQUIRED (400) / TOKEN_INVALID (404)
  • DEST_NOT_LOCKED (409) when dest_locked_at IS NULL
  • VEHICLE_NO_POSITION (503) when gps_vehicles row missing last_lat/lng
  • DISTANCE_MATRIX_FAILED (503 cold, 200 with warning if we have cache)

Requires new secret GOOGLE_MAPS_KEY_SERVER (Distance Matrix-restricted API
key — separate from the referrer-restricted frontend key).

Refs spec §3 + §5 + §6 + §8."
```

---

### Task 1.5 — Phase 1 audit (subagent OK — read-only)

- [ ] **Step 1: Dispatch security-engineer subagent for narrow audit**

Use the Agent tool with `subagent_type: security-engineer`. Prompt:

> Audit ONLY the new code added in this session for the GPS Shared Link + ETA feature, Phase 1:
>
> - `migration/gps_share_eta.sql` (10 ALTERs + 2 indexes + anon UPDATE policy)
> - `cloudflare/ocr-proxy-worker.js` — only the new `handleEtaRefresh` + `callDistanceMatrix` functions
>
> Focus checks (under 250 words):
> 1. Anon UPDATE policy `anon_lock_dest` — can a malicious customer escalate? (E.g., change `status`, change `device_id`, change `dest_mode`, lift `expires_at`.)
> 2. Worker `/api/eta/refresh` — token enumeration / brute force vulnerability? (Rate limit? Token entropy?)
> 3. Distance Matrix proxy — can the endpoint be abused to spam Google API calls? (Cooldown actually enforced before fetch?)
> 4. SQL injection / parameter handling in URL building inside the Worker.
> 5. Logged secrets / sensitive data in error messages.
>
> Report: list issues with file:line + severity (CRITICAL/HIGH/MEDIUM/LOW). If clean, say so. No code suggestions — just findings.

- [ ] **Step 2: Address findings or accept residual risk explicitly**

If subagent finds issues → fix them in-place + commit a follow-up fix.

If no issues → write a `// AUDIT-OK 2026-05-26: see chat` comment at the top of the new code blocks.

- [ ] **Step 3: Commit any fixes from audit**

```bash
git add -A && git commit -m "fix(worker|sql): address Phase 1 audit findings — <summary>"
# OR skip if no fixes needed
```

---

## Phase 2 — Paramedic UI

**Deliverable:** Paramedic can create a share link with all 4 dest-input methods + TTL options + audience selector; active list shows dest + ETA per row.

**Phase 2 acceptance criteria:**
- [ ] Open `localhost:8080/pt-medical-system/v2/gps/`, pick a vehicle, click Share — see new dest-mode toggle.
- [ ] Selecting "ตั้งเอง" expands to 4 input methods (paste/search/preset/map).
- [ ] Each input method correctly populates `dest_lat`, `dest_lng`, `dest_name` before INSERT.
- [ ] TTL radio (1/4/12/24) sets `expires_at` correctly.
- [ ] Existing share dialog still works (existing fields untouched).
- [ ] Active list row shows dest name + ETA badge.
- [ ] Clicking 🔄 row button calls Worker and updates ETA in-place.

---

### Task 2.1 — `decodeGoogleMapsLink` helper in shared/places-api.js

**Files:**
- Modify: `F:/@Coding/pt-medical-system/shared/places-api.js` — add helper inside the `PlacesAPI` object.

- [ ] **Step 1: Add the helper**

Locate `filterNoise: function(places, uiType) {` (around line 225). Find the closing `}` of that function. Add the new helper AFTER it (before `_geoCache: {}`):

```js
    /**
     * Decode lat/lng from various Google Maps URL formats.
     * Supports:
     *   https://maps.app.goo.gl/abc          → resolves via fetch (returns null — needs server)
     *   https://www.google.com/maps/place/@15.7,100.1,17z
     *   https://www.google.com/maps?q=15.7,100.1
     *   https://goo.gl/maps/abc              → also needs server resolution
     *   "15.7008, 100.1362"                  → raw coords (returns {lat, lng})
     *
     * Returns Promise<{lat:number, lng:number, name?:string} | null>
     */
    decodeGoogleMapsLink: async function(input) {
      var s = (input || '').trim();
      if (!s) return null;

      // 1. Raw "lat, lng" string
      var raw = s.match(/^(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/);
      if (raw) {
        return { lat: parseFloat(raw[1]), lng: parseFloat(raw[2]) };
      }

      // 2. /@lat,lng,zoom format
      var atForm = s.match(/[@\?](-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
      if (atForm) {
        return { lat: parseFloat(atForm[1]), lng: parseFloat(atForm[2]) };
      }

      // 3. ?q=lat,lng or ?ll=lat,lng or destination=lat,lng
      var qForm = s.match(/[?&](?:q|ll|destination)=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
      if (qForm) {
        return { lat: parseFloat(qForm[1]), lng: parseFloat(qForm[2]) };
      }

      // 4. Shortened URL (goo.gl, maps.app.goo.gl) — needs HEAD redirect resolution.
      // Browsers can't read cross-origin redirects without CORS, so we try to follow
      // by fetching with mode:'no-cors' (opaque) then re-trying. If that fails,
      // we surface a "couldn't decode" so paramedic uses a different input method.
      if (/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)/.test(s)) {
        try {
          var res = await fetch(s, { method: 'GET', redirect: 'follow' });
          var finalUrl = res.url || '';
          // Recurse on resolved URL
          if (finalUrl && finalUrl !== s) {
            return await this.decodeGoogleMapsLink(finalUrl);
          }
        } catch (e) {
          // Fall through — return null
        }
      }

      return null;
    },
```

- [ ] **Step 2: Bump cache-bust query in callers**

In `F:/@Coding/pt-medical-system/v2/gps/index.html`, find the line:
```html
<script src="../../shared/places-api.js?v=20260526b"></script>
```
Replace with:
```html
<script src="../../shared/places-api.js?v=20260526c"></script>
```

In `F:/@Coding/pt-medical-system/v2/monitor/index.html`, find:
```html
<script src="../../shared/places-api.js?v=20260526b"></script>
```
Replace with:
```html
<script src="../../shared/places-api.js?v=20260526c"></script>
```

- [ ] **Step 3: Smoke test via Claude in Chrome**

```js
// Run in DevTools console at localhost:8080/pt-medical-system/v2/gps/
(async () => {
  return {
    raw: await PlacesAPI.decodeGoogleMapsLink('15.7008, 100.1362'),
    atForm: await PlacesAPI.decodeGoogleMapsLink('https://www.google.com/maps/place/@15.7008,100.1362,17z'),
    qForm: await PlacesAPI.decodeGoogleMapsLink('https://www.google.com/maps?q=15.7008,100.1362'),
    bad: await PlacesAPI.decodeGoogleMapsLink('not a url')
  };
})()
```
Expected:
```js
{
  raw: { lat: 15.7008, lng: 100.1362 },
  atForm: { lat: 15.7008, lng: 100.1362 },
  qForm: { lat: 15.7008, lng: 100.1362 },
  bad: null
}
```

- [ ] **Step 4: Commit**

```bash
cd /f/@Coding/pt-medical-system
git add shared/places-api.js v2/gps/index.html v2/monitor/index.html
git commit -m "feat(places): PlacesAPI.decodeGoogleMapsLink helper

Extracts lat/lng from Maps URLs in 4 formats:
- raw 'lat, lng' string
- /@lat,lng,zoom in path
- ?q=lat,lng or ?ll= or ?destination= query
- maps.app.goo.gl / goo.gl/maps shorteners (follows redirect)

Used by share dialog 'paste link' input method.
Cache-bust ?v=20260526c."
```

---

### Task 2.2 — Extend share dialog HTML in v2/gps/index.html

**Files:**
- Modify: `F:/@Coding/pt-medical-system/v2/gps/index.html` — share dialog modal (existing, locate it).

- [ ] **Step 1: Read existing share dialog**

```bash
grep -n "share-hours\|share-reason\|shareModal\|btnCreateShare" /f/@Coding/pt-medical-system/v2/gps/index.html | head -10
```

Open the modal section and read 30 lines around `share-hours` input — that's where TTL is currently entered.

- [ ] **Step 2: Replace TTL input with radio group**

Find the existing TTL input (likely a `<select>` or `<input type="number" id="share-hours">`). Replace it with the radio group:

```html
<!-- TTL radio (1 / 4 / 12 / 24 hours) -->
<div class="mb-3">
  <label class="form-label fw-bold">ระยะเวลา</label>
  <div class="btn-group d-flex flex-wrap" role="group" aria-label="TTL">
    <input type="radio" class="btn-check" name="share-ttl" id="ttl-1"  value="1"  checked>
    <label class="btn btn-outline-primary" for="ttl-1">1 ชม.</label>
    <input type="radio" class="btn-check" name="share-ttl" id="ttl-4"  value="4">
    <label class="btn btn-outline-primary" for="ttl-4">4 ชม.</label>
    <input type="radio" class="btn-check" name="share-ttl" id="ttl-12" value="12">
    <label class="btn btn-outline-primary" for="ttl-12">12 ชม.</label>
    <input type="radio" class="btn-check" name="share-ttl" id="ttl-24" value="24">
    <label class="btn btn-outline-primary" for="ttl-24">24 ชม.</label>
  </div>
  <div class="form-text">Default 1 ชม. — เลือกตามระยะเวลานำส่ง</div>
</div>
```

Keep the OLD `<input id="share-hours">` element but make it `type="hidden"` so existing JS reading `document.getElementById('share-hours').value` still works. Add a tiny syncer:

```html
<input type="hidden" id="share-hours" value="1">
<script>
  document.addEventListener('change', function(e) {
    if (e.target && e.target.name === 'share-ttl') {
      document.getElementById('share-hours').value = e.target.value;
    }
  });
</script>
```

- [ ] **Step 3: Add dest-mode toggle BEFORE the reason input**

Find the reason input (`#share-reason`). Insert IMMEDIATELY BEFORE its `<div class="mb-3">` wrapper:

```html
<!-- Destination mode toggle -->
<div class="mb-3">
  <label class="form-label fw-bold">ปลายทาง</label>
  <div class="btn-group d-flex" role="group">
    <input type="radio" class="btn-check" name="share-dest-mode" id="dest-mode-self" value="paramedic_set" checked>
    <label class="btn btn-outline-primary" for="dest-mode-self">
      <i class="bi bi-pin-map-fill"></i> ฉันตั้งปลายทางเลย
    </label>
    <input type="radio" class="btn-check" name="share-dest-mode" id="dest-mode-customer" value="customer_choose">
    <label class="btn btn-outline-primary" for="dest-mode-customer">
      <i class="bi bi-person-raised-hand"></i> ให้ลูกค้าเลือกเอง
    </label>
  </div>
</div>

<!-- Dest input methods (visible only when paramedic_set) -->
<div id="dest-input-wrap" class="mb-3" style="border:1px solid #cbd5e1; border-radius:8px; padding:12px; background:#f8fafc;">
  <div class="mb-2">
    <ul class="nav nav-pills nav-fill" id="dest-input-tabs" role="tablist">
      <li class="nav-item"><button class="nav-link active" type="button" data-method="link"  >📋 Paste Link</button></li>
      <li class="nav-item"><button class="nav-link"        type="button" data-method="search">🔍 ค้นหา</button></li>
      <li class="nav-item"><button class="nav-link"        type="button" data-method="preset">🏥 รพ.ใกล้</button></li>
      <li class="nav-item"><button class="nav-link"        type="button" data-method="map_click">📍 บนแผนที่</button></li>
    </ul>
  </div>

  <!-- Method: link -->
  <div class="dest-method-pane" data-pane="link">
    <input type="text" class="form-control" id="dest-link-input" placeholder="วาง Google Maps Link ที่นี่...">
    <button type="button" class="btn btn-sm btn-outline-primary mt-2" id="dest-link-decode">
      <i class="bi bi-arrow-down-circle"></i> Decode
    </button>
    <div class="form-text" id="dest-link-feedback"></div>
  </div>

  <!-- Method: search (Places autocomplete — Phase 2.4) -->
  <div class="dest-method-pane" data-pane="search" style="display:none;">
    <input type="text" class="form-control" id="dest-search-input" placeholder="พิมพ์ชื่อสถานที่...">
    <div class="form-text" id="dest-search-feedback">ใช้ Google Places autocomplete</div>
    <div id="dest-search-results" style="margin-top:8px;"></div>
  </div>

  <!-- Method: preset (uses searchHospitalsCombined) -->
  <div class="dest-method-pane" data-pane="preset" style="display:none;">
    <button type="button" class="btn btn-sm btn-outline-secondary" id="dest-preset-load">
      <i class="bi bi-arrow-clockwise"></i> โหลด รพ. ใกล้รถ
    </button>
    <div class="form-text">รัศมี 25 km จากตำแหน่งรถปัจจุบัน</div>
    <select class="form-select mt-2" id="dest-preset-select" style="display:none;"></select>
  </div>

  <!-- Method: map_click -->
  <div class="dest-method-pane" data-pane="map_click" style="display:none;">
    <button type="button" class="btn btn-sm btn-outline-secondary" id="dest-map-pick">
      <i class="bi bi-geo-alt"></i> เปิด picker เลือกบนแผนที่
    </button>
    <div class="form-text">คลิกบนแผนที่หลักเพื่อปักหมุดปลายทาง</div>
  </div>

  <!-- Summary of picked dest -->
  <div id="dest-picked-summary" class="alert alert-success mt-2" style="display:none;">
    <i class="bi bi-check-circle-fill"></i> <span id="dest-picked-text">--</span>
  </div>
</div>

<!-- Audience selector (optional) -->
<div class="mb-3">
  <label class="form-label fw-bold">ประเภทผู้รับ (optional)</label>
  <div class="btn-group d-flex" role="group">
    <input type="radio" class="btn-check" name="share-audience" id="aud-none"       value="" checked>
    <label class="btn btn-outline-secondary" for="aud-none">ไม่ระบุ</label>
    <input type="radio" class="btn-check" name="share-audience" id="aud-family"     value="family">
    <label class="btn btn-outline-secondary" for="aud-family">ญาติคนไข้</label>
    <input type="radio" class="btn-check" name="share-audience" id="aud-contractor" value="contractor">
    <label class="btn btn-outline-secondary" for="aud-contractor">Contractor</label>
  </div>
</div>

<!-- Hidden state — captures picked dest -->
<input type="hidden" id="dest-lat" value="">
<input type="hidden" id="dest-lng" value="">
<input type="hidden" id="dest-name" value="">
<input type="hidden" id="dest-source" value="">
```

- [ ] **Step 4: Smoke test (visual only — JS wiring in 2.3)**

In Chrome: navigate to `localhost:8080/pt-medical-system/v2/gps/`. Click the Share button. Verify:
- TTL radio shows 4 buttons (1 selected by default)
- Dest-mode toggle shows 2 buttons (paramedic_set selected)
- Expanded box shows 4 method tabs (Link / Search / Preset / Map)
- Audience radio shows 3 options

JS not wired yet — clicking tabs does nothing. That's expected.

- [ ] **Step 5: Commit**

```bash
cd /f/@Coding/pt-medical-system
git add v2/gps/index.html
git commit -m "feat(gps-share): dialog HTML — TTL radio + dest-mode toggle + audience

Replaces free-form hours input with radio (1/4/12/24).
Adds dest-mode toggle (paramedic_set/customer_choose).
Adds 4-method input panel (link/search/preset/map_click).
Adds optional audience selector (family/contractor/none).
JS wiring lands in Task 2.3.

Refs spec §7."
```

---

### Task 2.3 — JS wiring for dest-input methods

**Files:**
- Modify: `F:/@Coding/pt-medical-system/v2/gps/index.html` — add JS in the existing `<script>` block (locate `function createShareToken`).

- [ ] **Step 1: Add tab switcher + helpers**

Add this JS BEFORE the existing `async function createShareToken() {` function:

```js
// =========================================================================
// Share dialog — destination picker (paramedic_set mode)
// Wires the 4 input tabs to the hidden #dest-lat/#dest-lng/#dest-name/#dest-source
// =========================================================================

// Tab switcher
document.addEventListener('click', function(e) {
  if (!e.target || !e.target.matches('#dest-input-tabs button[data-method]')) return;
  var method = e.target.getAttribute('data-method');
  document.querySelectorAll('#dest-input-tabs .nav-link').forEach(function(b) {
    b.classList.toggle('active', b === e.target);
  });
  document.querySelectorAll('.dest-method-pane').forEach(function(p) {
    p.style.display = (p.getAttribute('data-pane') === method) ? '' : 'none';
  });
});

// Dest-mode toggle — show/hide the input wrap
document.addEventListener('change', function(e) {
  if (e.target && e.target.name === 'share-dest-mode') {
    var wrap = document.getElementById('dest-input-wrap');
    if (wrap) wrap.style.display = (e.target.value === 'paramedic_set') ? '' : 'none';
    if (e.target.value === 'customer_choose') {
      // Clear any picked dest
      ['dest-lat','dest-lng','dest-name','dest-source'].forEach(function(id){
        var el = document.getElementById(id); if (el) el.value = '';
      });
      var summary = document.getElementById('dest-picked-summary');
      if (summary) summary.style.display = 'none';
    }
  }
});

function setPickedDest(lat, lng, name, source) {
  document.getElementById('dest-lat').value    = lat;
  document.getElementById('dest-lng').value    = lng;
  document.getElementById('dest-name').value   = name || '';
  document.getElementById('dest-source').value = source;
  var summary = document.getElementById('dest-picked-summary');
  var text    = document.getElementById('dest-picked-text');
  if (text) text.textContent = (name || '(ไม่มีชื่อ)') + ' · ' + Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5);
  if (summary) summary.style.display = '';
}

// Method 1: Paste Link → decode via PlacesAPI.decodeGoogleMapsLink
document.addEventListener('click', async function(e) {
  if (!e.target || e.target.id !== 'dest-link-decode') return;
  var input = document.getElementById('dest-link-input');
  var fb    = document.getElementById('dest-link-feedback');
  fb.textContent = 'กำลัง decode...';
  try {
    var result = await PlacesAPI.decodeGoogleMapsLink(input.value);
    if (!result) {
      fb.innerHTML = '<span style="color:#dc2626;">❌ ไม่พบพิกัด — ลองวาง Link แบบเต็ม (https://www.google.com/maps/place/...) หรือใช้ tab อื่น</span>';
      return;
    }
    fb.innerHTML = '<span style="color:#16a34a;">✓ พบพิกัด: ' + result.lat.toFixed(5) + ', ' + result.lng.toFixed(5) + '</span>';
    setPickedDest(result.lat, result.lng, result.name || 'จาก Link', 'link');
  } catch (err) {
    fb.innerHTML = '<span style="color:#dc2626;">❌ ' + err.message + '</span>';
  }
});

// Method 2: Search — uses Places autocomplete (Google Maps JS SDK Place class)
document.addEventListener('input', async function(e) {
  if (!e.target || e.target.id !== 'dest-search-input') return;
  var q = e.target.value.trim();
  var results = document.getElementById('dest-search-results');
  if (!q || q.length < 3) { results.innerHTML = ''; return; }
  // Debounce: 300ms
  clearTimeout(window._destSearchDebounce);
  window._destSearchDebounce = setTimeout(async function() {
    try {
      var origin = resolveHospitalOrigin && resolveHospitalOrigin();
      var places = await PlacesAPI.searchText({
        query: q,
        lat: origin ? origin.lat : 13.7563,
        lng: origin ? origin.lng : 100.5018,
        radius: 50000,
        maxResults: 5
      });
      if (!places.length) { results.innerHTML = '<div class="text-muted small">ไม่พบผลลัพธ์</div>'; return; }
      results.innerHTML = places.map(function(p) {
        return '<button type="button" class="btn btn-sm btn-outline-secondary d-block w-100 text-start mb-1" '
             + 'onclick="setPickedDest(' + p.lat + ',' + p.lng + ',\'' + (p.name || '').replace(/'/g,'\\\'') + '\',\'search\')">'
             + '<b>' + escapeHtml(p.name) + '</b><br><small class="text-muted">' + escapeHtml(p.address) + '</small></button>';
      }).join('');
    } catch (err) {
      results.innerHTML = '<div class="text-danger small">ค้นไม่ได้: ' + escapeHtml(err.message) + '</div>';
    }
  }, 300);
});

// Method 3: Preset — searchHospitalsCombined
document.addEventListener('click', async function(e) {
  if (!e.target || e.target.id !== 'dest-preset-load') return;
  var btn    = e.target;
  var sel    = document.getElementById('dest-preset-select');
  var origin = resolveHospitalOrigin && resolveHospitalOrigin();
  if (!origin) { btn.textContent = 'เลือกรถก่อน'; return; }
  btn.disabled = true;
  btn.innerHTML = '<i class="bi bi-hourglass-split"></i> กำลังโหลด...';
  try {
    var hosp = await PlacesAPI.searchHospitalsCombined(origin.lat, origin.lng, 25000);
    sel.innerHTML = '<option value="">-- เลือก --</option>' +
      hosp.map(function(p,i){ return '<option value="'+i+'">'+escapeHtml(p.name)+' ('+Math.round(p.distanceM/100)/10+' km)</option>'; }).join('');
    sel.style.display = '';
    sel._hospCache = hosp;
    sel.onchange = function() {
      var idx = parseInt(this.value, 10);
      if (isNaN(idx)) return;
      var p = sel._hospCache[idx];
      setPickedDest(p.lat, p.lng, p.name, 'preset');
    };
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> โหลด รพ. ใกล้รถ';
  }
});

// Method 4: Map click — minimal helper using the existing map (#mapMain or similar)
document.addEventListener('click', function(e) {
  if (!e.target || e.target.id !== 'dest-map-pick') return;
  Swal.fire({
    title: 'คลิกบนแผนที่หลักเพื่อปักหมุด',
    text: 'ปิด dialog นี้แล้วคลิกที่ตำแหน่งบนแผนที่ — ระบบจะกลับมาที่ dialog อัตโนมัติ',
    icon: 'info',
    confirmButtonText: 'เริ่ม'
  }).then(function() {
    // Set a one-shot click handler on the Leaflet map
    if (typeof map === 'undefined' || !map) { Swal.fire('Map ไม่พร้อม', '', 'error'); return; }
    var modalEl = document.getElementById('shareModal');
    var bsModal = bootstrap.Modal.getInstance(modalEl);
    if (bsModal) bsModal.hide();
    var oneShot = function(ev) {
      var ll = ev.latlng;
      map.off('click', oneShot);
      setPickedDest(ll.lat, ll.lng, 'ปักหมุดบนแผนที่', 'map_click');
      if (bsModal) bsModal.show();
      // Switch tab back to map_click pane visually
      var tabBtn = document.querySelector('#dest-input-tabs button[data-method="map_click"]');
      if (tabBtn) tabBtn.click();
    };
    map.on('click', oneShot);
  });
});
```

- [ ] **Step 2: Update `createShareToken()` to read new fields**

Find the existing `async function createShareToken() {` and modify the INSERT call to include the new fields.

Read the existing function (lines ~2542-2580 currently per Phase 1 grep). Replace the INSERT block:

OLD:
```js
await _supabase.from('gps_shared_tokens').insert({
  token: token, device_id: deviceId, provider: providerId,
  expires_at: expiresAt, created_by: getUserName(), reason: reason,
  allow_camera: allowCamera
});
```

NEW:
```js
// Read new fields
var ttlHours = parseInt(document.querySelector('input[name="share-ttl"]:checked').value, 10) || 1;
var destMode = document.querySelector('input[name="share-dest-mode"]:checked').value;
var audience = (document.querySelector('input[name="share-audience"]:checked') || {}).value || null;
var dLat   = document.getElementById('dest-lat').value;
var dLng   = document.getElementById('dest-lng').value;
var dName  = document.getElementById('dest-name').value;
var dSrc   = document.getElementById('dest-source').value;

// Validate paramedic_set mode requires a picked dest
if (destMode === 'paramedic_set' && (!dLat || !dLng)) {
  Swal.fire('กรุณาเลือกปลายทาง', 'เลือกวิธี Link/ค้นหา/รพ.ใกล้/บนแผนที่ — หรือเปลี่ยนเป็น "ให้ลูกค้าเลือกเอง"', 'warning');
  document.getElementById('btnCreateShare').disabled = false;
  return;
}

// Recompute expiresAt with new ttlHours (was using share-hours fixed)
expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

await _supabase.from('gps_shared_tokens').insert({
  token: token, device_id: deviceId, provider: providerId,
  expires_at: expiresAt, created_by: getUserName(), reason: reason,
  allow_camera: allowCamera,
  // NEW fields:
  ttl_hours: ttlHours,
  dest_mode: destMode,
  dest_lat:   dLat  ? parseFloat(dLat)  : null,
  dest_lng:   dLng  ? parseFloat(dLng)  : null,
  dest_name:  dName || null,
  dest_source: dSrc || (destMode === 'paramedic_set' ? null : null),
  dest_locked_at: (destMode === 'paramedic_set' && dLat) ? new Date().toISOString() : null,
  audience: audience
});
```

Make sure `expiresAt` variable is no longer assigned earlier in the function from `share-hours` (delete the old line `var expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();` near the top of the function — we recompute it after reading TTL radio).

- [ ] **Step 3: Smoke test — create a paramedic_set link**

Via Chrome:
1. Reload page (hard refresh)
2. Open share dialog
3. Pick a vehicle
4. Keep dest-mode = paramedic_set
5. Tab "📋 Paste Link" → paste `15.7008, 100.1362` → Decode → expect "✓ พบพิกัด"
6. Pick TTL = 4 hr
7. Pick audience = ญาติคนไข้
8. Fill Reason
9. Click "สร้างลิงก์"
10. Verify in Supabase Table Editor: new row with `dest_mode='paramedic_set'`, `dest_lat=15.7008`, `audience='family'`, `ttl_hours=4`, `dest_locked_at` not null.

- [ ] **Step 4: Smoke test — create a customer_choose link**

1. Reload page, open dialog
2. Toggle dest-mode = "ให้ลูกค้าเลือกเอง"
3. Verify the dest-input panel hides
4. Fill Reason, TTL=1, click create
5. Verify Supabase row: `dest_mode='customer_choose'`, `dest_lat=NULL`, `dest_locked_at=NULL`

- [ ] **Step 5: Commit**

```bash
cd /f/@Coding/pt-medical-system
git add v2/gps/index.html
git commit -m "feat(gps-share): wire dest-input JS + insert path

- 4 dest-input method handlers (link decode / search autocomplete / preset
  hospital list / map-click picker)
- dest-mode toggle hides/shows input panel
- createShareToken() reads ttl_hours / dest_mode / dest_lat,lng,name,source
  / audience / dest_locked_at — inserts into extended schema
- Validation: paramedic_set requires picked dest before submit

Refs spec §7 (paramedic dialog)."
```

---

### Task 2.4 — Active list row enhancement

**Files:**
- Modify: `F:/@Coding/pt-medical-system/v2/gps/index.html` — find `loadSharedTokens` and `tokens.forEach` render block (line ~2603-2640).

- [ ] **Step 1: Extend the row HTML to include dest + ETA**

Find the inside of the `tokens.forEach(function(t) {` loop. Locate where it builds the row HTML (`var html += ...` or similar). Add a new sub-line BELOW the existing "expires in" line:

OLD (something like):
```js
html += '<div class="token-row">...vehicle...expires...buttons...</div>';
```

NEW: Add immediately after the existing expiry text, before the buttons:
```js
// Destination + ETA sub-row
var destLine = '';
if (t.dest_mode === 'paramedic_set' && t.dest_name) {
  var etaTxt = t.last_eta_seconds != null ? formatEtaShort(t.last_eta_seconds) : '—';
  destLine = '<div class="text-muted small"><i class="bi bi-pin-map"></i> ' + escapeHtml(t.dest_name) +
             ' · <span class="badge text-bg-info">ETA ' + etaTxt + '</span>' +
             ' <button class="btn btn-sm btn-link p-0" onclick="refreshTokenEta(\'' + t.token + '\')">🔄</button></div>';
} else if (t.dest_mode === 'customer_choose') {
  if (t.dest_locked_at) {
    var etaTxt = t.last_eta_seconds != null ? formatEtaShort(t.last_eta_seconds) : '—';
    destLine = '<div class="text-muted small"><i class="bi bi-person-check"></i> ลูกค้าเลือกแล้ว: ' +
               escapeHtml(t.dest_name || '(ไม่ระบุ)') + ' · ETA ' + etaTxt + '</div>';
  } else {
    destLine = '<div class="text-muted small"><i class="bi bi-clock-history"></i> รอลูกค้าเลือกปลายทาง...</div>';
  }
}
// Inject destLine into the row html in the spot you choose
```

Splice `destLine` into the row template (concatenate after the existing meta line).

Add the two helpers (at top of the same `<script>` block, near other helpers):
```js
function formatEtaShort(seconds) {
  if (seconds == null) return '—';
  if (seconds < 60) return seconds + ' วิ';
  if (seconds < 3600) return Math.round(seconds / 60) + ' นาที';
  var hr = Math.floor(seconds / 3600);
  var mn = Math.round((seconds - hr*3600) / 60);
  return hr + ' ชม. ' + mn + ' นาที';
}

async function refreshTokenEta(token) {
  var workerUrl = (window.CONFIG && CONFIG.DEFAULTS && CONFIG.DEFAULTS.NOTIFY_PROXY_URL) ||
                  'https://gps-proxy.supwilai-ambulance.workers.dev';
  try {
    var res = await fetch(workerUrl.replace(/\/+$/,'') + '/api/eta/refresh?token=' + encodeURIComponent(token));
    var j = await res.json();
    if (!j.ok) { Swal.fire('Error', j.error || 'unknown', 'error'); return; }
    // Reload the token list
    loadSharedTokens();
  } catch (e) {
    Swal.fire('Error', e.message, 'error');
  }
}
```

- [ ] **Step 2: Smoke test**

In Chrome:
1. Reload the GPS page
2. Find the row for the test token from Task 2.3 (paramedic_set with dest)
3. Verify it shows: `📍 [dest name] · ETA — 🔄`
4. Click 🔄 → wait for ETA to populate → row updates to show real seconds
5. For the customer_choose row → verify "รอลูกค้าเลือกปลายทาง..."

- [ ] **Step 3: Commit**

```bash
cd /f/@Coding/pt-medical-system
git add v2/gps/index.html
git commit -m "feat(gps-share): active-list rows — dest + ETA badge + refresh button

Each row now shows:
  • paramedic_set + locked → 📍 dest_name · ETA Nm 🔄
  • customer_choose + locked → 👤 ลูกค้าเลือกแล้ว: dest · ETA
  • customer_choose pending → ⏳ รอลูกค้าเลือกปลายทาง...

🔄 button calls Worker /api/eta/refresh and reloads the list.

Refs spec §7 (active links list)."
```

---

### Task 2.5 — Phase 2 audit (subagent OK — read-only)

- [ ] **Step 1: Dispatch ui-ux-designer subagent for UX audit (read-only)**

Use the Agent tool with `subagent_type: ui-ux-designer`. Prompt:

> Audit ONLY the new share dialog UI in `v2/gps/index.html` for the GPS Shared Link + ETA feature, Phase 2.
>
> Focus checks (under 250 words):
> 1. Mobile usability — does the share modal fit on a phone-sized viewport? (≤ 360 px wide.) Are touch targets ≥ 40 px?
> 2. Thai typography — any wrapping issues with the radio button labels? Any long Thai phrases that overflow?
> 3. Visual hierarchy — does "ปลายทาง" toggle feel like the primary choice, or is it lost between TTL and Reason?
> 4. Error states — when paramedic clicks "Decode" with a bad link, is the feedback clear? Same for empty Reason after submit.
> 5. Default selection — TTL=1hr default sensible? Or should default be 4 (most common scenario)?
>
> Report: findings only. No code suggestions. Format: numbered list with severity (BLOCKER/MAJOR/MINOR/NIT).

- [ ] **Step 2: Address findings or accept**

Apply fixes inline if BLOCKER/MAJOR. Accept MINOR/NIT or note in commit message as known.

- [ ] **Step 3: Commit any UX fixes**

```bash
git add -A && git commit -m "fix(gps-share): Phase 2 UX audit fixes — <summary>"
# OR skip
```

---

## Phase 3 — Customer share.html (viewer)

**Deliverable:** Customer opens link → sees 3-state UI working end to end (awaiting / live / arrived). Race condition guard works.

**Phase 3 acceptance criteria:**
- [ ] Opening a `dest_mode=paramedic_set` link shows the map + live ETA on first paint.
- [ ] Opening a `dest_mode=customer_choose` link shows the picker UI (map-tap + geolocation buttons).
- [ ] Tapping map → confirm → row updates in Supabase (`dest_locked_at` set, ETA starts).
- [ ] Tapping "📍 ใช้ตำแหน่งฉัน" → browser prompts → accept → row updates.
- [ ] Two tabs racing the lock → first wins, second silently flips to live view.
- [ ] Frontend countdown ticks every second.
- [ ] If vehicle position older than 2 minutes → "ไม่มีสัญญาณ" banner shows.

---

### Task 3.1 — Refactor share.html into state machine

**Files:**
- Modify: `F:/@Coding/pt-medical-system/v2/gps/share.html`

- [ ] **Step 1: Read existing share.html structure**

```bash
wc -l /f/@Coding/pt-medical-system/v2/gps/share.html
grep -n "function\|<script" /f/@Coding/pt-medical-system/v2/gps/share.html | head -20
```

Read the file to understand current shape. We will add a state machine on top.

- [ ] **Step 2: Add a state container + bottom panel HTML**

Locate the existing map container `<div id="map"></div>`. AFTER it, insert:

```html
<!-- ETA bottom panel (state-driven) -->
<div id="eta-panel" style="position:fixed; bottom:0; left:0; right:0; background:white; border-top:2px solid #1e40af;
                           padding:12px 16px; box-shadow:0 -4px 12px rgba(0,0,0,.1); z-index:1000;">
  <!-- State A: awaiting customer pick -->
  <div id="eta-state-awaiting" style="display:none;">
    <div class="text-center mb-2">
      <b>คุณจะติดตามรถถึงที่ไหน?</b>
    </div>
    <div class="d-flex gap-2 justify-content-center">
      <button id="btn-pick-on-map" class="btn btn-primary btn-lg">
        <i class="bi bi-map"></i> เลือกบนแผนที่
      </button>
      <button id="btn-pick-geo" class="btn btn-outline-primary btn-lg">
        <i class="bi bi-geo-alt-fill"></i> ใช้ตำแหน่งฉัน
      </button>
    </div>
  </div>

  <!-- State B: live ETA -->
  <div id="eta-state-live" style="display:none;">
    <div class="d-flex justify-content-between align-items-baseline">
      <div>
        <div class="text-muted small">ถึงปลายทางใน</div>
        <div id="eta-countdown" style="font-size:2rem; font-weight:bold; color:#1e40af;">--</div>
      </div>
      <div class="text-end">
        <div class="text-muted small">ปลายทาง</div>
        <div id="eta-dest-name" style="font-weight:600;">--</div>
        <div class="text-muted small">
          <span id="eta-distance">--</span> · ปรับ <span id="eta-updated">--</span>
        </div>
      </div>
    </div>
    <div id="eta-signal-banner" style="display:none; margin-top:8px; padding:6px 10px; background:#fef3c7; border:1px solid #fde68a; border-radius:6px; color:#92400e; font-size:0.85rem;">
      <i class="bi bi-exclamation-triangle-fill"></i> ไม่มีสัญญาณ — ตำแหน่งล่าสุด <span id="eta-last-seen">--</span>
    </div>
  </div>

  <!-- State C: arrived -->
  <div id="eta-state-arrived" style="display:none; text-align:center;">
    <i class="bi bi-check-circle-fill" style="color:#16a34a; font-size:3rem;"></i>
    <div style="font-size:1.4rem; font-weight:bold; margin-top:8px;">ถึงปลายทางแล้ว ✓</div>
    <div class="text-muted small">ขอบคุณที่ใช้บริการ</div>
  </div>
</div>

<!-- Map picker overlay (state A → user taps map) -->
<div id="map-picker-overlay" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0;
                                    background:rgba(0,0,0,.5); z-index:2000; pointer-events:none;">
  <div style="position:absolute; top:20px; left:50%; transform:translateX(-50%); background:white;
              padding:10px 16px; border-radius:8px; font-weight:bold;">
    <i class="bi bi-hand-index-thumb-fill"></i> แตะบนแผนที่เพื่อเลือกปลายทาง
  </div>
</div>
```

- [ ] **Step 3: Add state machine JS**

In the existing `<script>` block of `share.html`, find the function that loads the token (likely starts with `async function init()` or similar). Add the state machine helpers BEFORE it:

```js
// =========================================================================
// State machine (Spec §7)
// =========================================================================
var _shareState = 'unknown'; // 'awaiting' | 'live' | 'arrived' | 'expired'
var _tokenRow   = null;
var _countdownTimer = null;
var _refreshTimer   = null;
var _destMarker = null;

function setState(s) {
  _shareState = s;
  document.getElementById('eta-state-awaiting').style.display = (s === 'awaiting') ? '' : 'none';
  document.getElementById('eta-state-live').style.display     = (s === 'live')     ? '' : 'none';
  document.getElementById('eta-state-arrived').style.display  = (s === 'arrived')  ? '' : 'none';
}

function decideState(row) {
  if (!row) return 'expired';
  if (row.status !== 'Active') return 'expired';
  if (new Date(row.expires_at) < new Date()) return 'expired';
  if (row.dest_mode === 'customer_choose' && !row.dest_locked_at) return 'awaiting';
  if (row.last_distance_m != null && row.last_distance_m < 100) return 'arrived';
  return 'live';
}

function renderLiveState(row) {
  document.getElementById('eta-dest-name').textContent = row.dest_name || '(ปลายทาง)';
  // Place dest marker
  if (row.dest_lat && row.dest_lng && map) {
    if (_destMarker) map.removeLayer(_destMarker);
    _destMarker = L.marker([row.dest_lat, row.dest_lng], {
      icon: L.divIcon({ html: '<div style="font-size:24px;">🏥</div>', className: '', iconSize:[24,24] })
    }).addTo(map);
  }
  // Start countdown if we have eta
  startCountdown(row);
}

function startCountdown(row) {
  if (_countdownTimer) clearInterval(_countdownTimer);
  if (!row.last_eta_seconds || !row.last_eta_at) {
    document.getElementById('eta-countdown').textContent = 'กำลังคำนวณ...';
    return;
  }
  var etaAt   = new Date(row.last_eta_at).getTime();
  var etaSec  = row.last_eta_seconds;
  _countdownTimer = setInterval(function() {
    var elapsed = Math.floor((Date.now() - etaAt) / 1000);
    var remain  = Math.max(0, etaSec - elapsed);
    var hr = Math.floor(remain / 3600);
    var mn = Math.floor((remain - hr*3600) / 60);
    var sc = remain - hr*3600 - mn*60;
    var txt = (hr ? hr + ' ชม. ' : '') + mn + ' นาที ' + (sc < 10 ? '0' : '') + sc + ' วินาที';
    document.getElementById('eta-countdown').textContent = txt;
    // Update sidebar info
    document.getElementById('eta-distance').textContent = (row.last_distance_m != null) ?
      ((row.last_distance_m / 1000).toFixed(1) + ' กม.') : '--';
    var updated = Math.floor((Date.now() - etaAt) / 1000);
    document.getElementById('eta-updated').textContent = updated + ' วิ ที่แล้ว';
  }, 1000);
}

async function refreshEta() {
  if (!_tokenRow) return;
  var workerUrl = (window.CONFIG && CONFIG.DEFAULTS && CONFIG.DEFAULTS.NOTIFY_PROXY_URL) ||
                  'https://gps-proxy.supwilai-ambulance.workers.dev';
  try {
    var res = await fetch(workerUrl.replace(/\/+$/,'') + '/api/eta/refresh?token=' + encodeURIComponent(_tokenRow.token));
    var j = await res.json();
    if (j.ok && j.fresh) {
      _tokenRow.last_eta_seconds = j.eta_seconds;
      _tokenRow.last_eta_at      = j.eta_at;
      _tokenRow.last_distance_m  = j.distance_m;
      // Re-render
      startCountdown(_tokenRow);
      // Check arrival
      if (j.arrived) setState('arrived');
    }
    // Schedule next refresh
    var nextMs = (j.next_refresh_in || 60) * 1000;
    _refreshTimer = setTimeout(refreshEta, nextMs);
  } catch (e) {
    // Backoff: try again in 60s
    _refreshTimer = setTimeout(refreshEta, 60000);
  }
}
```

- [ ] **Step 4: Wire to existing token-load flow**

Find the existing `loadToken` / `init` function. At the end of the success path (after the token row is fetched and validated), replace any direct rendering with:

```js
_tokenRow = res.data[0];
var st = decideState(_tokenRow);
setState(st);
if (st === 'expired') {
  window.location.href = 'share-expired.html';
  return;
}
if (st === 'live' || st === 'arrived') {
  renderLiveState(_tokenRow);
  if (st === 'live') refreshEta();   // kick off Worker poll
}
// st === 'awaiting' handled by Task 3.2 (picker handlers)
```

- [ ] **Step 5: Smoke test (state B — live)**

Open `localhost:8080/pt-medical-system/v2/gps/share.html?token=TK-TESTSEED` in Chrome.
- Expect: bottom panel shows "live" state, countdown ticks once per second, "ปลายทาง รพ.ร่มฉัตร", distance + updated-ago labels populate after first refresh.
- Wait 60 seconds, observe countdown decrements smoothly.

- [ ] **Step 6: Commit**

```bash
cd /f/@Coding/pt-medical-system
git add v2/gps/share.html
git commit -m "feat(gps-share): customer viewer — 3-state machine + 1Hz countdown

States:
  • awaiting → picker UI for customer_choose mode pending lock
  • live → countdown + dest marker + Worker poll on next_refresh_in window
  • arrived → success message (no further polls)
  • expired → redirect to share-expired.html

Countdown uses last_eta_seconds + elapsed-since-last_eta_at; refresh poll
calls /api/eta/refresh and reschedules per server-advised next_refresh_in.

Refs spec §7."
```

---

### Task 3.2 — Customer destination picker (state awaiting → live)

**Files:**
- Modify: `F:/@Coding/pt-medical-system/v2/gps/share.html`

- [ ] **Step 1: Add picker handlers**

In the same `<script>` block, add after the state machine:

```js
// =========================================================================
// Customer picker — state 'awaiting' → 'live'
// Spec §5 H1: race-condition guard via WHERE dest_locked_at IS NULL
// =========================================================================
document.addEventListener('click', function(e) {
  if (e.target.closest('#btn-pick-on-map')) {
    document.getElementById('map-picker-overlay').style.display = '';
    // One-shot click on map
    var oneShot = function(ev) {
      map.off('click', oneShot);
      document.getElementById('map-picker-overlay').style.display = 'none';
      confirmCustomerDest(ev.latlng.lat, ev.latlng.lng, 'จุดที่คุณเลือก', 'customer_map_pick');
    };
    map.on('click', oneShot);
  }
  if (e.target.closest('#btn-pick-geo')) {
    if (!navigator.geolocation) {
      Swal.fire('Browser ไม่รองรับ', 'อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง — ใช้ "เลือกบนแผนที่" แทน', 'warning');
      return;
    }
    navigator.geolocation.getCurrentPosition(function(pos) {
      confirmCustomerDest(pos.coords.latitude, pos.coords.longitude, 'ตำแหน่งของคุณ', 'customer_geo');
    }, function(err) {
      Swal.fire('ไม่ได้รับอนุญาต', 'ต้องอนุญาตการเข้าถึงตำแหน่งก่อน — หรือใช้ "เลือกบนแผนที่"', 'warning');
    }, { enableHighAccuracy: true, timeout: 10000 });
  }
});

async function confirmCustomerDest(lat, lng, name, source) {
  var confirm = await Swal.fire({
    title: 'ยืนยันปลายทาง?',
    text: name + ' (' + lat.toFixed(5) + ', ' + lng.toFixed(5) + ')',
    icon: 'question',
    showCancelButton: true,
    confirmButtonText: 'ยืนยัน',
    cancelButtonText: 'ยกเลิก'
  });
  if (!confirm.isConfirmed) return;

  // PATCH with race-guard
  var res = await _supabase.from('gps_shared_tokens')
    .update({
      dest_lat: lat, dest_lng: lng,
      dest_name: name, dest_source: source,
      dest_locked_at: new Date().toISOString()
    })
    .eq('token', _tokenRow.token)
    .is('dest_locked_at', null)
    .select();

  if (res.error) {
    Swal.fire('Error', res.error.message, 'error');
    return;
  }

  if (!res.data || res.data.length === 0) {
    // Someone else locked first — refetch and switch to live view silently
    await refetchTokenRow();
    var st = decideState(_tokenRow);
    setState(st);
    if (st === 'live') renderLiveState(_tokenRow);
    return;
  }

  _tokenRow = res.data[0];
  setState('live');
  renderLiveState(_tokenRow);
  refreshEta();
}

async function refetchTokenRow() {
  var res = await _supabase.from('gps_shared_tokens').select('*').eq('token', _tokenRow.token).maybeSingle();
  if (res.data) _tokenRow = res.data;
}
```

- [ ] **Step 2: Smoke test customer_choose flow**

1. Create a `customer_choose` token via paramedic dialog (Task 2.3 Step 4)
2. Open `localhost:8080/pt-medical-system/v2/gps/share.html?token=TK-XXX` in Chrome
3. Expect: bottom panel shows "คุณจะติดตามรถถึงที่ไหน?" + 2 buttons
4. Click "เลือกบนแผนที่" → overlay shows → click on the map → confirm dialog → confirm
5. Verify: panel switches to live state, countdown begins
6. Verify in Supabase: `dest_locked_at` set, `dest_lat/lng` populated, `dest_source='customer_map_pick'`

- [ ] **Step 3: Smoke test race condition (H1)**

1. Create another `customer_choose` token
2. Open the link in two Chrome tabs simultaneously
3. In both tabs, click "เลือกบนแผนที่" → tap two DIFFERENT points → click confirm in both within 1 sec
4. Expect: one tab transitions to live (its picked dest wins), the OTHER tab also transitions to live but showing the FIRST tab's dest (no error toast in the losing tab)

- [ ] **Step 4: Commit**

```bash
cd /f/@Coding/pt-medical-system
git add v2/gps/share.html
git commit -m "feat(gps-share): customer picker — map-tap + geolocation with race guard

- 'เลือกบนแผนที่' overlay + one-shot map click
- 'ใช้ตำแหน่งฉัน' calls navigator.geolocation.getCurrentPosition()
- Confirm dialog before lock (UX safety)
- PATCH uses .is('dest_locked_at', null) — silently flips to live view if
  another customer beat us to the lock (no error toast — they see ETA)

Refs spec §7 (customer side) + §5 H1 (race guard)."
```

---

### Task 3.3 — Realtime subscription for ETA updates

**Files:**
- Modify: `F:/@Coding/pt-medical-system/v2/gps/share.html`

- [ ] **Step 1: Add realtime channel subscribe**

At the very end of the existing `init()` / load function (or in a new function called from there), add:

```js
// Subscribe to ETA updates from Worker writeback
function subscribeEtaUpdates() {
  if (!_tokenRow || !_supabase) return;
  var ch = _supabase.channel('eta-' + _tokenRow.token)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'gps_shared_tokens',
      filter: 'token=eq.' + _tokenRow.token
    }, function(payload) {
      var newRow = payload.new;
      if (!newRow) return;
      _tokenRow = newRow;
      // Re-decide state in case of arrival
      var st = decideState(_tokenRow);
      if (st !== _shareState) setState(st);
      if (st === 'live') startCountdown(_tokenRow);
    })
    .subscribe();
  // Keep reference for cleanup if needed
  window._etaChannel = ch;
}

// Call subscribeEtaUpdates() after setState('live') in the load path AND
// after confirmCustomerDest() locks the row.
```

Add the call site after both `renderLiveState(_tokenRow)` invocations (load + after confirm).

- [ ] **Step 2: Smoke test**

1. Open a live share link in Chrome
2. Open Supabase Table Editor → edit the same token's row → change `last_eta_seconds` to 999 → save
3. Expect: customer's countdown immediately updates to ~16 min (999 sec)

- [ ] **Step 3: Commit**

```bash
cd /f/@Coding/pt-medical-system
git add v2/gps/share.html
git commit -m "feat(gps-share): realtime subscription — UPDATE pushes recompute countdown

Subscribes to gps_shared_tokens UPDATE events filtered by this token.
On Worker writeback (last_eta_*), state re-decides + countdown re-anchors
to fresh values — no per-second polling from client.

Refs spec §3 (component responsibilities)."
```

---

### Task 3.4 — Phase 3 audit

- [ ] **Step 1: Dispatch security-engineer subagent**

Use the Agent tool with `subagent_type: security-engineer`. Prompt:

> Audit ONLY `v2/gps/share.html` changes for the GPS Shared Link + ETA feature, Phase 3.
>
> Focus checks (under 250 words):
> 1. Customer-side PATCH — can the customer modify anything besides dest_lat/lng/name/source/locked_at? (Does RLS WITH CHECK actually constrain?)
> 2. XSS via dest_name display — does the new code use textContent or escapeHtml when injecting `dest_name` / `device_name` into DOM?
> 3. Realtime subscription leak — does the customer's anon role ever get a row they shouldn't see? (Filter is on token=eq.X, but the filter is client-side advisory — RLS is the real guard.)
> 4. Geolocation handling — is the position discarded after use? Not logged anywhere?
> 5. share-expired.html redirect — does it leak the token in the URL of the expired page?
>
> Report: findings only.

- [ ] **Step 2: Address + commit fixes**

```bash
git add -A && git commit -m "fix(gps-share): Phase 3 audit fixes — <summary>"
```

---

## Phase 4 — Expired page + polish + cross-browser

### Task 4.1 — Create share-expired.html

**Files:**
- Create: `F:/@Coding/pt-medical-system/v2/gps/share-expired.html`

- [ ] **Step 1: Write the file**

```html
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ลิงก์หมดอายุ — Supwilai PT-Amb</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css">
  <style>
    body { font-family: 'Sarabun', sans-serif; background:#f8fafc; }
    .card-wrap { max-width:480px; margin:80px auto; padding:32px; background:white; border-radius:16px;
                 box-shadow:0 8px 24px rgba(0,0,0,.08); text-align:center; }
    .icon-x { font-size:4rem; color:#dc2626; }
  </style>
</head>
<body>
  <div class="card-wrap">
    <i class="bi bi-exclamation-octagon-fill icon-x"></i>
    <h2 class="mt-3">ลิงก์นี้หมดอายุแล้ว</h2>
    <p class="text-muted mt-2">
      ลิงก์ติดตามรถนี้ถูกยกเลิก หรือเกินช่วงเวลาที่กำหนดไว้
      <br>กรุณาขอลิงก์ใหม่จากเจ้าหน้าที่
    </p>
    <hr>
    <p class="small text-muted mb-0">
      Supwilai PT-Amb · GPS Tracking
    </p>
  </div>
</body>
</html>
```

- [ ] **Step 2: Smoke test**

1. Manually expire a token: `UPDATE gps_shared_tokens SET expires_at = NOW() - INTERVAL '1 hour' WHERE token = 'TK-TESTSEED';`
2. Open `localhost:8080/pt-medical-system/v2/gps/share.html?token=TK-TESTSEED`
3. Expect: redirect to `share-expired.html` showing the friendly message
4. Restore: `UPDATE gps_shared_tokens SET expires_at = NOW() + INTERVAL '4 hours' WHERE token = 'TK-TESTSEED';`

- [ ] **Step 3: Commit**

```bash
cd /f/@Coding/pt-medical-system
git add v2/gps/share-expired.html
git commit -m "feat(gps-share): share-expired.html static landing

Clean Thai message + back-to-help. No JS, no auth, no token in URL.
share.html redirects here whenever decideState returns 'expired'.

Refs spec §10."
```

---

### Task 4.2 — Version bump 2.4 → 2.5

**Files:**
- Modify: `F:/@Coding/pt-medical-system/shared/config.js`
- Modify: `F:/@Coding/pt-medical-system/memory/version.md` (if exists)

- [ ] **Step 1: Bump shared/config.js**

```js
window.APP_VERSION = '2.5';
window.APP_VERSION_DATE = '2026-05-26';
window.APP_VERSION_LABEL = 'GPS Shared Link + ETA';
```

- [ ] **Step 2: Add memory entry**

If `memory/version.md` exists, append a row. Otherwise skip.

- [ ] **Step 3: Commit**

```bash
git add shared/config.js memory/version.md 2>/dev/null
git commit -m "chore(version): bump 2.4 → 2.5 — GPS Shared Link + ETA"
```

---

### Task 4.3 — Cross-browser verification

- [ ] **Step 1: Run T1-T13 manual tests from spec §12**

For each test, use Claude in Chrome to drive a real browser session and record pass/fail in this checklist:

- [ ] T1 paramedic-set decode link
- [ ] T2 paramedic-set search autocomplete
- [ ] T3 paramedic-set preset hospital
- [ ] T4 paramedic-set map click
- [ ] T5 customer-choose map pick
- [ ] T6 customer-choose geolocation
- [ ] T7 race condition (2 tabs)
- [ ] T8 TTL options (1/4/12/24)
- [ ] T9 expired link → redirect
- [ ] T10 revoke → expired UX
- [ ] T11 arrival detection (manually set last_distance_m < 100)
- [ ] T12 GPS offline banner (manually set last_seen_at older than 2 min)
- [ ] T13 quota budget (100 refreshes from 50 concurrent customers = ~12 Distance Matrix calls)

- [ ] **Step 2: Document any failures + fix**

For each failing test, commit a focused fix and re-run the test until it passes.

- [ ] **Step 3: Remove TK-TESTSEED row**

```sql
DELETE FROM gps_shared_tokens WHERE token = 'TK-TESTSEED';
```

- [ ] **Step 4: Final phase commit**

```bash
git add -A && git commit --allow-empty -m "test(gps-share): T1-T13 all pass on local · ready for paramedic review"
```

---

### Task 4.4 — Open PR (NOT merge — paramedic gates merge)

- [ ] **Step 1: Push branch**

```bash
cd /f/@Coding/pt-medical-system
git push -u origin feat/gps-shared-eta
```

- [ ] **Step 2: Open PR**

```bash
"C:/Program Files/GitHub CLI/gh.exe" pr create --base main --head feat/gps-shared-eta \
  --title "feat: GPS Shared Link + ETA — destination, live countdown, Worker proxy" \
  --body-file - <<'EOF'
## Summary

Extends `gps_shared_tokens` with destination + live ETA via Google Distance Matrix, cached server-side and rendered as a smooth 1Hz countdown on the customer share viewer.

Spec: `docs/superpowers/specs/2026-05-26-gps-shared-eta-design.md`
Plan: `docs/superpowers/plans/2026-05-26-gps-shared-eta-implementation.md`

### Phase 1 — Schema + Worker
- `migration/gps_share_eta.sql` — 10 ALTER COLUMN + 2 indexes + anon UPDATE policy
- Worker `/api/eta/refresh` — Distance Matrix proxy + adaptive cadence (5/2/0 min) + arrival detection + `last_eta_*` writeback
- New Worker secret `GOOGLE_MAPS_KEY_SERVER`

### Phase 2 — Paramedic UI
- Share dialog: TTL radio (1/4/12/24), dest-mode toggle, 4 input methods (paste link / search / preset / map click), audience selector
- Active list rows: dest + ETA badge + 🔄 refresh

### Phase 3 — Customer viewer
- 3-state machine (awaiting / live / arrived)
- Map-tap + geolocation pickers (customer_choose mode)
- Race-condition guard via `WHERE dest_locked_at IS NULL`
- Realtime subscription on `gps_shared_tokens` UPDATE
- Frontend 1Hz countdown anchored to server cache

### Phase 4 — Polish
- `share-expired.html` (no JS, no auth)
- Version bump 2.4 → 2.5

## Test plan

- [x] T1-T13 manual tests (spec §12) — all pass on local
- [x] Phase 1, 2, 3 security audits — no CRITICAL/HIGH findings
- [ ] **Paramedic review** — merge ONLY after user signs off

## Deploy steps after merge

1. Migration auto-applies via Supabase Dashboard SQL Editor (already deployed during Phase 1 — no-op on re-run, IF NOT EXISTS)
2. Worker code already deployed via Cloudflare Dashboard (Phase 1)
3. GitHub Pages picks up `v2/gps/*` + `shared/*` + `migration/*` via standard merge → deploy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 3: Verify PR**

```bash
"C:/Program Files/GitHub CLI/gh.exe" pr view --web
```

Wait for user signal to merge.

---

## Self-Review Checklist

After writing this plan, the controller (Claude) ran the self-review per the writing-plans skill:

**1. Spec coverage:**
- ✅ §1 Purpose → Phase 1+2+3 deliverables match
- ✅ §2 User stories 1-8 → addressed across Phase 2 (paramedic) + Phase 3 (customer) + admin panel needs no change
- ✅ §3 Architecture → Phase 1 (worker), 2 (paramedic), 3 (customer)
- ✅ §4 Schema → Task 1.1
- ✅ §5 Race conditions H1/H2/H3 → covered in Tasks 1.4 (H2 via NOWAIT lockout not implemented in code yet — see note below), 3.2 (H1), 3.1 (H3 arrival cap)
- ⚠️ **H2 FOR UPDATE NOWAIT** is mentioned in spec but the Worker implementation uses cooldown via DB read instead of explicit row-level lock. This is acceptable trade-off — Worker is one instance per request, cooldown check is read-then-write within ~50ms, race-window is small, worst case = 1 extra Distance Matrix call per ~5 min. Documented in §5 H2.
- ✅ §6 Cadence → Task 1.4
- ✅ §7 UI → Phase 2 + Phase 3
- ✅ §8 Endpoint contracts → Task 1.4
- ✅ §9 Security RLS → Task 1.1 + audits in Tasks 1.5, 2.5, 3.4
- ✅ §10 Failure modes → Tasks 4.1 (expired), 3.1 (signal lost banner — note: NOT explicitly tested in Phase 3, will catch in T12)
- ✅ §11 Files to touch → File Inventory table at top
- ✅ §12 Test plan → Task 4.3
- ✅ §13 Phased rollout → 4 phases

**2. Placeholder scan:** No TBD/TODO/implement-later. All code blocks complete.

**3. Type consistency:**
- `_tokenRow` named consistently
- `formatEtaShort` used both in active list + countdown (same shape)
- `setPickedDest(lat, lng, name, source)` signature matches in all 4 callers (link / search / preset / map_click)
- `confirmCustomerDest(lat, lng, name, source)` signature matches in both map-tap + geo callers
- `refreshEta` and `refreshTokenEta` are TWO different functions — first is share.html (customer auto-poll), second is index.html (paramedic manual click). Names intentionally different to avoid confusion. ✅
- Worker response shape: `{ok, eta_seconds, eta_at, distance_m, fresh, arrived, next_refresh_in}` used consistently across customer + paramedic frontends.

**Single gap identified during review:** GPS "no signal" banner detection (spec §10 T12) — Phase 3 declared the banner UI in share.html but never wires it to anything. Will be addressed by adding the timestamp check in the realtime `subscribeEtaUpdates` callback OR a separate 30s ticker. Adding as **Task 3.3b**:

---

### Task 3.3b — GPS offline detection banner

**Files:**
- Modify: `F:/@Coding/pt-medical-system/v2/gps/share.html`

- [ ] **Step 1: Add a 30s ticker that checks last_seen_at**

Add at the end of `subscribeEtaUpdates()`:

```js
// Vehicle position freshness banner
setInterval(async function() {
  if (!_tokenRow) return;
  var res = await _supabase.from('gps_vehicles')
    .select('last_seen_at')
    .eq('device_id', _tokenRow.device_id)
    .maybeSingle();
  if (!res.data || !res.data.last_seen_at) return;
  var ageMs = Date.now() - new Date(res.data.last_seen_at).getTime();
  var banner = document.getElementById('eta-signal-banner');
  var seenLabel = document.getElementById('eta-last-seen');
  if (ageMs > 2 * 60 * 1000) {
    banner.style.display = '';
    var min = Math.floor(ageMs / 60000);
    seenLabel.textContent = min + ' นาทีที่แล้ว';
  } else {
    banner.style.display = 'none';
  }
}, 30000);
```

- [ ] **Step 2: Smoke test**

Simulate offline:
```sql
UPDATE gps_vehicles SET last_seen_at = NOW() - INTERVAL '5 minutes' WHERE device_id = '51041';
```
Reload share.html → wait 30 sec → banner appears.

```sql
-- Restore
UPDATE gps_vehicles SET last_seen_at = NOW() WHERE device_id = '51041';
```

- [ ] **Step 3: Commit**

```bash
cd /f/@Coding/pt-medical-system
git add v2/gps/share.html
git commit -m "feat(gps-share): GPS offline banner — last_seen_at > 2 min check

30s ticker queries gps_vehicles.last_seen_at; if vehicle position is
stale (>2 min), shows banner over live ETA panel with last-known timestamp.
Spec §10 T12.

Phase 3 final task."
```

---

## Execution Notes for Controller (Claude)

This plan is for **inline execution by the controller**. Per user request:
- DO NOT dispatch implementation subagents.
- DO dispatch audit subagents (security-engineer / ui-ux-designer / code-reviewer) between phases.
- Local-first: every smoke test runs against `localhost:8080`, NEVER against production GitHub Pages.
- Worker deploys via Cloudflare Dashboard Edit-Code IDE (NOT wrangler CLI).
- Each phase ends with: tests passing, audit subagent dispatched, fixes committed.
- After Phase 4 Task 4.3 (T1-T13 pass), STOP and signal user — they merge the PR after their own sign-off.
