# PT-Amb Tech Brief — สำหรับ DMS migration

**สำคัญก่อน:** PT-Amb **ไม่ใช่ modern SPA**. ใช้ vanilla HTML + Bootstrap 5 + Supabase CDN, ไม่มี build step. คำถามหลายข้อจะตอบ "N/A" — ระบบเรียบง่ายกว่าที่คาด.

---

## 1. Tech Stack

| Item | Value |
|---|---|
| Framework | **None — vanilla JS** (no React/Vue/Svelte/Next) |
| TypeScript | ไม่ใช้ — pure JS |
| Build tool | ไม่มี — single HTML per module |
| Package manager | npm (มี `package.json` แต่ใช้แค่ dev tools — `csv-parse`, `docx`) |
| Node | dev tools เท่านั้น, runtime ไม่ใช้ |

```json
// package.json (root)
{
  "name": "pt-medical-system",
  "type": "commonjs",
  "dependencies": {
    "@supabase/supabase-js": "^2.103.0",
    "csv-parse": "^6.2.1",
    "docx": "^9.6.1"
  }
}
```

Frontend โหลด Supabase ผ่าน CDN:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
```

---

## 2. โครงสร้าง repo (single app)

```
pt-medical-system/
├── index.html                  ← portal → v2
├── v2/
│   ├── index.html              ← landing
│   ├── transport/index.html    ← 524K — full module ในไฟล์เดียว
│   ├── firstaid/index.html     ← 224K
│   ├── location/index.html     ← 160K
│   ├── gps/, monitor/, fleet/, admin.html
│   ├── shared.js, shared.css   ← drawer, kebab, modal helpers
│   ├── sw.js                   ← service worker (scope /v2/)
│   └── manifest.json           ← PWA
├── shared/
│   ├── config.js               ← SUPABASE_URL, GAS_AUTH_URL, DEFAULTS
│   ├── auth.js                 ← login/logout/session helpers
│   ├── cloudinary.js, gps-providers.js, map-config.js
│   ├── notify.js, realtime.js, settings.js, places-api.js
│   └── styles.css              ← global Bootstrap override
├── supabase/migrations/
├── cloudflare/                 ← Workers (notify, line-oa-hub)
├── gas/                        ← GAS HR Auth + Fleet API source
└── v1/                         ← archived legacy
```

**Pages/routes:** ไม่มี router. แต่ละ module = HTML page แยก. Internal nav = `window.location.href`.

---

## 3. UI / Styling

| Item | Value |
|---|---|
| CSS framework | **Bootstrap 5** (CDN) + custom CSS |
| Component lib | ไม่มี — Bootstrap classes + custom HTML |
| Font | **Sarabun** (Google Fonts) |
| Icons | Bootstrap Icons (`<i class="bi bi-..."></i>`) |
| Design tokens | `shared/styles.css` + `design.md` section 12 |

```css
/* shared/styles.css */
body { background:#f0f2f5; font-family:'Sarabun', sans-serif; }
.bg-modern-primary { background: linear-gradient(135deg, #1e3a5f 0%, #0d6efd 100%); }
```

Color tokens: `--tc` (triage), `--gc` (gender). Triage: Red(วิกฤต)/Pink(ฉุกเฉิน)/Yellow(เร่งด่วน)/Green(ไม่เร่งด่วน).

---

## 4. Supabase

| Item | Value |
|---|---|
| Project URL | `https://rwxaalgvkzlsyfzdebcj.supabase.co` |
| Region | Singapore (ap-southeast-1) |
| Anon key | `sb_publishable_5jmlKl7w2H_Qb4Yp1Y8gWA_-SMZfB0a` |
| Client version | `@supabase/supabase-js@2` (UMD CDN, latest v2) |
| Auth | **External — GAS HR API** (ไม่ใช้ Supabase Auth) |
| RLS | ใช้บางตาราง (settings, activity_log). Public read สำหรับ share tokens |
| Extensions | `http` (สำหรับ `expand_maps_url` Edge Function) |

**Client init:**
```js
// shared/auth.js
const _supabase = supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);
```

**"ใช้ project เดียวกับ DMS ได้ไหม":** ใช้ได้ — table prefix แยก (เช่น `dms_documents`, `dms_stock`). PT-Amb ใช้ prefix `cases`, `fa_*`, `loc_*`, `vehicles`, `gps_*`. แยก project ก็ได้.

---

## 5. Auth Flow (GAS HR — DMS ใช้อยู่แล้ว)

```
[Login form] → POST GAS_AUTH_API_URL (JSON {username, password})
            ← {status:'success', name, role}
            → localStorage.setItem('pt_user_meta', {...,loginAt})
            → show app
```

| Item | Value |
|---|---|
| Session storage | `localStorage` key `pt_user_meta` |
| Format | `{full_name, role, username, loginAt}` JSON |
| Timeout | 8 ชม. |
| Force logout | admin set `settings.FORCE_LOGOUT_AFTER` (timestamp ms), polling ทุก 5 นาที |
| Role check | `meta.role === 'Admin'` (case-mixed — normalize ก่อน) |
| Helpers | `loginUser()`, `handleLogout()`, `isLoggedIn()`, `getUserMeta()`, `refreshForceLogoutCheck()` |

**Auth endpoint:** `https://script.google.com/macros/s/AKfycby.../exec` (ห้าม expose ใน admin UI)

**Pattern สำหรับ DMS sibling:** import `<script src="../shared/auth.js">` ใช้ฟังก์ชันได้เลย.

---

## 6. Deploy

| Item | Value |
|---|---|
| Host | **GitHub Pages** (auto-deploy จาก `main`) |
| Repo | `https://github.com/supwilaimedical/pt-medical-system` |
| Domain | `https://supwilaimedical.github.io/pt-medical-system/` (no CNAME) |
| Base URL | `/pt-medical-system` (set ใน `CONFIG.BASE_URL`) |
| GH Actions | **ไม่มี** — GH Pages built-in deploy |
| Env vars | ไม่ใช้ — credentials ใน `shared/config.js` (committed plain — anon key) |
| Environments | **Single** (production = main). ไม่มี staging |
| CDN | jsDelivr (Bootstrap, Supabase, Leaflet, Chart.js) |

**Workers (Cloudflare):**
- notify worker — Supabase webhook → Line/Telegram
- `line-oa-hub.supwilai-ambulance.workers.dev` — Line OA chatbot

---

## 7. Existing Routes + Patterns

**Routes (HTML pages, ไม่ใช่ SPA routes):**
- `/v2/` — landing
- `/v2/transport/` — patient transport
- `/v2/firstaid/` — event registry
- `/v2/location/` — customer + map
- `/v2/gps/` — vehicle tracking
- `/v2/monitor/` — admin monitor dashboard
- `/v2/fleet/` — fleet status
- `/v2/admin.html` — 12 sections (organization, branding, GPS, OCR, notifications, integrations, sessions, pubshare, stats, activity, overview, docs)

**Nav structure:**
- Desktop: rail (56px icon) + subnav (240px) — `v2/v2-rail.html` template
- Mobile portrait (≤1024px): bottom nav (`pt-bnav`) + bottom sheet (`pt-bsheet`)

**เพิ่ม route ใหม่:** สร้าง `/v2/dms/index.html` + `/v2/stock/index.html`. ต้องแก้ทุก module HTML เพื่อเพิ่ม rail icon (vanilla ไม่มี shared layout).

**API call pattern:**
```js
// Direct supabase client — no SWR/React Query
var r = await _supabase.from('cases')
  .select('*')
  .eq('status', 'active')
  .order('created_at', { ascending: false });
if (r.error) console.error(r.error);
var data = r.data || [];
```

**Realtime:** `shared/realtime.js` wrap `_supabase.channel().on('postgres_changes',...)`.

---

## 8. Constraints / Opinions

- **Mobile-first**: yes — dedicated mobile UX refactor (Buddhist-way preview-first). Breakpoint `@media (max-width:1024px) and (orientation:portrait)`
- **PWA**: enabled — `v2/manifest.json` + `v2/sw.js`
- **Service worker**: scope `/v2/`, network-first + cache fallback. Cache name `pt-v2-v1`
- **Preferred pattern**: vanilla — เพราะ legacy + ไม่ต้อง build = deploy ง่าย, debug ง่าย
- **Avoid**: build tools, transpile, framework version churn. ห้าม React/Next (architectural mismatch)
- **Working rules**: `SKILL.md` + `design.md` ที่ project root

---

## คำแนะนำ migration DMS

### Option A — Sibling app (vanilla, match PT-Amb stack) ✅ แนะนำ

DMS = `/v2/dms/index.html` + `/v2/stock/index.html` ใน repo เดียวกัน:
- Share `shared/auth.js`, `shared/config.js`, `shared/styles.css`
- เพิ่ม `dms_*`, `stock_*` tables ใน Supabase project เดิม (หรือแยก project)
- Auth = GAS HR เดิม (zero change)
- Deploy = git push (GH Pages auto)
- Add rail icons ใน 8 module HTML files

**ข้อดี:** seamless integration, ไม่มี build, share session, share UI
**ข้อเสีย:** ผูกกับ vanilla stack — form ซับซ้อน react-hook-form ฯลฯ ลำบาก

### Option B — Modern stack sibling (React/Vite + share auth)

DMS = separate repo deploy แยก:
- Supabase project เดียวกัน (table prefix `dms_`)
- Auth = call GAS HR endpoint ตรงๆ (port logic เป็น TS)
- Storage = `localStorage.pt_user_meta` (key เดียวกัน → SSO ถ้า same origin)
- Deploy = CF Pages / Vercel
- ไม่ share UI components — share design tokens (Sarabun, color palette)

**ข้อดี:** modern DX, type-safe
**ข้อเสีย:** SSO cross-origin ต้อง handshake หรือ same parent domain

---

## Snippets

**Supabase client init:**
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<script src="../../shared/config.js"></script>
<script>
  var _sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
</script>
```

**Auth guard (top of every module page):**
```html
<script src="../../shared/auth.js"></script>
<script>
  document.addEventListener('DOMContentLoaded', function(){
    if (!isLoggedIn()) {
      window.location.href = CONFIG.BASE_URL + '/';
      return;
    }
    startSessionPolicyPolling();
    // ... init module
  });
</script>
```

**Login flow (auth.js):**
```js
const res = await fetch(CONFIG.GAS_AUTH_API_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ username, password }),
  redirect: 'follow'
});
const result = await res.json();
if (result.status === 'success') {
  localStorage.setItem('pt_user_meta', JSON.stringify({
    full_name: result.name || username,
    role: result.role || 'User',
    username,
    loginAt: new Date().toISOString()
  }));
}
```

**Example route component:** ไม่มี — ทุก page = full HTML document. Reference: `v2/fleet/index.html` (84K = smallest, อ่านง่าย).
