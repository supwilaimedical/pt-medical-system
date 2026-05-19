# PT Medical System — Design Reference

UI/CSS structure ของ V2 modules. ใช้เป็น reference เวลา redesign/audit/แก้บั๊ก. ทุก class/id ในนี้คือชื่อจริงที่ใช้ใน HTML ปัจจุบัน.

**Last audit:** 2026-05-19. **Files:** `v2/<module>/index.html` + `v2/chrome.css` (shared navy theme).

**Recent session (2026-05-19) — 6 PRs merged:**
- **PR #3** `f0be0d3` + `a900ffa` — patient banner WHITE bg + dynamic `--form-tb-h` so fixed topbar doesn't cover form on PC
- **PR #4** `90171ff` — timeline + patient banner both WHITE, strip card chrome (border/radius/shadow/margin all 0)
- **PR #5** `d9021ac` — transport subnav case-info card: override inline `background:#f1f5f9` + dark text on navy
- **PR #6** `8f3f560` — mobile timeline flush (no navy seam) + banner dedup (hide `#ban-mini-name`) + `#ban-op-no` font 0.78rem
- **PR #7** `9ed78fb` — ALS row baseline (strip `pb-1`, normalize line-height) + Urgent+Consent on one row (hide details `.col-md-3`)
- **PR #8** `78f7dae` — firstaid subnav: `.back-link` + `.event-ctx` contrast on navy chrome

**PC audit verdict (live verified 2026-05-19):** 0 confirmed issues across all 7 modules. Earlier "Monitor purple CTA" + "Admin orange active" were **false positives** — both are intentional module-accent themed states (computed: `rgba(196,181,253,1)` Monitor purple CTA = designed; `rgba(253,186,116,0.22)` Admin orange = themed active). **Mobile bnav `.pt-bnav a .ct` count chip** = code-level concern (light bg not overridden by chrome.css for navy theme) — unverified live (resize hit min-width 1542 on dev machine).

---

## 1. Modules & Color Accents

| Module | Path | Accent (chrome.css) | Accent (legacy inline) | data-module |
|---|---|---|---|---|
| Transport | `v2/transport/` | `#7dd3fc` sky-300 | `#0ea5e9` sky-500 | `transport` |
| Firstaid | `v2/firstaid/` | `#34d399` emerald-400 | `#16a34a` green-600 | `firstaid` |
| Location | `v2/location/` | `#fde047` yellow-300 | `#eab308` yellow-500 | `location` |
| GPS | `v2/gps/` | `#fda4af` rose-300 | `#0ea5e9` sky-500 | `gps` |
| Fleet | `v2/fleet/` | `#93c5fd` blue-300 | `#0d9488` teal-600 | `fleet` |
| Monitor | `v2/monitor/` | `#c4b5fd` violet-300 | `#7c3aed` violet-600 | `monitor` |
| Admin | `v2/admin.html` | `#fdba74` orange-300 | `#0369a1` sky-700 | `admin` |

ทุก module set `data-module` บน `<body>` เพื่อให้ chrome.css scope ได้.

---

## 2. Breakpoints (uniform)

| Breakpoint | Effect |
|---|---|
| `min-width: 992px` | Rail visible (Transport, Firstaid, GPS subnav), full layout |
| `min-width: 1025px` (landscape always) | Desktop mode (bnav hidden everywhere) |
| `min-width: 1200px` | Right col shows (Transport, Firstaid, Fleet) |
| `max-width: 1024px and (orientation: portrait)` | **Mobile mode** — bnav, FAB, mobile overrides active |
| `max-width: 991px` | Hamburger shows (Transport, Firstaid, GPS subnav), mobile header padding |
| `max-width: 767px` | Rail hidden (Location, Fleet, GPS rail, Monitor rail); Location subnav also hidden |

**JS gate (uniform):** ทุก module มี `_xxxIsMobilePortrait()` ที่ใช้ `matchMedia('(max-width: 1024px) and (orientation: portrait)')` คุม bnav visibility.

---

## 3. Shared Chrome Tokens (chrome.css)

### Navy palette

| Token | Value | Used in |
|---|---|---|
| `--chrome-bg-1` | `#0a1929` | Rail gradient top |
| `--chrome-bg-2` | `#112a44` | Rail gradient bottom, bnav, admin sidebar top |
| `--chrome-bg-3` | `#1a3a5c` | Subnav, bottom sheet, monitor wide-pane head |
| `--chrome-bg-4` | `#244a6f` | Rail/subnav hover, form-topbar buttons |
| `--chrome-glass` | `rgba(17,42,68,0.82)` | Topbar (with `backdrop-filter: blur(14px)`) |
| `--chrome-text` | `#f8fafc` | Primary text on navy |
| `--chrome-text-2` | `#cbd5e1` | Secondary |
| `--chrome-text-3` | `#94a3b8` | Muted/tertiary |
| `--chrome-line` | `rgba(255,255,255,0.08)` | Dividers |
| `--shadow-chrome` | `0 8px 32px rgba(10,25,41,0.45)` | Bnav, sheet shadows |

### Per-module CSS variables

```css
body[data-module="transport"] { --accent:#7dd3fc; --accent-ink:#0c4a6e; --accent-soft:...; }
body[data-module="firstaid"]  { --accent:#34d399; --accent-ink:#022c22; ... }
/* etc. */
```

---

## 4. Universal Markup Pattern

```html
<body data-module="...">
  <aside class="v2-rail">...</aside>          <!-- 56px left strip (icons) -->
  <button class="v2-mobile-nav-toggle">☰</button> <!-- mobile only -->
  <aside class="v2-subnav">                   <!-- 240px left of content -->
    <div class="v2-subnav-header">...</div>
    <div class="v2-mobile-rail-strip">...</div> <!-- shows when subnav becomes drawer -->
    <div class="v2-subnav-section">...</div>
  </aside>
  <div id="app-main-wrapper">
    <div class="container">
      <div class="view-section active">
        <!-- TOPBAR (varies per module) -->
        <!-- CONTENT -->
      </div>
    </div>
    <aside class="<module>-rightcol">...</aside>  <!-- 280px right, PC only -->
    <nav class="pt-bnav">...</nav>                 <!-- bottom nav, mobile only -->
    <button class="fab-btn">+</button>             <!-- FAB, mobile only -->
  </div>
</body>
```

**Admin is the exception** — uses `.v2-modrail` instead of `.v2-rail`, `.admin-sidebar` instead of `.v2-subnav`, `.admin-topbar` instead of standard topbar.

---

## 5. Per-Module Class Reference

### 5.1 TRANSPORT

#### PC view

| Component | Class / ID | Notes |
|---|---|---|
| Side rail | `aside.v2-rail.no-print` | 56px wide |
| Subnav | `aside.v2-subnav.no-print` | 240px wide, has step rows & "tr-split-active" body class for split-view |
| Subnav step rows | `.v2-subnav-step-item`, `.v2-subnav-step-split-item` | Toggled by body class |
| Topbar (dashboard) | `#dashboard-view > .d-flex.justify-content-between.align-items-end` | **No dedicated class** — uses Bootstrap d-flex |
| Topbar h3 | `h3.dashboard-header` (in `.tr-colhead-left`) | Sky icon |
| Topbar (form view) | `.v2-form-topbar.no-print` | Has row1 (case actions/case-id) + Timeline strip + row2 (patient banner). **`position:fixed` ≥992px**, height varies with banner expand → JS sets `--form-tb-h` CSS var consumed by `#form-view { padding-top: var(--form-tb-h, 64px) }` so form content never gets covered |
| Timeline strip (in topbar) | `.v2-tb-timeline` (added via JS `reparentTimelineAndBanner`) | **WHITE flush pane** — `background:#fff; margin:0; padding:0; border:0; border-bottom:1px solid #e2e8f0`. On mobile `.v2-form-topbar #timeline-card { margin:0; padding:0 }` overrides `#timeline-card` ID-specificity that beat my class-only rule (see Gotcha #15) |
| Form row 2 (patient banner) | `.v2-form-topbar .v2-tb-row2` aka `.patient-banner` | **WHITE flush** — chrome.css overrides `background:#fff; color:#0f172a; border:0; border-radius:0; box-shadow:none; margin:0` (strips card chrome so pane sits flush with timeline above). Pattern documented in §14 |
| Form action buttons | `.v2-tb-btn`, `.v2-tb-btn.primary` | |
| Form topbar JS sync | `_ptSyncFormPad()` in transport/index.html | Sets `--form-tb-h` to `topbar.offsetHeight` on PC, `--pt-tb-h` (row1 only) on mobile. Runs on resize, step transition, banner toggle |
| Right col | `aside#tr-dash-right.tr-dash-right.no-print` | 280px, ≥1200px, gated by `body.tr-dash-has-rc` |
| Container override | `body:has(#dashboard-view.active) > .container { padding:0 }` | Flush layout |

#### Mobile view (≤1024px portrait)

| Component | Class / ID | Notes |
|---|---|---|
| Hamburger | `button.v2-mobile-nav-toggle` | ≤991px, opens subnav as drawer |
| Mobile rail strip | `.v2-mobile-rail-strip` | Top of subnav drawer (module icons row) |
| Topbar mobile pad | inline: `padding:12px 14px 12px 60px` | Clears 40px hamburger @ left:8 |
| Chrome.css override | `padding-left: 64px` | Doubled-ID specificity bumps to 64 for safety |
| FAB | `.fab-btn` (no id) | Sky-blue, `bottom:28px`, `translateX(-50%)`, z:1090 above bnav |
| Bnav (dashboard) | `nav.pt-bnav.pt-bnav-notch#pt-bnav` | 5-cell `1fr 1fr 80px 1fr 1fr` with center pocket |
| Bnav pocket | `span.pt-bnav-pocket` | Invisible cell for FAB notch |
| Bnav (form) | `nav.pt-bnav.pt-bnav-5#pt-bnav-form` | 5-cell flat (no notch) |
| "More" buttons | `#pt-bnav-more`, `#pt-bnav-form-more` | Open bottom sheet |
| Bottom sheet | `.pt-bsheet`, `.pt-bsheet-bd`, `.pt-bsheet-head`, `.pt-bsheet-body` | Slide-up panel |

#### Notes
- View IDs: `#dashboard-view`, `#form-view` (toggled .active)
- Container padding override applies to BOTH desktop & mobile when dashboard active
- Form view container keeps `padding:0 18px` (line 454)

---

### 5.2 FIRSTAID

#### PC view

| Component | Class / ID | Notes |
|---|---|---|
| Side rail | `aside.v2-rail.no-print` | 56px |
| Subnav | `aside.v2-subnav.no-print#v2-fa-subnav` | 240px, hidden ≤991px |
| Subnav header | `.v2-subnav-header` | Green bandaid icon |
| Subnav CTA | `.v2-subnav-cta` | Inline "+ เพิ่มผู้ป่วย" button |
| Subnav back link (event detail) | `.v2-subnav .back-link` | **chrome.css override** (PR #8) — inline `background:#f1f5f9` + `color:#0369a1` was unreadable on navy. Now `var(--chrome-bg-3)` bg + `var(--accent)` (firstaid green) text |
| Subnav event ctx | `.v2-subnav .event-ctx` + `.name` + `.meta` | **chrome.css override** (PR #8) — inline `color:#0f172a` (slate-900) + `#64748b` was unreadable on navy. Now `var(--chrome-text)` + `var(--chrome-text-3)` |
| Topbar (dashboard) | `.fa-colhead` + `.fa-colhead-left` | In `#fa-dashboard-view`, **position:fixed left:296 right:0** on PC ≥1200 |
| Topbar (event detail) | `.fa-colhead#fa-evt-info` | In `#fa-event-detail-view`, same class reused |
| Right col (dashboard) | `aside.fa-dash-right#fa-dash-right` | 280px, ≥1200px, `top:64px` to clear fixed colhead |
| Right col (event detail) | `aside.fa-evt-right#fa-registry-stats` | Sticky registry stats |
| Event FAB (PC) | `button.fa-fab.no-print` | Visible only `body.fa-in-event` |

#### Mobile view

| Component | Class / ID | Notes |
|---|---|---|
| Hamburger | `button.v2-mobile-nav-toggle` | ≤991px |
| Topbar mobile pad | `.fa-colhead { padding:12px 14px 12px 60px; margin:0 -12px 0; min-height:60px }` | -12px margin bleeds bg to viewport edge (matches view-section's 12px padding) |
| FAB (event list) | `button.fa-list-fab#fa-list-fab` | Green, `bottom:28px`, hidden when `body.fa-in-event` |
| FAB (in-event = add patient) | `.fa-fab` | Repositioned center via CSS |
| Bnav (event list) | `nav.pt-bnav.fa-bnav-notch#fa-bnav-list` | 3-cell `1fr 80px 1fr` with pocket |
| Bnav pocket | `span.fa-bnav-pocket` | (chrome.css aliases to `.pt-bnav-pocket`) |
| Bnav (in-event detail) | `nav.pt-bnav.cols-4#fa-bnav-detail` | 4-cell flat |

#### Notes
- View-section padding: `padding:0 18px 40px` desktop → `padding:0 12px 80px` mobile (80px bottom = bnav clearance)
- `body.fa-in-event` class swaps bnav variant + FAB
- Desktop topbar is `position:fixed` (not sticky) to span over right col — pattern matches Fleet/GPS

---

### 5.3 LOCATION

#### PC view

| Component | Class / ID | Notes |
|---|---|---|
| Side rail | `aside.v2-rail.no-print` | 56px, hidden ≤767px (looser than 991!) |
| Subnav | `aside.v2-subnav.no-print` | 240px, hidden ≤767px |
| Subnav header | `.v2-subnav-header` | Yellow geo-alt icon |
| Subnav sections | `.v2-subnav-section` | View / Type / Area / Share Tokens |
| Topbar (no dedicated class) | `.view-section > .d-flex.justify-content-between.align-items-end` | Standard d-flex layout |
| Topbar h3 | `h3.dashboard-header` | Yellow geo-alt icon |
| Container override | `.container { padding:0 }` | Module-wide flush |
| View-section padding | `.view-section { padding:0 }` | Flush |
| Right col | **NONE** | Map-centric module, no right rail on PC |

#### Mobile view

| Component | Class / ID | Notes |
|---|---|---|
| Hamburger | `button.v2-mobile-nav-toggle` | ≤767px |
| Mobile rail strip | `.v2-mobile-rail-strip` | |
| Topbar mobile pad | `.view-section > .d-flex.justify-content-between { padding:12px 14px 12px 60px; min-height:60px }` | |
| FAB | `div#loc-fab.fab-btn` | Inline green gradient (legacy), `bottom:28px`, `translateX(-50%)` |
| Bnav | `nav.pt-bnav#loc-bnav` | 5-cell with `.pt-bnav-pocket` on cell 3 |
| Bnav "more" | `a.more-btn#loc-bnav-more` | Opens filter bottom sheet |

#### Notes
- **Location is the reference "perfect" pattern** — flush container + flush view-section + bnav pinned at bottom + FAB centered in pocket
- Only module with hamburger at `≤767px` instead of `≤991px`
- FAB still has legacy green gradient inline (chrome.css yellow accent overrides on chrome surfaces but FAB bg still bleeds through partially)

---

### 5.4 GPS

#### PC view

| Component | Class / ID | Notes |
|---|---|---|
| Side rail | `aside.v2-rail.no-print` | 56px, ≤767px hidden |
| Subnav | `aside.v2-subnav.no-print` | 240px, ≤991px hidden |
| Subnav header | `.v2-subnav-header.v2-subnav-header-flex` | Has refresh button |
| Subnav refresh | `button.v2-subnav-btn` | Manual GPS refresh |
| Wrap (JS-built) | `div.v2-gps-wrap` | `position:relative` (allows absolute colheader) |
| Main column (JS-built) | `div.v2-gps-main` | `padding-top:56px` ≥992 to clear colheader |
| Topbar (JS-built) | `.v2-gps-colheader.v2-gps-colheader-left` | `position:absolute; top:0` spans full wrap width |
| Right col (JS-built) | `aside.v2-gps-rightcol.sheet-half#v2-gps-rightcol` | `padding-top:56px` to clear colheader |
| Stats card | `.v2-stats-card` | Inside rightcol |
| Vehicle panel | `.vehicle-panel` | Inside rightcol |

#### Mobile view

| Component | Class / ID | Notes |
|---|---|---|
| Hamburger | `button.v2-mobile-nav-toggle` | |
| Right col bottom-sheet mode | `.v2-gps-rightcol.sheet-peek/.sheet-half/.sheet-full` | Mobile converts rightcol to bottom sheet |
| Sheet backdrop | `.v2-gps-sheet-backdrop` | Shown at `.sheet-full` |
| Bnav | `nav.pt-bnav#gps-bnav` | Standard 4-cell |
| Bnav "more" | `a.more-btn#gps-bnav-more` | |
| FAB | **NONE** | Uses subnav refresh button instead |

#### Notes
- **Entire content layout (`.v2-gps-wrap`, `.v2-gps-main`, `.v2-gps-colheader`, `.v2-gps-rightcol`) is built by JS at runtime** — not static markup
- Structural topbar fix: wrap is `position:relative`, colheader `position:absolute; top:0; left:0; right:0` — different from Fleet/Transport which use `position:fixed`

---

### 5.5 FLEET

#### PC view

| Component | Class / ID | Notes |
|---|---|---|
| Side rail | `aside.v2-rail.no-print` | 56px, ≤767px hidden |
| Subnav | `aside.v2-subnav.no-print` | 240px |
| Topbar | `.v2-colheader.v2-colheader-left` | **Generic class** — only Fleet uses bare `.v2-colheader` |
| Topbar fixed (chrome.css) | `position:fixed; left:296px; right:0` | Spans over rightcol ≥992 (rail 56 + subnav 240) |
| Right col | `aside.fleet-rc.no-print` | 280px, gated by `body.fleet-has-rc`, ≤1199 hidden |
| Container-fluid mobile pad | `.container-fluid { padding:0 12px }` ≤767 | |

#### Mobile view

| Component | Class / ID | Notes |
|---|---|---|
| Hamburger | `button.v2-mobile-nav-toggle` | ≤767 (NOT 991) |
| App wrapper mobile | `#app-main-wrapper { margin-left:0; padding-top:0 }` ≤767 | |
| Colhead mobile pad | `.v2-colheader { padding:12px 14px 12px 60px; min-height:60px }` ≤1024 portrait | |
| Bnav | `nav.pt-bnav#fleet-bnav` | 4-cell: all/ok/issues/more |
| Bnav "more" | `a.more-btn#fleet-bnav-prob` | |
| FAB | **NONE** | Add-vehicle is via modal |

#### Notes
- Local CSS vars `--fleet-acc:#0d9488` (teal) and `--fleet-acc-dark` overridden by chrome.css blue accent

---

### 5.6 MONITOR

#### PC view

| Component | Class / ID | Notes |
|---|---|---|
| Side rail | `aside.v2-rail.no-print` | 56px, ≤767 hidden |
| Subnav | `aside.v2-subnav.no-print#v2-monitor-subnav` | 240px, ≤991 hidden |
| Topbar | `.monitor-page-header.mph-left` | |
| Topbar live pill | `.mph-live .dot` | Live indicator |
| Topbar wallboard toggle | `button.mph-wallboard` | Hidden ≤1099, icon-only ≤767 |
| Wide GPS pane (wallboard) | `aside#monitor-wide-gps-pane.no-print` | Shown when `body.monitor-wide-active`, NOT wrapped in @media (body class gates) |
| Wide pane width tiers | `--mwgp-w: 420px / 560px / 740px` | Viewport-tiered ≤1499 / 1500-1999 / ≥2000 |
| Wide pane head | `.mwgp-head`, `.mwgp-vh`, `.vh-name` | |

#### Mobile view

| Component | Class / ID | Notes |
|---|---|---|
| Hamburger | `button.v2-mobile-nav-toggle` | Placed BEFORE rail in DOM (unique) |
| Topbar mobile pad | `.monitor-page-header { padding:12px 14px 12px 60px; min-height:60px }` ≤767 | |
| Bnav | `nav.pt-bnav#mon-bnav` | 4-cell flat |
| FAB | **NONE** | |

#### Notes
- Wallboard mode: `body.monitor-wide-active` triggers wide GPS pane; toggle pill = `.mph-wallboard`
- localStorage: `pt_wallboard_mode` (manual toggle), auto at viewport ≥1900px
- **Topbar bg override** — Monitor `.monitor-page-header` gets `background: var(--chrome-bg-3) !important; backdrop-filter: none` to match subnav + wide-pane (all 3 cols same solid navy). Other modules' topbars use glass `var(--chrome-glass)` with blur — Monitor is the exception.
- **Subnav widget pattern** — `.v2-mon-live` (Live Status widget) uses chrome tokens: `background: transparent`, `color: var(--chrome-text/-2/-3)`, refresh button `background: var(--accent); color: var(--accent-ink)` (Monitor violet auto from accent var). No border-bottom (was causing double-line with next section).

---

### 5.7 ADMIN

#### PC view

| Component | Class / ID | Notes |
|---|---|---|
| Side rail | `aside.v2-modrail` | **`.v2-modrail` not `.v2-rail`** — chrome.css scopes to admin |
| Sidebar (replaces subnav) | `aside.admin-sidebar#sb-sidebar` | Drawer/sidebar hybrid |
| Mobile module switcher | `.sidebar-modswitch#sb-modswitch` | Mirrors hidden modrail on mobile |
| Sidebar brand | `.sidebar-brand` + `.brand-name`, `.brand-sub`, `#sb-admin-name` | |
| Sidebar groups | `.sidebar-group` + `.sidebar-group-title` | General / Services / Security / Stats / Help |
| Sidebar items | `a.sidebar-item` + `.active` | Nav links |
| Sidebar back | `.sidebar-back` | Back to app |
| Sidebar footer | `.sidebar-footer` | |
| Topbar | `.admin-topbar` | Sticky |
| Topbar burger | `button.burger` | **Burger lives inside topbar** (unlike other modules) |
| Topbar back | `a.topbar-back` | "กลับ" link to index.html |
| Topbar title | `.title` + `#topbar-back-label` | |
| Content area | `.admin-content` | max-width:900 centered, padding:18px 22px 60px |

#### Mobile view

| Component | Class / ID | Notes |
|---|---|---|
| Hamburger | `button.burger` (in topbar) | NOT `.v2-mobile-nav-toggle` |
| Sidebar drawer state | `.admin-sidebar.open` | `transform:translateX(0)` |
| Content mobile pad | `.admin-content { padding:20px 18px 60px }` | |
| Bnav | **NONE** | Admin has no bottom nav |
| FAB | **NONE** | |

#### Notes
- **Admin is the structural exception** — uses `.v2-modrail` + `.admin-sidebar` + `.admin-topbar` + `.burger` (not `.v2-rail` / `.v2-subnav` / standard topbar / `.v2-mobile-nav-toggle`)
- Chrome.css has separate rules block (lines 280-383) for admin

---

## 6. Structural Topbar Fix Patterns

Each module ใช้ pattern ต่างกันให้ topbar ครอบ right col บน PC ≥992 (or ≥1200):

| Module | Pattern | chrome.css lines |
|---|---|---|
| **GPS** | wrap `position:relative` + colheader `position:absolute; top:0; left:0; right:0` + main + rightcol `padding-top:56px` | 403-417 |
| **Fleet** | colheader `position:fixed; left:296px; right:0` + wrapper `padding-top:64px` + rightcol `top:64px` | 424-437 |
| **Transport** | `#dashboard-view > .d-flex.align-items-end` `position:fixed; left:296px; right:0` + dashboard-view `padding-top:64px` + tr-dash-right `top:64px`; v2-form-topbar same treatment | 441-470 |
| **Firstaid** | `.fa-colhead` `position:fixed; left:296px; right:0` + view padding-top:64 + right col top:64 (inline CSS line 318-326) | (inline) |
| **Monitor/Firstaid generic** | Just `z-index:30` defensive bump | 473-476 |

**สูตร (เดียวกันทุก module):** left = rail(56) + subnav(240) = **296** สำหรับ Transport/Firstaid/Monitor/Fleet ที่มี rail+subnav.
*Note: Fleet เคยตั้งผิดเป็น 240 → topbar ทับ subnav 56px (regression, fixed in commit 1e8126d).*

---

## 7. FAB Reference

| Module | Element | Position | z-index |
|---|---|---|---|
| Transport | `.fab-btn` (no id) | `bottom:28px; left:50%; translateX(-50%)` | 1090 |
| Firstaid (list) | `#fa-list-fab` | `bottom:28px; left:50%; translateX(-50%)` | 1090 |
| Firstaid (in-event) | `.fa-fab` | Custom positioning | — |
| Location | `#loc-fab.fab-btn` | `bottom:28px; left:50%; translateX(-50%)` | 1090 |
| GPS / Fleet / Monitor / Admin | **NONE** | — | — |

**Material notch pattern:** FAB 60px, pocket 80px wide. `bottom:28px` = ครึ่งล่าง FAB คร่อม pocket, ครึ่งบนลอยเหนือ bnav. z-index 1090 > bnav 1080.

**Hover preserve translateX:** ต้องเขียน `:hover { transform: translateX(-50%) scale(1.06) !important }` — ไม่งั้น generic `.fab-btn:hover { transform: scale(...) }` จะลบ translateX ทำให้ FAB กระโดดไปทางขวา

---

## 8. Bnav (Bottom Nav) Reference

| Module | ID | Layout | Cells |
|---|---|---|---|
| Transport (dashboard) | `#pt-bnav` | `.pt-bnav.pt-bnav-notch` | 5 cells: `1fr 1fr 80px 1fr 1fr` |
| Transport (form) | `#pt-bnav-form` | `.pt-bnav.pt-bnav-5` | 5 cells flat (no notch) |
| Firstaid (list) | `#fa-bnav-list` | `.pt-bnav.fa-bnav-notch` | 3 cells: `1fr 80px 1fr` |
| Firstaid (detail) | `#fa-bnav-detail` | `.pt-bnav.cols-4` | 4 cells flat |
| Location | `#loc-bnav` | `.pt-bnav` | 5 cells (3-5 visible + 1 pocket) |
| GPS | `#gps-bnav` | `.pt-bnav` | 4 cells |
| Fleet | `#fleet-bnav` | `.pt-bnav` | 4 cells |
| Monitor | `#mon-bnav` | `.pt-bnav` | 4 cells |
| Admin | **NONE** | — | — |

**Pocket pattern:** invisible `<span class="pt-bnav-pocket">` (or `.fa-bnav-pocket` in Firstaid — chrome.css aliases) reserves 80px slot for FAB notch. `visibility:hidden; pointer-events:none`.

**Universal styles (chrome.css):**
- `position:fixed; bottom:0; z-index:1080`
- `height:56px; padding:4px 4px calc(4px + env(safe-area-inset-bottom))`
- `background:var(--chrome-bg-2)` (navy)
- Active tab: `color:var(--accent)` + `::after` underline bar with accent glow

---

## 9. Universal Class Reference

| Class | Purpose | Modules |
|---|---|---|
| `.v2-rail` | 56px left rail (module switcher) | All except Admin (which uses `.v2-modrail`) |
| `.v2-mobile-rail-strip` | Horizontal rail at top of mobile subnav drawer | All |
| `.v2-mobile-nav-toggle` | Hamburger button (mobile) | All except Admin (which uses `.burger` in `.admin-topbar`) |
| `.v2-subnav` | 240px left filter panel | All except Admin (which uses `.admin-sidebar`) |
| `.v2-subnav-header` | Title strip inside subnav | All except Admin |
| `.v2-subnav-section` | Section divider in subnav | All except Admin |
| `.pt-bnav` | Bottom nav | All except Admin |
| `.pt-bnav-pocket` | FAB notch placeholder | Transport, Location |
| `.fa-bnav-pocket` | FAB notch placeholder (alias) | Firstaid |
| `.pt-bnav-notch` | Notch grid variant | Transport |
| `.fa-bnav-notch` | Notch grid variant | Firstaid |
| `.pt-bsheet` | Bottom sheet (slide-up panel) | All with bnav |
| `.pt-bsheet-bd` | Sheet backdrop | All with bnav |
| `.pt-bsheet-handle` | Drag handle | All with bnav |
| `.pt-bsheet-head` | Sheet header | All with bnav |
| `.pt-bsheet-body` | Sheet scrollable body | All with bnav |
| `.fab-btn` | Generic FAB | Transport, Location (`#loc-fab` extends) |
| `.no-print` | Hide on print | Topbars, subnavs, rails, FABs |
| `.dashboard-header` | h3 page title | Most modules (in topbar) |

---

## 10. Known Inconsistencies & Gotchas

1. **Topbar class naming is INCONSISTENT** — chrome.css must catch all variants:
   - `.fa-colhead` (Firstaid)
   - `.v2-colheader` (Fleet)
   - `.v2-gps-colheader` (GPS)
   - `.v2-form-topbar` (Transport form)
   - `.monitor-page-header` (Monitor)
   - `.admin-topbar` (Admin)
   - `.view-section > .d-flex.justify-content-between.align-items-end` (Location + Transport dashboard, **no dedicated class**)

2. **Hamburger breakpoint varies:**
   - Transport / Firstaid / GPS subnav: `≤991px`
   - Location (rail + subnav): `≤767px`
   - Fleet / GPS rail / Monitor rail: `≤767px`
   - Admin: `≤768px` rail, `≤1024px portrait` sidebar drawer

3. **Admin uses different names** — `.v2-modrail`, `.admin-sidebar`, `.admin-topbar`, `.burger` (not standard names). Chrome.css duplicates rules.

4. **Pocket class alias** — `.pt-bnav-pocket` (standard) vs `.fa-bnav-pocket` (Firstaid). chrome.css line 240-244 selects both. Future cleanup: rename Firstaid HTML to use `.pt-bnav-pocket`.

5. **Negative margin trap** — Header negative margins (`margin:0 -18px`) for "edge-to-edge bg" effect MUST match parent padding exactly:
   - Container `padding:18px` → `margin:0 -18px` ✓
   - Container `padding:12px` → `margin:0 -12px` ✓
   - Container `padding:0` → `margin:0` (no negative!)
   - Mismatch causes horizontal scrollbar → bnav lifted from bottom

6. **GPS layout is JS-built** — `.v2-gps-wrap`, `.v2-gps-main`, `.v2-gps-colheader`, `.v2-gps-rightcol` constructed at runtime (transport line 1274-1303). Other modules have static markup.

7. **Bnav breakpoint is uniform** — `@media (max-width:1024px) and (orientation:portrait)` ทั่วทุก module. JS gate `_xxxIsMobilePortrait()` ใช้ matchMedia ตัวเดียวกัน.

8. **Cache busting** — chrome.css ใช้ `?v=YYYYMMDDx` query string. ต้อง bump ทุกครั้งที่แก้ chrome.css หรือ HTML inline CSS. Use PowerShell bulk:
   ```powershell
   $files = @('admin.html','firstaid/index.html','fleet/index.html','gps/index.html','monitor/index.html','transport/index.html')
   foreach ($f in $files) { ... -replace 'v=20260517X','v=20260517Y' ... }
   ```

9. **Transport FAB ใช้ generic class `.fab-btn`** — โดน chrome.css generic `:hover{transform:scale}` ทับ translateX. ต้องเขียน override เฉพาะ Transport ใน inline CSS.

10. **viewport-fit=cover** — Location/Transport/Firstaid ทุก module ต้องมีใน meta viewport เพื่อให้ safe-area-inset-bottom (iOS home indicator) ทำงานถูก:
    ```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    ```

11. **Subnav custom widgets ต้องใช้ chrome tokens** — module-specific widgets ที่ฝังใน `.v2-subnav` (เช่น `.v2-mon-live` ใน Monitor) ห้าม hardcode `background:#fff` หรือสีตายตัว เพราะจะกลายเป็น "block สีขาว" ทับ navy subnav. ใช้:
    - `background: transparent` ให้ navy subnav โผล่
    - `color: var(--chrome-text)` / `var(--chrome-text-2)` / `var(--chrome-text-3)` สำหรับ text
    - **ห้าม border-bottom** — จะชนกับ section border-top ของ section ถัดไป (double-line). ใช้ `padding-bottom: 18px` แทนเพื่อ separation
    - `background: var(--accent); color: var(--accent-ink)` สำหรับ CTA button (จะได้สี module-specific อัตโนมัติ)

12. **Subnav clean-navy pattern — ZERO borders ภายใน subnav** (commit 2d6c4a7 + 9d53e8c):
    - `.v2-subnav-header` → no `border-bottom` (chrome.css set to 0)
    - `.v2-subnav-section` → no `border-top` (chrome.css set to 0, ใช้ margin-top: 12 + padding-top: 10 แทน)
    - `.v2-subnav a` → no `border-bottom` (chrome.css set to 0)
    - `.v2-subnav > div[style*="border-bottom"]` → no `border-bottom` (CTA wrapper)
    - Visual hierarchy แยก section ด้วย: uppercase small caps title (--chrome-text-3 muted) + 22px gap (margin 12 + padding 10)

13. **Inline `style="border-bottom:..."` ต้องลบโดยตรง** — chrome.css `!important` ควรชนะ inline normal style ตาม CSS spec แต่ user เจอ edge case ที่ browser cache/specificity ทำให้ inline ยังโผล่. หา grep `style="[^"]*border-bottom` ในไฟล์ทุก module แล้วลบทิ้งทั้งหมด (Transport line 1180, 1183, 1203 เป็นตัวอย่างที่ลบไปแล้ว).

14. **Cache busting strategy:**
    - **chrome.css changes** → bump `?v=YYYYMMDDx` query string ใน 6 ไฟล์ HTML (firstaid/transport/fleet/gps/monitor/admin). PowerShell bulk:
      ```powershell
      $files = @('admin.html','firstaid/index.html','fleet/index.html','gps/index.html','monitor/index.html','transport/index.html')
      foreach ($f in $files) { ... -replace 'v=YYYYMMDDx','v=YYYYMMDDy' ... }
      ```
      Location ไม่ใช้ chrome.css — ไม่ต้อง bump
    - **Inline HTML/CSS changes only** → ไม่ต้อง bump chrome.css. User ต้อง Ctrl+Shift+R หรือรอ GH Pages 600s TTL
    - **Location inline mirror** — Location มี navy theme inline (mirror ของ chrome.css). แก้ chrome.css ต้อง mirror ใน Location ด้วยเสมอ (e.g., section border-top removal)

15. **ID-specificity beats module-class-specificity in mobile media queries** — module-level inline CSS ใช้ `#timeline-card { margin-bottom:8px !important }` ใน `@media (max-width:767px)` มี specificity `(1,0,0)` ที่ชนะ chrome-style `.v2-form-topbar .v2-tb-timeline { margin:0 !important }` `(0,2,0)`. Fix: เพิ่ม `.v2-form-topbar #timeline-card { margin:0; padding:0 }` ที่ผูกทั้ง ID + class → specificity `(1,1,0)` ชนะ. **Lesson:** เวลาจะ override mobile-specific ID rule, ต้องใช้ ID + ≥1 class.

16. **Inline HTML `style="..."` ที่ chrome.css ไม่จับต้อง override ผ่าน `body[data-module="<name>"]`-scoped rule** — ตัวอย่างจาก session 2026-05-19:
    - Transport `#v2-subnav-case > div[style="background:#f1f5f9"]` → `body[data-module="transport"] #v2-subnav-case > div[style*="background"] { background: var(--chrome-bg-3) }` (matches inline `style*="background"`)
    - Firstaid `.back-link` ที่มี inline `background:#f1f5f9; color:#0369a1` ใน HTML → `body[data-module="firstaid"] .v2-subnav .back-link { background:var(--chrome-bg-3); color:var(--accent) }`
    - **Pattern:** Grep selector ทุก v2/ → ถ้าเจอแค่ module เดียว = scope `body[data-module="X"]` ปลอดภัย. ถ้าเจอหลาย module = chrome.css generic rule
    - **Why happens:** chrome.css ออกแบบมา cover `.v2-subnav a` etc. แต่ subnav children ที่เป็น `<div>` หรือ class เฉพาะ module (`.back-link`, `.event-ctx`) ไม่ match generic rule

17. **Patient banner expand/collapse — info MUST not duplicate between mini-bar + details** (PR #6 + #7):
    - **Collapsed:** `.ban-mini-bar` shows `#ban-mini-name` + `#ban-mini-triage-wrap` + `#ban-consent-card` + chevron (summary row, single line)
    - **Expanded:** `.patient-banner:not(.ban-collapsed)` hides `#ban-mini-name` ONLY (keep triage + consent + chevron in mini-bar) AND hides `.ban-details .col-md-3` (duplicate triage badge in details)
    - **Result:** mini-bar always shows: `[Urgent chip] [✓Consent] [chevron]` (one row). Expanded details add: ALS row, name+age, route, Dx/CC/แพ้/UD (no duplicate Urgent)
    - **Anti-pattern:** Hide ALL mini-bar elements when expanded → chevron disappears, can't collapse

18. **Audit cycle — distinguish "design intent" from "accidental seam":**
    - **Intentional CTA buttons** (designed to stand out): module-specific accent colors are correct. E.g., Monitor `"รีเฟรชทันที"` button = `rgb(196,181,253)` purple-300 on navy = designed CTA, NOT a "white seam".
    - **Intentional themed active states**: e.g., Admin `.sidebar-item.active` = `rgba(253,186,116,0.22)` (orange-300 22% opacity over navy = subtle warm-gray) — themed correctly even though visually distinct.
    - **Actual seams**: hardcoded `background:#fff` or `#f1f5f9` from inline HTML/legacy CSS that chrome.css missed (e.g., Transport case-info wrapper, Firstaid back-link, Mobile `.pt-bnav a .ct` count chips).
    - **Verification rule:** ALWAYS check computed style via JS `getComputedStyle(el).backgroundColor` before flagging. Don't trust screenshot interpretation alone. Per `/buddhist-method` Kalāma + Anatta.

---

## 11. Hard Rules (during ongoing redesign)

1. **Logic byte-identical** — JS hooks, medical interlocks, data flow ห้ามแตะ
2. **Preview-first** — build static mockup ใน `v2/preview/<module>.html`, user รีวิวบน real device, แล้วค่อย apply ของจริง
3. **CSS + wrapper classes only** — ห้าม rename/remove existing `id`, `name`, `onclick`, `class` ที่ JS อ่าน
4. **Breakpoint isolation** — mobile rules ต้องอยู่ใน `@media (max-width:1024px) and (orientation:portrait)`. Desktop/landscape ห้ามแตะ
5. **Medical interlocks immutable** — airway/O2/vent/central-line/arrest logic, vitals lock, triage colors, GCS, NR status flow
6. **Order:** Transport → Firstaid → Location → GPS → Monitor → Fleet → Admin → Dashboard

---

## 12. Tech Stack (brief)

- Hosting: GitHub Pages (auto-deploy from `main`, 600s TTL)
- Database: Supabase PostgreSQL
- Auth: GAS HR API + localStorage session
- Images: Cloudinary unsigned upload (preset `pt-medical`)
- Frontend: HTML + Bootstrap 5 + vanilla JS, single HTML per module
- Maps: Leaflet + OSM + MarkerCluster
- Charts: Chart.js 4.4.0
- Realtime: Supabase Realtime (Transport merge state)
- Notifications: Supabase webhook → CF Worker `/notify/check` → Line OA / Telegram
- Workers: Cloudflare (`line-oa-hub`, notify, speed-watcher)

---

## 13. File Conventions

- Single HTML per module (CSS + HTML + JS all inline in one file)
- Shared helpers: `v2/shared.js`, `v2/shared.css`, `shared/config.js`, `shared/auth.js`, etc.
- Backup rule: GAS editor edits MUST mirror to local folder
- PowerShell Thai gotcha: use `[IO.File]::ReadAllText($p, UTF8)` (Get-Content -Raw mangles via Win-874)
- Commit message: include why, not just what; Co-Authored-By Claude

---

## 14. Transport Patient Banner — Collapsed/Expanded Pattern

The patient banner (`#patient-summary-banner.patient-banner.v2-tb-row2`) is the most-used Transport widget. State pattern documented here because it's been through 4 redesigns.

### DOM structure

```html
<div id="patient-summary-banner" class="patient-banner v2-tb-row2 ban-collapsed">
  <!-- Always visible mini-bar -->
  <div class="ban-mini-bar" onclick="togglePatientBanner(event)">
    <span class="ban-mini-name fw-bold text-dark"><span id="ban-mini-name">-</span></span>
    <span id="ban-mini-triage-wrap" class="badge ban-mini-triage"><span id="ban-mini-triage">-</span></span>
    <span id="ban-consent-card" class="ban-consent-tag">
      <i class="bi bi-file-earmark-check"></i>
      <span id="ban-consent-text">รอลงนาม</span>
    </span>
    <button class="ban-toggle-btn ms-auto"><i class="bi bi-chevron-down"></i></button>
  </div>

  <!-- Toggle-able details -->
  <div class="ban-details">
    <!-- Row 1: ALS chip | รถเบอร์: ... | พีรพัฒน์... -->
    <div class="row text-sm border-bottom pb-2">
      <div class="col-12 text-primary d-flex align-items-center gap-2">
        <span class="badge"><i class="bi bi-car-front-fill"></i> <span id="ban-op-level">-</span></span>
        <span class="fw-medium text-dark">รถเบอร์: <span id="ban-op-no">-</span></span>
        <span class="text-muted mx-1">|</span>
        <span id="ban-staff-list" class="text-secondary small">-</span>
      </div>
    </div>
    <!-- Row 2: name+age | triage | route -->
    <div class="row align-items-center">
      <div class="col-md-5"><span id="ban-name">-</span> (<span id="ban-age">-</span>)</div>
      <div class="col-md-3"><span class="badge bg-danger-subtle"><span id="ban-triage">-</span></span></div>
      <div class="col-md-4 text-md-end"><span id="ban-route">-</span></div>
      <!-- Row 3: Dx/CC/แพ้/UD -->
      <div class="col-12 mt-2 pt-2 border-top">
        <span class="badge bg-light">Dx: <span id="ban-dx">-</span></span>
        <span class="badge bg-light">CC: <span id="ban-cc">-</span></span>
        <span class="badge bg-danger-subtle">แพ้: <span id="ban-allergy">-</span></span>
        <span class="badge bg-info-subtle">UD: <span id="ban-ud">-</span></span>
      </div>
    </div>
  </div>
</div>
```

### Visibility rules (CSS-only — no JS dependency)

```css
/* Collapsed: hide details, show mini-bar in full */
.patient-banner.ban-collapsed .ban-details { display: none; }

/* Expanded: hide redundant info from mini-bar */
.patient-banner:not(.ban-collapsed) #ban-mini-name { display: none !important; }
.patient-banner:not(.ban-collapsed) .ban-details .row.align-items-center > .col-md-3 { display: none !important; }
/* Note: do NOT hide #ban-mini-triage-wrap or #ban-consent-card — those stay in mini-bar always */
```

### Result by state

| State | Mini-bar shows | Details shows |
|---|---|---|
| **Collapsed** (default mobile) | name + triage + consent + ▼ | hidden |
| **Expanded** | triage + consent + ▲ (NO name) | ALS row, name+age, route, Dx/CC/แพ้/UD (NO triage) |

### Sizing rules

- **`#ban-op-no`** ("รถเบอร์: คันที่ 1 (ALS)") font-size = `0.78rem` (~12.5px) to match badge neighbors (~11-14px). Without override it inherits body 16px → looks oversized
- **`#ban-staff-list`** `pb-1` REMOVED via chrome.css override (`padding-bottom: 0`) — was creating ~4px baseline offset vs ALS chip
- **`.text-muted.mx-1`** separator `|` font-size = `0.78rem` (was inheriting body 16px → too big)
- **ALS row line-heights normalized:** `.col-12.text-primary { line-height:1.5 }`, `.badge { line-height:1.4 }` → all items sit on same baseline (diff ~0.2px measured)

### Mobile-specific rules (≤767px)

```css
@media (max-width: 767px) {
  /* Timeline-card OUTSIDE topbar (defensive, legacy): keep 8px margin */
  #timeline-card:not(.v2-tb-timeline) { margin-bottom: 8px !important; }
  /* Timeline-card INSIDE topbar: flush */
  .v2-form-topbar #timeline-card { margin: 0 !important; padding: 0 !important; }
}
```

The class `.v2-tb-timeline` is added by `reparentTimelineAndBanner()` JS at runtime, so the `:not(.v2-tb-timeline)` selector is the "outside topbar" branch.

### Anti-patterns

- ❌ Hide ALL mini-bar children when expanded → chevron disappears, can't collapse
- ❌ Hide `#ban-name` in details when expanded → `( age )` left dangling without name
- ❌ Hide whole `.ban-mini-bar` → need to move toggle to details (HTML change required)
- ✅ Hide ONLY `#ban-mini-name` + duplicate `.col-md-3` triage → 1 source of truth per data point
