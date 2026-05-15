# PT Medical System — Design Document

ระบบบันทึก/ติดตามสำหรับทีมแพทย์-กู้ชีพ. Multi-deployment (Supwilai + Thegood) บน infrastructure เดียว.

## 1. Purpose & Scope

3 use cases หลัก:
- **Patient Transport** — บันทึกการส่งต่อผู้ป่วย (เคส, vitals, airway, triage, consent, DNR)
- **First Aid** — บันทึกปฐมพยาบาลในงาน Event (registry, treatments, supplies)
- **Location** — ฐานข้อมูลพิกัดลูกค้า + แผนที่ + share tokens

Modules ประกอบ: Transport, Firstaid, Location, GPS, Monitor (admin), Fleet, Admin Settings, Dashboard.

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Hosting | GitHub Pages (static, auto-deploy from `main`) |
| Database | Supabase PostgreSQL (Singapore region) |
| Auth | GAS HR API (employee verify) + Supabase session in localStorage |
| Images | Cloudinary (unsigned upload, auto-optimize) |
| Frontend | HTML + Bootstrap 5 + vanilla JS, single HTML per module |
| Maps | Leaflet + OpenStreetMap + MarkerCluster |
| Charts | Chart.js 4.4.0 |
| Realtime | Supabase Realtime (Transport merge state) |
| Notifications | Supabase DB webhook → CF Worker `/notify/check` → Line/Telegram |
| Worker | Cloudflare Workers (`line-oa-hub`, notify worker) |
| Geocoding | Nominatim (reverse), unshorten.me (short URL) |

## 3. Architecture

### Canonical V2 (live)
```
/v2/index.html              ← portal
/v2/<module>/index.html     ← module shell (rail + subnav + content)
/v2/shared.{js,css}         ← shared helpers
/v2/sw.js                   ← service worker
/v2/preview/<module>.html   ← preview-first mockups (buddhist-way redesign staging)
```

V1 archived at `/v1/`. Root redirects to V2 with SW unregister stub.

### Backend
```
/shared/{config,auth,cloudinary}.js     ← per-deployment credentials
/supabase/functions/                    ← Edge Functions (expand_maps_url)
/supabase/migrations/                   ← SQL schema
/cloudflare/                            ← Workers (notify, line-oa-hub)
/gas/                                   ← Google Apps Script integrations
```

### Database (Supabase tables)
| Table | Module |
|---|---|
| `cases`, `settings`, `activity_log` | Transport |
| `fa_events`, `fa_registry`, `fa_event_tokens` | Firstaid |
| `loc_customers`, `loc_shared_tokens` | Location |
| `vehicles`, `vehicle_status` | Fleet |
| `gps_devices`, `gps_positions` | GPS |

Key RPCs: `expand_maps_url`, `fa_bump_supply` (atomic supply decrement).

## 4. UI Layout Pattern (V2)

### Desktop (`≥ 1025px`)
- **Rail** (56px icon column, left) — module switcher
- **Subnav** (240px, left of content) — section/filter list within module
- **Content** — full-bleed, flush topbar

### Mobile / Tablet portrait (`≤ 1024px portrait`)
- Rail + subnav hidden
- **Topbar** + hamburger (opens rail as drawer)
- **Bottom nav (`pt-bnav`)** — 3-4 cells, replaces subnav
- **Bottom sheet (`pt-bsheet`)** — opens for filters/actions
- **FAB** — center-floating where applicable (Location: `+` add)

Desktop and tablet landscape: untouched. All mobile rules behind `@media (max-width:1024px) and (orientation:portrait)`.

## 5. Established UI Patterns

### Flush topbar
Container `padding:0`, topbar `padding:10px 18px; margin:0`, sticky `top:0`. No negative-margin escape.

### Kebab menu (two approaches)
- **Portal-to-body** (Location): escapes ancestor overflow/transform
- **CSS overflow + flip-up** (Transport): when event delegation on parent

Both: auto-close on scroll/resize, z-index ≥1020.

### Mobile touch & typography
- Icon-only buttons: ≥40px (Apple HIG)
- Form inputs: ≥44px height, font-size ≥16px (prevent iOS zoom)
- Thai text: `word-break:break-word; overflow-wrap:anywhere`

### Center FAB + bnav coexistence
bnav grid columns = `visible_buttons + 1` (extra invisible pocket cell). FAB at `left:50%` sits in pocket gap, not over a button.

### GPS_ENABLED gating
Single `settings.GPS_ENABLED` controls 11 surfaces (rail icons, KPI strip, mini-map, per-row buttons, direct `/gps/` URL). Pattern: explicit `display = enabled ? '' : 'none'`, never show-only.

## 6. Auth & Roles

```
Login → GAS HR API → session in localStorage
Each request → check session + role
```
Roles: `Admin` / `Staff` (case-mixed from GAS — normalize on check). Admin sees Monitor, Tokens, maintenance pages.

## 7. Image Handling
- New: Cloudinary direct upload (unsigned preset `pt-medical`)
- Legacy: Google Drive URLs auto-converted (`drive.google.com/file/d/ID` → `lh3.googleusercontent.com/d/ID`)

## 8. Realtime & State

Transport: Supabase Realtime merge with `_loadedRawSnapshot`, `_handleRemoteCaseUpdate`, `_pendingMergeCaseId`. Guards: `isPopulating`, `isSaving`, `_rtMergeInProgress`. Auto-save 2 min + `formDirty` flag.

## 9. Notifications

```
DB change → Supabase webhook → CF Worker /notify/check
  → debounce + refire-on-worse + ack-resets-debounce
  → Line OA / Telegram
```

Activity log table tracks all status changes.

## 10. Multi-Deployment

Two independent deployments share codebase:
- **Supwilai** — `supwilaimedical/pt-medical-system` (primary)
- **Thegood** — separate repo + Supabase project

**Sync rules:**
- DO sync: HTML/JS/CSS, schema migrations (run separately), worker code
- DO NOT sync: `shared/config.js` (credentials), `cloudflare/wrangler.toml`, secrets

## 11. Hard Rules (Buddhist-way refactor)

Active during ongoing mobile UX redesign:

1. **Logic byte-identical** — snapshot mechanism, medical interlocks, data flow stay untouched
2. **Preview-first** — build static mockup in `v2/preview/<module>.html`, user reviews on real device, only then apply to live
3. **CSS + wrapper classes only** — never rename/remove existing `id`, `name`, `onclick`, `class` hooks that JS reads
4. **Breakpoint isolation** — all mobile rules behind `@media (max-width:1024px) and (orientation:portrait)`. Desktop/landscape untouched
5. **Medical interlocks immutable** — airway/O2/vent/central-line/arrest logic, vitals lock, triage colors, GCS, NR status flow
6. **Order**: Transport → Firstaid → Location → GPS → Monitor → Fleet → Admin → Dashboard

## 12. Design Tokens

- Colors: Bootstrap 5 + custom vars `--tc` (triage), `--gc` (gender), Tailwind-ish neutrals (`#0f172a`, `#64748b`, `#e2e8f0`, `#f1f5f9`)
- Triage urgency: Red (วิกฤต) / Pink (ฉุกเฉิน) / Yellow (เร่งด่วน) / Green (ไม่เร่งด่วน)
- AVPU: A=green, V=yellow, P=orange, U=red
- Gender: ♂(blue) / ♀(pink) / ⚧(yellow)
- Active state colors per module: Location=`#eab308`, Transport=`#0ea5e9`, Fleet=`#0369a1`

## 13. File Conventions

- Single HTML per module — full app inside one file (CSS + HTML + JS)
- Shared helpers: `v2/shared.js`, `v2/shared.css`, `shared/config.js`
- Backup rule: GAS editor edits MUST mirror to local folder
- PowerShell Thai gotcha: use `[IO.File]::ReadAllText($p, UTF8)` (Get-Content -Raw mangles via Win-874)
