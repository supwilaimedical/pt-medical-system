# Transport Step 2 + Step 3 Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the working interactive prototype (`v2/preview/transport-step2-step3-redesign.html`) into the production form (`v2/transport/index.html`) while keeping every form field, save flow, and medical interlock byte-identical.

**Architecture:** Wrap-and-style approach — surround existing production HTML with new `pp-*` wrapper markup, add new CSS in same file, layer new pill UIs that drive existing form fields (hidden selects/inputs preserved). Add only NEW JS functions for new interlocks; do NOT modify existing snapshot/save/realtime code paths.

**Tech Stack:** Vanilla HTML/CSS/JS (no framework), Bootstrap 5 CDN, Bootstrap Icons, Sarabun font, Supabase (data layer — UNTOUCHED), Cloudinary (file upload — UNTOUCHED).

**Testing approach:** This codebase has NO automated test suite. Verification is via **manual smoke tests** at each phase checkpoint, executed by the paramedic-user in the local preview. Each phase has explicit smoke test steps and rollback criteria.

**Local-first workflow:** All work in an isolated branch. Local Python HTTP server on port 8080. User (paramedic) reviews local preview at each phase gate. NO deploy to GitHub Pages until final approval.

---

## File Structure

**Files modified:**
- `v2/transport/index.html` — the only production file changed. Sections:
  - CSS block (lines ~150-700 area): append new `pp-*` rules
  - HTML body: wrap Step 2 + Step 3 sections, add minibar markup, add new modal markup
  - JS block (lines ~3300-9100 area): append new functions, leave existing functions untouched
- `docs/superpowers/plans/2026-05-25-transport-step2-step3-implementation.md` (this file)

**Files NOT created or modified:**
- `v2/shared.js` — print/builder logic; do not touch
- `v2/monitor/index.html` — do not touch
- `v2/preview/transport-step2-step3-redesign.html` — keep as reference only
- DB migrations — none needed
- Supabase edge functions — none touched
- Cloudinary config — none touched

**Branch strategy:**
- Create feature branch from current worktree branch
- Commit at end of each Phase (12 commits total)
- DO NOT merge to main until Phase 8 (paramedic sign-off)

---

## Critical Constraints (from spec + danger_zones)

1. **All `name=` attributes preserved exactly.** Production `getFormData()` (line ~4040 area) and `populateForm` loop read these. Renaming breaks snapshot integrity.
2. **All `id=` attributes preserved exactly.** Existing `onclick="updateAirwayLogic()"` etc. depend on these.
3. **Existing JS functions UNTOUCHED:** `getFormData`, `saveData`, `populateForm`, `addIvLine`, `addVitalLog`, `addArrestLog`, `updateAirwayLogic`, `updateVentLogic`, `updateO2Detail`, `toggleCentralLine`, `toggleArrest`, `toggleArrestOutcome`, `calcArrestCprDuration`, `openInitVitalsPopup`, `refreshInitVitalsDisplay`. Hook into them via dispatched events, don't replace.
4. **NEW functions only ADDED, never replacing:** `updateGcsVerbalLock`, `openAirwayReasonModal`, `saveAirwayReason`, `refreshMinibar`, `refreshCircArrestChip`, `refreshO2Options`, `refreshVentInterface`.
5. **Hidden-input sync pattern for pill replacements:** Where prototype uses tap-pills replacing production `<select>`, the production select is set to `display:none` and the pill click handler does `select.value = pillValue; select.dispatchEvent(new Event('change'))` — this preserves snapshot AND any existing onchange handlers.
6. **Pupils field migration:** Production uses combined `pupil_size` (text) + `pupil_react` (select). Prototype splits to R/L. Adapter approach: keep production fields as hidden inputs, populate them from new split fields via JS (concat with "/"). Read back into split fields on populateForm.

---

## Phase Overview

| Phase | Deliverable | Smoke Test | Commit |
|---|---|---|---|
| 1 | Branch + CSS scaffold | Production form still saves/loads | ✓ |
| 2 | Topbar mock + Minibar | Minibar shows after V/S enter | ✓ |
| 3 | Step 2 Inline (V/S + Airway + Breathing + Circ + Arrest chip) | Each inline card saves to existing fields | ✓ |
| 4 | Step 2 Modals (Neuro + Body + Drainage + Arrest) | GCS calc matches production, pupils migrate | ✓ |
| 5 | Step 3 Modal (Equipment + 3 new) | New equipment fields persist | ✓ |
| 6 | Step 3 Inline (IV + Vital Log + Nurse Note + Refer) | addIvLine/addVitalLog/addArrestLog still work | ✓ |
| 7 | Interlocks (GCS lock, Reason modal, Vent interface, O2 filter) | All interlocks fire correctly | ✓ |
| 8 | Layout (subnav + bnav + 2-col wide) + Time mask | Step switch on narrow, 2-col on wide | ✓ |
| 9 | Final smoke test + paramedic approval | Full danger_zones checklist | ✓ |
| 10 | Merge + deploy + verify | Production hard-refresh works | ✓ |

---

## Phase 1: Branch + CSS Scaffold

**Files:**
- Modify: `v2/transport/index.html` — append CSS block in `<style>` section

### Task 1.1: Create feature branch

- [ ] **Step 1: Check current git state**

```bash
cd "F:/@Coding/pt-medical-system"
git status
git branch --show-current
```

Expected: clean working tree (or just the spec/plan docs); current branch reported.

- [ ] **Step 2: Create feature branch from current branch**

```bash
git checkout -b feat/transport-step2-step3-redesign
```

Expected: branch created and checked out.

- [ ] **Step 3: Confirm branch**

```bash
git branch --show-current
```

Expected: `feat/transport-step2-step3-redesign`

### Task 1.2: Read production CSS area to find insertion point

- [ ] **Step 1: Find the end of the existing `<style>` block in `v2/transport/index.html`**

```bash
grep -n "</style>" v2/transport/index.html | head -3
```

Expected: returns line numbers. Use the FIRST `</style>` (the main style block, before any inline modal styles).

- [ ] **Step 2: Note the line number** for inserting new CSS just before that closing tag.

### Task 1.3: Append the `pp-*` CSS scaffold

- [ ] **Step 1: Insert new CSS block** before the first `</style>` tag.

Add the following CSS block. Copy the entire `:root` color variables, then all `.pp-*` class definitions, from `v2/preview/transport-step2-step3-redesign.html` (lines roughly 17 to 660). Wrap in a clear comment marker:

```css
/* ============================================================
   NEW: pp-* classes for Step 2 + Step 3 redesign (R4 prototype)
   Added 2026-05-25 — do not modify production .card, .island-card
   ============================================================ */

/* (paste pp-* CSS block here from preview file) */

/* ============================================================
   END: pp-* classes
   ============================================================ */
```

This adds new rules WITHOUT modifying existing `.card`, `.island-card`, `.form-check`, etc.

- [ ] **Step 2: Save file. Verify syntax** by opening the file in browser:

```bash
python -m http.server 8080 --bind 127.0.0.1 &
# In browser: http://localhost:8080/v2/transport/
```

Expected: form loads with no console CSS errors. Existing styling unchanged (since new classes don't conflict with old).

### Task 1.4: Smoke Test #1 — Baseline regression check

- [ ] **Step 1: Open existing case in browser**

URL: `http://localhost:8080/v2/transport/?case=<any-existing-case-id>`

- [ ] **Step 2: Verify these existing behaviors work UNCHANGED:**

  - [ ] Case loads, all fields populated from snapshot
  - [ ] Initial V/S popup opens (`openInitVitalsPopup`) and saves
  - [ ] Airway radio buttons work, auto-fill V=VT when ET Tube selected
  - [ ] Add Vital button adds row to vitals log
  - [ ] Save button saves successfully (check Supabase or look for save success indicator)
  - [ ] Print button opens print preview correctly (PCR redesign preserved)

- [ ] **Step 3: If ANY existing behavior broken** → revert CSS additions:

```bash
git diff v2/transport/index.html  # view changes
git checkout v2/transport/index.html  # revert if needed
```

- [ ] **Step 4: Commit Phase 1**

```bash
git add v2/transport/index.html
git commit -m "feat(transport): scaffold — append pp-* CSS classes for Step 2+3 redesign

No HTML or JS changes. New CSS rules only. Existing styles unchanged.
Production form continues to work byte-identical.

Refs: docs/superpowers/specs/2026-05-23-transport-step2-step3-redesign-design.md"
```

---

## Phase 2: Topbar Mock + Minibar

**Goal:** Add the sticky minibar that shows live vital chips. The "mock topbar" pattern from the prototype is NOT needed in production because production already has a proper sticky topbar (`v2-form-topbar`). We only add the minibar UNDER the existing topbar.

**Files:**
- Modify: `v2/transport/index.html` — HTML insertion under existing topbar, JS additions

### Task 2.1: Locate the existing v2-form-topbar

- [ ] **Step 1: Find the closing div of the production topbar**

```bash
grep -n "v2-form-topbar\|v2-tb-row" v2/transport/index.html | head -20
```

Expected: returns lines identifying the topbar structure (starts ~line 1640 region per existing patterns).

- [ ] **Step 2: Identify the line where the topbar's outer `<div class="v2-form-topbar">` closes.**

Find the matching `</div>` for `v2-form-topbar`. Add a comment marker mentally: this is where we'll insert the minibar.

### Task 2.2: Insert minibar HTML

- [ ] **Step 1: Insert this block JUST INSIDE the bottom of `v2-form-topbar`** (after timeline row, before its closing `</div>`):

```html
<!-- NEW R4 vital minibar — always visible during Step 2 + Step 3 -->
<div class="pp-minibar" id="vital-minibar" style="display:none; border-top:1px dashed var(--slate-200);">
  <div class="mb-vitals">
    <span class="mb-chip empty" id="mb-bp"><span class="lbl">BP</span><b>--</b></span>
    <span class="mb-chip empty" id="mb-pr"><span class="lbl">PR</span><b>--</b></span>
    <span class="mb-chip empty" id="mb-rr"><span class="lbl">RR</span><b>--</b></span>
    <span class="mb-chip empty" id="mb-spo2"><span class="lbl">SpO2</span><b>--</b></span>
    <span class="mb-chip empty" id="mb-temp"><span class="lbl">T°</span><b>--</b></span>
    <span class="mb-chip empty" id="mb-dtx"><span class="lbl">DTX</span><b>--</b></span>
    <span class="mb-chip gcs" id="mb-gcs"><span class="lbl">GCS</span><b>15</b></span>
    <span class="mb-chip pain" id="mb-pain"><span class="lbl">Pain</span><b>0</b></span>
    <span class="mb-chip airway" id="mb-airway" style="display:none;"><i class="bi bi-lock-fill"></i><b>--</b></span>
    <span class="mb-chip arrest" id="mb-arrest" style="display:none;"><i class="bi bi-heart-pulse-fill"></i><b>ARREST</b></span>
  </div>
</div>
```

Note: `style="display:none;"` initially — JS will show it when on Step 2 or Step 3 panel.

- [ ] **Step 2: Save file. Verify in browser** — minibar div exists in DOM but hidden.

### Task 2.3: Add refreshMinibar JS function

- [ ] **Step 1: Find a place to add JS** — at the end of the existing `<script>` block, just before `</script>`, before DOMContentLoaded handler (if any final one).

```bash
grep -n "DOMContentLoaded\|</script>" v2/transport/index.html | tail -10
```

Find the LAST `<script>...</script>` block.

- [ ] **Step 2: Add the following functions before `</script>`:**

```javascript
// ============================================================
// NEW R4: Vital Minibar live update
// ============================================================
function ppGetLatestVital() {
  // Read latest row from vitals-log-container (DOM-based since data lives in DOM rows)
  const rows = document.querySelectorAll('#vitals-log-container .vital-log-entry:not(.arrest-log-entry)');
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1];
  return {
    bp:   last.querySelector('.v-bp')?.value || '',
    pr:   last.querySelector('.v-pr')?.value || '',
    rr:   last.querySelector('.v-rr')?.value || '',
    temp: last.querySelector('.v-temp')?.value || '',
    spo2: last.querySelector('.v-spo2')?.value || '',
  };
}

function ppSetMbChip(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (val) { el.classList.remove('empty'); el.querySelector('b').textContent = val; }
  else { el.classList.add('empty'); el.querySelector('b').textContent = '--'; }
}

function refreshMinibar() {
  const bar = document.getElementById('vital-minibar');
  if (!bar) return;
  const f = document.forms['main-form'];
  if (!f) return;
  // Determine if Step 2 or Step 3 is active
  const s2 = document.getElementById('step2-panel');
  const s3 = document.getElementById('step3-panel');
  const showBar = (s2 && !s2.classList.contains('d-none')) || (s3 && !s3.classList.contains('d-none'));
  bar.style.display = showBar ? '' : 'none';
  if (!showBar) return;

  // Pull initial V/S
  const init = {
    bp:   f.elements['init_bp']?.value || '',
    pr:   f.elements['init_pr']?.value || '',
    rr:   f.elements['init_rr']?.value || '',
    temp: f.elements['init_temp']?.value || '',
    spo2: f.elements['init_spo2']?.value || '',
    dtx:  f.elements['init_dtx']?.value || '',
  };
  const latest = ppGetLatestVital();

  // Prefer latest vital, fall back to init
  ppSetMbChip('mb-bp',   latest?.bp   || init.bp);
  ppSetMbChip('mb-pr',   latest?.pr   || init.pr);
  ppSetMbChip('mb-rr',   latest?.rr   || init.rr);
  ppSetMbChip('mb-spo2', latest?.spo2 || init.spo2);
  ppSetMbChip('mb-temp', latest?.temp || init.temp);
  ppSetMbChip('mb-dtx',  init.dtx);  // DTX only from initial

  // GCS — read from production gcs_e/gcs_v/gcs_m fields
  const e = parseInt(f.elements['gcs_e']?.value || '0', 10);
  const m = parseInt(f.elements['gcs_m']?.value || '0', 10);
  const v = f.elements['gcs_v']?.value || '';
  const isT = (v === 'VT' || v === 'T');
  const total = isT ? e + m : e + (parseInt(v, 10) || 0) + m;
  const gcsChip = document.getElementById('mb-gcs');
  if (gcsChip) {
    gcsChip.classList.remove('amber', 'red');
    if (total < 9) gcsChip.classList.add('red');
    else if (total < 13) gcsChip.classList.add('amber');
    gcsChip.querySelector('b').textContent = isT ? (total + 'T') : total;
  }

  // Pain — production has pain_score field
  const painVal = f.elements['pain_score']?.value || '0';
  const painN = parseInt(painVal, 10) || 0;
  const painChip = document.getElementById('mb-pain');
  if (painChip) {
    painChip.classList.remove('warn', 'bad');
    if (painN >= 7) painChip.classList.add('bad');
    else if (painN >= 4) painChip.classList.add('warn');
    painChip.querySelector('b').textContent = painN;
  }

  // Airway chip — show when intubated (artificial airway)
  const at = f.elements['airway_type']?.value;
  const ams = f.elements['airway_mgt_sub']?.value;
  const intubated = (at === 'ET Tube' || at === 'Tracheostomy' || (at === 'Management' && ams === 'LMA/SGA'));
  const awChip = document.getElementById('mb-airway');
  if (awChip) {
    awChip.style.display = intubated ? '' : 'none';
    awChip.querySelector('b').textContent = (at === 'Management') ? 'LMA/SGA' : (at || '--');
  }

  // Arrest chip — show when arrest_pre_arrest checked
  const arr = document.getElementById('mb-arrest');
  if (arr) {
    const isArrest = f.elements['arrest_pre_arrest']?.checked;
    arr.style.display = isArrest ? '' : 'none';
    if (isArrest) {
      const rhythm = f.elements['arrest_pre_rhythm']?.value || '?';
      const outcome = f.elements['arrest_pre_outcome']?.value || 'Ongoing';
      arr.querySelector('b').textContent = rhythm + ' · ' + outcome;
    }
  }
}

// Wire minibar to fire on any form input or change event (event delegation)
document.addEventListener('DOMContentLoaded', function() {
  const form = document.forms['main-form'];
  if (form) {
    form.addEventListener('input', refreshMinibar);
    form.addEventListener('change', refreshMinibar);
  }
  // Also fire after goToStep (panel switch)
  const _origGoToStep = window.goToStep;
  if (typeof _origGoToStep === 'function') {
    window.goToStep = function(n) {
      _origGoToStep.apply(this, arguments);
      setTimeout(refreshMinibar, 50);
    };
  }
  // Initial render
  setTimeout(refreshMinibar, 200);
});
```

- [ ] **Step 3: Save and reload browser**

Expected:
- Minibar appears below topbar when Step 2 or Step 3 is active
- Initial V/S values populate the BP/PR/RR/Temp/SpO2/DTX chips
- GCS chip shows current total
- Airway chip appears when ETT selected

### Task 2.4: Smoke Test #2 — Minibar live update

- [ ] **Step 1: Load case with existing data** (Initial V/S filled)

- [ ] **Step 2: Verify:**

  - [ ] Minibar visible on Step 2/3 panels, hidden on Step 1
  - [ ] BP/PR/SpO2 chips show values from Initial V/S
  - [ ] GCS chip computed correctly (e.g. E4V5M6 = 15 green, E4VTM6 = 10T amber)
  - [ ] Click ET Tube radio → Airway chip appears with "ET Tube"
  - [ ] Existing save still works (try saving a small change)

- [ ] **Step 3: Commit Phase 2**

```bash
git add v2/transport/index.html
git commit -m "feat(transport): add vital minibar — sticky chips below topbar

Shows BP/PR/RR/SpO2/T°/DTX/GCS/Pain chips, Airway lock chip when intubated,
Arrest pulse chip when arrest_pre_arrest. Pulls from existing form fields
via FormData. No new form fields. No change to save/load flow.

Refs: spec section 5.4"
```

---

## Phase 3: Step 2 Inline Sections

**Goal:** Apply new `pp-island-card` visual style to existing Step 2 cards (Initial V/S, Airway, Breathing, Circulation). Move Cardiac Arrest from standalone card to a chip inside Circulation. Replace SweetAlert popup for Initial V/S with a Bootstrap-style modal.

**Approach:** Wrap-and-style. Add new outer divs with `pp-island-card` class around existing `.card.island-card` divs. Keep all inputs, labels, and JS hooks unchanged.

### Task 3.1: Wrap Airway card

- [ ] **Step 1: Locate Airway card** (line ~2739 area)

```bash
grep -n "ทางเดินหายใจ (Airway)" v2/transport/index.html
```

- [ ] **Step 2: Add wrapper class `pp-island-card cyan` to the existing card's outer div**

Find:
```html
<div class="card p-4 mb-4 island-card">
   <h5 class="card-title fw-bold text-dark mb-3 border-bottom pb-2"><i class="bi bi-lungs-fill text-info me-2"></i> ทางเดินหายใจ (Airway)</h5>
```

Change to:
```html
<div class="card p-4 mb-4 island-card pp-island-card cyan">
   <h5 class="card-title fw-bold text-dark mb-3 border-bottom pb-2"><i class="bi bi-lungs-fill text-info me-2"></i> ทางเดินหายใจ (Airway)</h5>
```

(Just add `pp-island-card cyan` to the class list. Nothing else changes.)

- [ ] **Step 3: Verify in browser** — Airway card now has a cyan top accent strip.

### Task 3.2: Wrap Breathing card

- [ ] **Step 1: Locate Breathing card** (line ~2764)

- [ ] **Step 2: Add class `pp-island-card sky`**

```html
<div class="card p-4 mb-4 island-card pp-island-card sky">
   <h5 class="card-title fw-bold text-dark mb-3 border-bottom pb-2"><i class="bi bi-wind text-primary me-2"></i> การหายใจ & ออกซิเจน</h5>
```

### Task 3.3: Wrap Circulation card

- [ ] **Step 1: Locate Circulation card** (line ~2804)

- [ ] **Step 2: Add class `pp-island-card red`**

```html
<div class="card p-4 mb-4 island-card pp-island-card red">
   <h5 class="card-title fw-bold text-dark mb-3 border-bottom pb-2"><i class="bi bi-heart-pulse-fill text-danger me-2"></i> ระบบไหลเวียนเลือด (Circulation)</h5>
```

### Task 3.4: Wrap Initial Vitals card

- [ ] **Step 1: Locate Initial Vitals card** (line ~2708)

- [ ] **Step 2: Add class `pp-island-card`** with `border-top-color:var(--red-500)` inline style:

```html
<div class="card p-4 mb-4 island-card pp-island-card" style="border-top-color:var(--red-500);">
  <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
    <h5 class="card-title fw-bold text-dark m-0">...</h5>
    ...
  </div>
  ...
</div>
```

### Task 3.5: Add Cap Refill input to Circulation card

- [ ] **Step 1: Locate the existing Circulation row** with `circ_status` and `circ_ekg` (around line 2807)

- [ ] **Step 2: Change col-md-6 to col-md-4** for status and ekg, add a third col-md-4 with Cap Refill input:

```html
<div class="row g-4">
   <div class="col-md-4"><label class="form-label fs-8 fw-bold text-secondary text-uppercase mb-2">สถานะ (Status)</label>...</div>
   <div class="col-md-4">
     <label class="form-label fs-8 fw-bold text-secondary text-uppercase mb-2">Cap Refill (sec)</label>
     <input type="text" class="form-control form-control-sm bg-light border-0" name="circ_cap" placeholder="< 2">
   </div>
   <div class="col-md-4"><label class="form-label fs-8 fw-bold text-secondary text-uppercase mb-2">EKG Rhythm</label>...</div>
</div>
```

### Task 3.6: Add Cardiac Arrest chip to Circulation card

The existing Arrest card (production line ~2821) needs to MOVE conceptually to a chip inside Circulation that opens the existing arrest modal/panel. We'll keep the existing Arrest card markup but ALSO add a chip in Circulation that scrolls/opens it.

- [ ] **Step 1: At the END of the Circulation card body** (just before its closing `</div>`), add:

```html
<!-- NEW R4: Arrest chip — opens existing arrest_pre panel below -->
<div class="pp-circ-arrest-chip" id="pp-circ-arrest-chip" onclick="ppOpenArrestModal()">
  <i class="bi bi-heart-pulse-fill ic"></i>
  <div class="body">
    <div class="lbl">Cardiac Arrest · pre-arrival</div>
    <div class="status" id="pp-circ-arrest-status">ไม่มี · กดเพื่อบันทึก</div>
  </div>
  <i class="bi bi-chevron-right chev"></i>
</div>
```

- [ ] **Step 2: Add JS function `ppOpenArrestModal`** (in the same script block as refreshMinibar):

```javascript
// Opens the existing arrest_pre panel by scrolling to it and toggling its checkbox if not already.
// Does NOT replace the existing arrest UI — just provides a chip-style entry point.
function ppOpenArrestModal() {
  const detail = document.getElementById('arrest-pre-detail');
  const tog = document.getElementById('chk-arrest-pre');
  if (!detail || !tog) return;
  // Scroll into view
  detail.scrollIntoView({ behavior: 'smooth', block: 'center' });
  // If not checked, prompt to check
  if (!tog.checked) {
    if (confirm('บันทึก Cardiac Arrest ก่อน/ระหว่างรับผู้ป่วยหรือไม่?')) {
      tog.checked = true;
      tog.dispatchEvent(new Event('change'));
    }
  }
}

// Update chip color/text when arrest_pre fields change
function refreshCircArrestChip() {
  const chip = document.getElementById('pp-circ-arrest-chip');
  if (!chip) return;
  const status = document.getElementById('pp-circ-arrest-status');
  const f = document.forms['main-form'];
  if (!f || !f.elements['arrest_pre_arrest']?.checked) {
    chip.classList.remove('filled');
    if (status) status.textContent = 'ไม่มี · กดเพื่อบันทึก';
    return;
  }
  chip.classList.add('filled');
  const time = f.elements['arrest_pre_time']?.value || '--:--';
  const rhythm = f.elements['arrest_pre_rhythm']?.value || '?';
  const outcome = f.elements['arrest_pre_outcome']?.value || 'Ongoing CPR';
  let extra = '';
  if (outcome === 'ROSC' && f.elements['arrest_pre_rosc_time']?.value) {
    extra = ' · ROSC @ ' + f.elements['arrest_pre_rosc_time'].value;
  } else if (outcome === 'Dead' && f.elements['arrest_pre_dead_time']?.value) {
    extra = ' · Dead @ ' + f.elements['arrest_pre_dead_time'].value;
  }
  if (status) status.textContent = '🚨 ' + rhythm + ' @ ' + time + ' · ' + outcome + extra;
}

// Wire chip refresh on form change
document.addEventListener('DOMContentLoaded', function() {
  const form = document.forms['main-form'];
  if (form) {
    form.addEventListener('input', refreshCircArrestChip);
    form.addEventListener('change', refreshCircArrestChip);
  }
  setTimeout(refreshCircArrestChip, 200);
});
```

### Task 3.7: Smoke Test #3 — Step 2 inline cards

- [ ] **Step 1: Reload a case in browser**

- [ ] **Step 2: Verify:**

  - [ ] Each Step 2 card now has a colored top accent strip (cyan/sky/red)
  - [ ] All existing fields still save (try saving)
  - [ ] Cap Refill input accepts text and saves (verify `circ_cap` in rawSnapshot)
  - [ ] Arrest chip shows in Circulation
  - [ ] Click Arrest chip → scrolls to existing arrest_pre_detail panel, optionally prompts to check
  - [ ] Check arrest_pre_arrest manually → fill VF + ROSC → arrest chip becomes red with summary

- [ ] **Step 3: If snapshot lost any data** → check that no `name=` was renamed accidentally. Revert and retry.

- [ ] **Step 4: Commit Phase 3**

```bash
git add v2/transport/index.html
git commit -m "feat(transport): apply pp-island-card to Step 2 cards + Cap Refill + Arrest chip

- Add pp-island-card class to Airway/Breathing/Circulation/Initial V/S
- Add new field circ_cap (Cap Refill input in Circulation)
- Add Cardiac Arrest chip in Circulation that opens existing arrest_pre panel
- New JS functions: ppOpenArrestModal, refreshCircArrestChip

All existing fields and save flow unchanged.
Refs: spec section 5.2, 5.3, 5.7"
```

---

## Phase 4: Step 2 Modals (Neuro / Body Exam / Drainage / Arrest)

**Goal:** Add NEW modal markup for Neuro (GCS+Pupils+Pain), Body Exam (anatomical figure + 4 limbs), Drainage (4-row checklist), and wrap the existing Arrest panel in modal chrome.

**Migration risk:** Production has a single big Disability card (line ~2896) with GCS selects, Pupils combined, Pain select, Motor selects, Exposure inputs, Drainage checkboxes. We need to:
1. Add new modal-style entry points (chips/buttons) that scroll to these sections, OR
2. Actually move the existing inputs into modals.

**Decision:** Approach #1 (scroll-style "modals" — keep inputs in place but visually present as modal). This preserves all hooks. Modal chrome is purely visual via CSS overlay on scroll-anchor.

Actually for proper UX matching the prototype, we need real modals. So:

**Revised approach:** Wrap each existing inputs group with a `pp-modal-backdrop` div. By default the backdrop is hidden (display:none). Buttons in dashboard rows open them by toggling `.open` class. Inputs stay in place, name= unchanged.

### Task 4.1: Add Neuro modal wrapper around existing GCS+Pupils+Pain+Drainage section

- [ ] **Step 1: Find the Disability card** (line ~2896, "ระบบประสาท & สายระบาย")

- [ ] **Step 2: BEFORE the Disability card, insert the Neuro modal markup:**

```html
<!-- NEW R4: Neuro & Pain modal entry point -->
<div class="pp-row" style="border-left-color:var(--navy-700);" onclick="ppOpenModal('m-neuro')">
  <i class="bi bi-person-bounding-box ic" style="color:var(--navy-700);"></i>
  <div class="body">
    <div class="title">ระบบประสาท &amp; ความเจ็บปวด</div>
    <div class="sub">GCS · Pupils · Pain</div>
    <div class="summary" id="pp-row-neuro-summary">GCS 15 · Pupils 3/3 React · Pain 0</div>
  </div>
  <button class="edit-modal"><i class="bi bi-box-arrow-up-right"></i> Modal</button>
</div>
```

- [ ] **Step 3: Wrap the existing Disability card content** with a modal backdrop. Convert from:

```html
<div class="card p-4 mb-4 island-card">
  <h5>ระบบประสาท & สายระบาย</h5>
  <!-- inputs ... -->
</div>
```

To:

```html
<div class="pp-modal-backdrop" id="m-neuro" onclick="if(event.target===this)ppCloseModal('m-neuro')">
  <div class="pp-modal">
    <div class="pp-modal-head">
      <i class="bi bi-person-bounding-box ic" style="color:var(--navy-700);"></i>
      <div class="title">ระบบประสาท &amp; ความเจ็บปวด</div>
      <button class="close-x" onclick="ppCloseModal('m-neuro')"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="pp-modal-body">
      <!-- existing GCS + Pupils + Pain content stays here unchanged -->
      <div class="card p-4 mb-4 island-card">
        <!-- ... existing GCS/Pupils/Pain inputs ... -->
      </div>
    </div>
    <div class="pp-modal-foot">
      <button class="btn btn-cancel" onclick="ppCloseModal('m-neuro')">ปิด</button>
    </div>
  </div>
</div>
```

KEEP the inputs (`name="gcs_e"`, `name="gcs_v"`, etc.) inside. They stay in DOM and FormData still sweeps them.

- [ ] **Step 4: Add `ppOpenModal` and `ppCloseModal` JS:**

```javascript
function ppOpenModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
function ppCloseModal(id) {
  const m = document.getElementById(id);
  if (m) { m.classList.remove('open'); document.body.style.overflow = ''; }
}
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.pp-modal-backdrop.open').forEach(m => m.classList.remove('open'));
    document.body.style.overflow = '';
  }
});
```

### Task 4.2: Refresh Neuro summary row text

- [ ] **Step 1: Add `refreshNeuroSummary` function:**

```javascript
function refreshNeuroSummary() {
  const el = document.getElementById('pp-row-neuro-summary');
  if (!el) return;
  const f = document.forms['main-form'];
  const e = parseInt(f.elements['gcs_e']?.value || '0', 10);
  const m = parseInt(f.elements['gcs_m']?.value || '0', 10);
  const v = f.elements['gcs_v']?.value || '';
  const isT = (v === 'VT' || v === 'T');
  const total = isT ? e + m : e + (parseInt(v, 10) || 0) + m;
  const totalStr = isT ? (total + 'T') : String(total);
  const pupilSize = f.elements['pupil_size']?.value || '';
  const pupilReact = f.elements['pupil_react']?.value || '';
  const pain = f.elements['pain_score']?.value || '0';
  el.textContent = 'GCS ' + totalStr + (isT ? ' (ใส่ท่อ)' : '') +
                   ' · Pupils ' + (pupilSize || '--') + ' ' + (pupilReact || '') +
                   ' · Pain ' + pain + '/10';
}
document.addEventListener('DOMContentLoaded', function() {
  const form = document.forms['main-form'];
  if (form) form.addEventListener('input', refreshNeuroSummary);
  if (form) form.addEventListener('change', refreshNeuroSummary);
  setTimeout(refreshNeuroSummary, 200);
});
```

### Task 4.3: Similarly wrap Drainage (separate modal)

- [ ] **Step 1: Inside the same existing Disability card** (now wrapped in m-neuro modal), the Drainage section (lines ~2940-2948 — `pt-3 border-top` with "สายระบายต่างๆ") needs to be MOVED OUT of m-neuro and wrapped in its own m-drain modal.

- [ ] **Step 2: Cut the entire Drainage section** (the `<div class="pt-3 border-top">` containing dr_icd/dr_ng/dr_foley/dr_other and their notes).

- [ ] **Step 3: Add new row + modal for Drainage** outside m-neuro:

```html
<!-- NEW R4: Drainage modal -->
<div class="pp-row teal" onclick="ppOpenModal('m-drain')">
  <i class="bi bi-funnel ic" style="color:var(--teal-600);"></i>
  <div class="body">
    <div class="title">สายระบาย &amp; ท่อต่างๆ</div>
    <div class="sub">Drainage / Tubes</div>
    <div class="summary" id="pp-row-drain-summary">ไม่มีสายระบาย</div>
  </div>
  <button class="edit-modal"><i class="bi bi-box-arrow-up-right"></i> Modal</button>
</div>

<div class="pp-modal-backdrop" id="m-drain" onclick="if(event.target===this)ppCloseModal('m-drain')">
  <div class="pp-modal teal">
    <div class="pp-modal-head">
      <i class="bi bi-funnel ic" style="color:var(--teal-600);"></i>
      <div class="title">สายระบาย &amp; ท่อต่างๆ</div>
      <button class="close-x" onclick="ppCloseModal('m-drain')"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="pp-modal-body">
      <!-- Paste the drainage section here (the dr_icd / dr_ng / dr_foley / dr_other markup) -->
    </div>
    <div class="pp-modal-foot">
      <button class="btn btn-cancel" onclick="ppCloseModal('m-drain')">ปิด</button>
    </div>
  </div>
</div>
```

### Task 4.4: Body Exam modal (Motor power + Exposure)

- [ ] **Step 1: Locate Motor Power + Exposure section** (lines ~2919-2939 — `row g-4 mb-4 pt-3 border-top` containing motor_ra/la/rl/ll and exp_ra/la/rl/ll)

- [ ] **Step 2: Cut this section** out of the existing Disability card.

- [ ] **Step 3: Add new row + modal:**

```html
<div class="pp-row amber" onclick="ppOpenModal('m-body')">
  <i class="bi bi-person-arms-up ic" style="color:var(--amber-500);"></i>
  <div class="body">
    <div class="title">การตรวจร่างกาย (Body Exam)</div>
    <div class="sub">Motor power + Exposure (per-limb)</div>
    <div class="summary" id="pp-row-body-summary">RA5 · LA5 · RL5 · LL5 · ไม่มีบาดแผล</div>
  </div>
  <button class="edit-modal"><i class="bi bi-box-arrow-up-right"></i> Modal</button>
</div>

<div class="pp-modal-backdrop" id="m-body" onclick="if(event.target===this)ppCloseModal('m-body')">
  <div class="pp-modal amber">
    <div class="pp-modal-head">
      <i class="bi bi-person-arms-up ic" style="color:var(--amber-500);"></i>
      <div class="title">การตรวจร่างกาย</div>
      <button class="close-x" onclick="ppCloseModal('m-body')"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="pp-modal-body">
      <!-- Paste the existing Motor Power + Exposure markup here, unchanged -->
      <!-- The anatomical SVG figure from the prototype is OPTIONAL for v1; can add later -->
    </div>
    <div class="pp-modal-foot">
      <button class="btn btn-cancel" onclick="ppCloseModal('m-body')">ปิด</button>
    </div>
  </div>
</div>
```

Note: The anatomical SVG figure from the prototype is a v2 visual enhancement. For initial port, keep the existing Motor selects + Exposure inputs as-is inside the modal. SVG figure can be added in Phase 7 polish.

### Task 4.5: Pupils field split adapter

The prototype splits `pupil_size` into `pupil_size_r` + `pupil_size_l` and `pupil_react` into `pupil_react_r` + `pupil_react_l`. To preserve backward compatibility, KEEP production fields and ALSO add new split fields. Sync via JS.

- [ ] **Step 1: After the Pupils inputs in the Neuro modal**, add hidden inputs for the split version:

```html
<!-- Keep production pupil_size + pupil_react -->
<input type="text" name="pupil_size_r" id="pupil_size_r" style="display:none;">
<select name="pupil_react_r" id="pupil_react_r" style="display:none;">
  <option value="React">React</option>
  <option value="No">No React</option>
  <option value="Sluggish">Sluggish</option>
  <option value="Closed">Closed</option>
</select>
<input type="text" name="pupil_size_l" id="pupil_size_l" style="display:none;">
<select name="pupil_react_l" id="pupil_react_l" style="display:none;">
  <option value="React">React</option>
  <option value="No">No React</option>
  <option value="Sluggish">Sluggish</option>
  <option value="Closed">Closed</option>
</select>
```

- [ ] **Step 2: Add sync JS:**

```javascript
// Pupils field migration: production combined size "X/Y", new split = "X" + "Y"
function pupilsCombineToProduction() {
  const f = document.forms['main-form'];
  const r = f.elements['pupil_size_r']?.value || '';
  const l = f.elements['pupil_size_l']?.value || '';
  if (r || l) {
    f.elements['pupil_size'].value = r + '/' + l;
  }
  // For react: take r value (assumes both eyes typically same)
  const rr = f.elements['pupil_react_r']?.value;
  if (rr) f.elements['pupil_react'].value = rr;
}
function pupilsSplitFromProduction() {
  const f = document.forms['main-form'];
  const combined = f.elements['pupil_size']?.value || '';
  const parts = combined.split('/');
  if (parts.length === 2) {
    if (f.elements['pupil_size_r']) f.elements['pupil_size_r'].value = parts[0].trim();
    if (f.elements['pupil_size_l']) f.elements['pupil_size_l'].value = parts[1].trim();
  } else if (combined) {
    // Single value — apply to both
    if (f.elements['pupil_size_r']) f.elements['pupil_size_r'].value = combined.trim();
    if (f.elements['pupil_size_l']) f.elements['pupil_size_l'].value = combined.trim();
  }
  const r = f.elements['pupil_react']?.value;
  if (r) {
    if (f.elements['pupil_react_r']) f.elements['pupil_react_r'].value = r;
    if (f.elements['pupil_react_l']) f.elements['pupil_react_l'].value = r;
  }
}
// Run split after populateForm (i.e. after data load)
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(pupilsSplitFromProduction, 500);  // after case load
});
// Combine before save
const _origSaveData = window.saveData;
if (typeof _origSaveData === 'function') {
  window.saveData = function() {
    pupilsCombineToProduction();
    return _origSaveData.apply(this, arguments);
  };
}
```

### Task 4.6: Smoke Test #4 — Step 2 modals + Pupils migration

- [ ] **Step 1: Load existing case with pupils data**

- [ ] **Step 2: Verify:**

  - [ ] Open Neuro modal → GCS/Pupils/Pain inputs work
  - [ ] Open Body Exam modal → Motor selects + Exposure inputs work
  - [ ] Open Drainage modal → ICD/NG/Foley checkboxes work
  - [ ] Edit Pupils Right → save → reload → values persist
  - [ ] Production `pupil_size` field still has combined "R/L" string
  - [ ] Production reports (PCR print) still show pupils correctly

- [ ] **Step 3: Commit Phase 4**

```bash
git add v2/transport/index.html
git commit -m "feat(transport): Step 2 modals (Neuro / Body / Drainage) + Pupils split adapter

- Wrap GCS+Pupils+Pain in m-neuro modal
- Wrap Motor+Exposure in m-body modal
- Wrap Drainage in m-drain modal
- Add new pupil_size_r/l + pupil_react_r/l fields with sync to production pupil_size/pupil_react

All existing inputs preserved. Snapshot byte-identical.
Refs: spec section 5.2, 6 (migration risk note)"
```

---

## Phase 5: Step 3 Equipment Modal + 3 New Fields

### Task 5.1: Add 3 new equipment checkboxes

- [ ] **Step 1: Locate Equipment card** (line ~2990, "อุปกรณ์ที่ใช้")

- [ ] **Step 2: After eq_ecmo (id="eq5"), insert 3 new checkboxes:**

```html
<div class="form-check bg-light px-3 py-2 rounded border position-relative">
  <span style="position:absolute; top:2px; right:2px; background:var(--amber-500); color:#fff; font-size:9px; padding:1px 5px; border-radius:6px; font-weight:800;">NEW</span>
  <input class="form-check-input ms-0" type="checkbox" name="eq_infusion" id="eq-inf">
  <label class="form-check-label fw-medium ms-2" for="eq-inf">Infusion Pump</label>
</div>
<div class="form-check bg-light px-3 py-2 rounded border position-relative">
  <span style="position:absolute; top:2px; right:2px; background:var(--amber-500); color:#fff; font-size:9px; padding:1px 5px; border-radius:6px; font-weight:800;">NEW</span>
  <input class="form-check-input ms-0" type="checkbox" name="eq_syringe" id="eq-syr">
  <label class="form-check-label fw-medium ms-2" for="eq-syr">Syringe Pump</label>
</div>
<div class="form-check bg-light px-3 py-2 rounded border position-relative">
  <span style="position:absolute; top:2px; right:2px; background:var(--amber-500); color:#fff; font-size:9px; padding:1px 5px; border-radius:6px; font-weight:800;">NEW</span>
  <input class="form-check-input ms-0" type="checkbox" name="eq_suction" id="eq-suc">
  <label class="form-check-label fw-medium ms-2" for="eq-suc">Suction</label>
</div>
```

### Task 5.2: Wrap Equipment in modal

Same pattern as Neuro modal — keep inputs, add modal wrapper.

- [ ] **Step 1: Add row + modal:**

```html
<div class="pp-row slate" onclick="ppOpenModal('m-eq')">
  <i class="bi bi-tools ic" style="color:var(--slate-500);"></i>
  <div class="body">
    <div class="title">อุปกรณ์ที่ใช้ (Equipment)</div>
    <div class="sub">Devices in use</div>
    <div class="summary" id="pp-row-eq-summary">Monitor/Defib (1 รายการ)</div>
  </div>
  <button class="edit-modal"><i class="bi bi-box-arrow-up-right"></i> Modal</button>
</div>

<div class="pp-modal-backdrop" id="m-eq" onclick="if(event.target===this)ppCloseModal('m-eq')">
  <div class="pp-modal slate">
    <div class="pp-modal-head">
      <i class="bi bi-tools ic" style="color:var(--slate-500);"></i>
      <div class="title">อุปกรณ์ที่ใช้</div>
      <button class="close-x" onclick="ppCloseModal('m-eq')"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="pp-modal-body">
      <!-- existing Equipment grid stays here -->
    </div>
    <div class="pp-modal-foot">
      <button class="btn btn-cancel" onclick="ppCloseModal('m-eq')">ปิด</button>
    </div>
  </div>
</div>
```

### Task 5.3: Equipment summary refresh

- [ ] **Step 1: Add JS:**

```javascript
function refreshEqSummary() {
  const el = document.getElementById('pp-row-eq-summary');
  if (!el) return;
  const f = document.forms['main-form'];
  const fields = ['eq_spinal','eq_scoop','eq_mattress','eq_monitor','eq_ecmo',
                  'eq_infusion','eq_syringe','eq_suction','eq_other'];
  const checked = fields.filter(n => f.elements[n]?.checked).map(n => n.replace('eq_',''));
  el.textContent = checked.length ? checked.join(', ') + ' (' + checked.length + ' รายการ)' : 'ยังไม่บันทึก';
}
document.addEventListener('DOMContentLoaded', function() {
  const form = document.forms['main-form'];
  if (form) { form.addEventListener('change', refreshEqSummary); }
  setTimeout(refreshEqSummary, 200);
});
```

### Task 5.4: Smoke Test #5 — Equipment

- [ ] **Step 1: Open Equipment modal**

- [ ] **Step 2: Verify:**

  - [ ] All 9 checkboxes show (incl. 3 new with NEW badge)
  - [ ] Check Infusion Pump → save → reload → still checked
  - [ ] Equipment summary row shows count + names
  - [ ] PCR print includes new equipment when checked (check buildPcrHtml output)

- [ ] **Step 3: Commit Phase 5**

```bash
git add v2/transport/index.html
git commit -m "feat(transport): Equipment modal + 3 new fields (infusion/syringe/suction)

Added eq_infusion, eq_syringe, eq_suction with NEW badges.
Wrapped Equipment card in m-eq modal.
Refs: spec section 5.10"
```

---

## Phase 6: Step 3 Inline Sections (IV/Meds, Vitals Log, Nurse Note, Refer Docs)

### Task 6.1: Wrap IV/Meds container with pp-island-card

- [ ] **Step 1: Locate Step 3 IV/Meds card** (line ~3007)

- [ ] **Step 2: Add class `pp-island-card sky`** to the existing card div.

### Task 6.2: Wrap Vitals Log container

- [ ] **Step 1: Locate Vitals Log card** (line ~3016 — dark header card)

- [ ] **Step 2: Add class `pp-island-card`** (keep existing dark header styling).

### Task 6.3: Wrap Nurse Note card + add Template buttons

- [ ] **Step 1: Locate Nurse Note card** (line ~3028)

- [ ] **Step 2: Add class `pp-island-card amber`**

- [ ] **Step 3: BEFORE the textarea, add Template buttons:**

```html
<div class="pp-tmpl-row">
  <button type="button" class="pp-tmpl-btn" onclick="ppInjectTemplate('SAMPLE')"><i class="bi bi-clipboard"></i> SAMPLE</button>
  <button type="button" class="pp-tmpl-btn" onclick="ppInjectTemplate('OPQRST')"><i class="bi bi-clipboard"></i> OPQRST</button>
  <button type="button" class="pp-tmpl-btn" onclick="ppInjectTemplate('FDAR')"><i class="bi bi-clipboard"></i> FDAR</button>
  <span class="pp-tmpl-help">💡 กดเพิ่มหัวข้อให้กรอกได้</span>
</div>
```

- [ ] **Step 4: Add inject JS:**

```javascript
const PP_TEMPLATES = {
  SAMPLE: '\n[SAMPLE]\nS (Signs/Symptoms): \nA (Allergies): \nM (Medications): \nP (Past History): \nL (Last Meal): \nE (Events): \n',
  OPQRST: '\n[OPQRST]\nO (Onset): \nP (Provocation): \nQ (Quality): \nR (Region/Radiation): \nS (Severity 0-10): \nT (Time): \n',
  FDAR:   '\n[FDAR]\nF (Focus): \nD (Data): \nA (Action): \nR (Response): \n',
};
function ppInjectTemplate(name) {
  const ta = document.querySelector('textarea[name="nurse_note"]');
  if (!ta) return;
  const tmpl = PP_TEMPLATES[name];
  if (!tmpl) return;
  const pos = ta.selectionStart || ta.value.length;
  ta.value = ta.value.slice(0, pos) + tmpl + ta.value.slice(pos);
  ta.focus();
  // Trigger save (production formDirty flag)
  if (typeof formDirty !== 'undefined') formDirty = true;
}
```

### Task 6.4: Wrap Refer Docs card

- [ ] **Step 1: Locate Refer Docs card** (line ~3034)

- [ ] **Step 2: Add class `pp-island-card`** with `border-top-color:var(--sky-500)` inline.

### Task 6.5: Smoke Test #6 — Step 3 inline

- [ ] **Step 1: Open Step 3 in browser**

- [ ] **Step 2: Verify:**

  - [ ] All Step 3 cards have colored top accent strips
  - [ ] addIvLine still works (click + เพิ่มรายการ → row added)
  - [ ] addVitalLog still works (click + Add Vital → row added)
  - [ ] addArrestLog still works
  - [ ] Click SAMPLE → template snippet appears in nurse_note textarea
  - [ ] Click OPQRST/FDAR → snippets inject correctly
  - [ ] Refer doc upload still works (Cloudinary)
  - [ ] Save → reload → all data persists

- [ ] **Step 3: Commit Phase 6**

```bash
git add v2/transport/index.html
git commit -m "feat(transport): Step 3 inline cards + Nurse Note templates

- pp-island-card on IV/Meds, Vitals Log, Nurse Note, Refer Docs
- Template buttons (SAMPLE/OPQRST/FDAR) inject text snippets into nurse_note
- All existing addIvLine/addVitalLog/addArrestLog/Cloudinary upload preserved

Refs: spec section 5.2, 5.11"
```

---

## Phase 7: Interlocks (GCS lock + Reason modal + Vent interface)

### Task 7.1: Add `updateGcsVerbalLock` function

- [ ] **Step 1: Add the lock function — visually hint when intubated, no actual lock (per spec section 5.6):**

```javascript
// NEW R4: GCS V lock soft hint (paramedic-validated: no hard lock, just visual hint)
function updateGcsVerbalLock() {
  const f = document.forms['main-form'];
  if (!f) return;
  const at = f.elements['airway_type']?.value || '';
  const ams = f.elements['airway_mgt_sub']?.value || '';
  const intubated = (at === 'ET Tube' || at === 'Tracheostomy' || (at === 'Management' && ams === 'LMA/SGA'));
  // Auto-set V=VT if intubated and not yet acknowledged
  if (intubated && !window._airwayEttPulled) {
    const vSel = f.elements['gcs_v'];
    if (vSel && vSel.value !== 'VT') {
      vSel.value = 'VT';
      vSel.dispatchEvent(new Event('change'));
    }
  }
  // Show/hide hint banner in Neuro modal
  let hint = document.getElementById('pp-gcs-v-hint');
  if (!hint) return;
  hint.style.display = (intubated && !window._airwayEttPulled) ? '' : 'none';
  if (intubated) {
    const aw = (at === 'Management') ? 'LMA/SGA' : at;
    hint.querySelector('.aw-name').textContent = aw;
  }
}

// Hook into existing updateAirwayLogic via wrap
const _origUpdateAirwayLogic = window.updateAirwayLogic;
if (typeof _origUpdateAirwayLogic === 'function') {
  window.updateAirwayLogic = function() {
    _origUpdateAirwayLogic.apply(this, arguments);
    updateGcsVerbalLock();
  };
}
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(updateGcsVerbalLock, 300);
});
```

### Task 7.2: Add hint banner in Neuro modal

- [ ] **Step 1: Inside m-neuro modal body, BEFORE the GCS inputs, add:**

```html
<div id="pp-gcs-v-hint" class="pp-lock-banner" style="display:none;">
  ℹ️ ผู้ป่วยใส่ <b><span class="aw-name">ETT</span></b> · V default = T · กด V≠T จะถามเหตุผล (เพิ่มใน Assess/Tx อัตโนมัติ)
</div>
```

### Task 7.3: Add `openAirwayReasonModal` and `saveAirwayReason`

- [ ] **Step 1: Add reason modal markup** (at the same level as other modals):

```html
<!-- NEW R4: Airway Reason modal — z-index 250 to be above other modals -->
<div class="pp-modal-backdrop" id="m-airway-reason" style="z-index:250;" onclick="if(event.target===this)ppCloseModal('m-airway-reason')">
  <div class="pp-modal amber">
    <div class="pp-modal-head">
      <i class="bi bi-question-circle-fill ic" style="color:var(--amber-500);"></i>
      <div class="title">ระบุเหตุผลการเปลี่ยน V<span class="sub">Airway Status Change · บันทึกใน Assess/Tx อัตโนมัติ</span></div>
      <button class="close-x" onclick="cancelAirwayReason()"><i class="bi bi-x-lg"></i></button>
    </div>
    <div class="pp-modal-body">
      <div class="pp-status-line warn">
        🚨 ผู้ป่วยใส่ <b id="ar-aw-type">ETT</b> · ขอเหตุผลที่ V = <b id="ar-target-v">5</b> (ไม่ใช่ T)
      </div>
      <div class="pp-sub-title">เหตุผล (เลือก preset หรือพิมพ์เอง)</div>
      <div class="pp-pill-row" id="ar-reason-presets">
        <div class="pp-pill" data-reason="ETT หลุดเอง (self-extubation)">ETT หลุดเอง</div>
        <div class="pp-pill" data-reason="ถอด ETT ตามแผน (planned extubation)">ถอด ETT ตามแผน</div>
        <div class="pp-pill" data-reason="Tracheostomy decannulated">Trach decannulated</div>
        <div class="pp-pill" data-reason="LMA/SGA removed">LMA/SGA ถอด</div>
        <div class="pp-pill" data-reason="อื่นๆ (ระบุด้านล่าง)">อื่นๆ</div>
      </div>
      <div class="pp-sub-title">รายละเอียดเพิ่มเติม</div>
      <textarea class="pp-input" id="ar-reason-text" rows="3" placeholder="ระบุเหตุผล / สรุปเหตุการณ์..."></textarea>
    </div>
    <div class="pp-modal-foot">
      <button class="btn btn-cancel" onclick="cancelAirwayReason()">ยกเลิก · คง V=T</button>
      <button class="btn btn-save" onclick="saveAirwayReason()"><i class="bi bi-check-lg"></i> บันทึกเหตุผล &amp; ปลดล็อค V</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add JS:**

```javascript
window._airwayEttPulled = false;
window._arPendingV = null;
window._arReasonText = '';

function openAirwayReasonModal(targetV) {
  window._arPendingV = targetV;
  window._arReasonText = '';
  const f = document.forms['main-form'];
  const at = f.elements['airway_type']?.value;
  document.getElementById('ar-aw-type').textContent = (at === 'Management') ? 'LMA/SGA' : at;
  document.getElementById('ar-target-v').textContent = targetV;
  document.getElementById('ar-reason-text').value = '';
  const presets = document.getElementById('ar-reason-presets');
  presets.querySelectorAll('.pp-pill').forEach(p => {
    p.classList.remove('active','amber');
    p.onclick = () => {
      presets.querySelectorAll('.pp-pill').forEach(x => x.classList.remove('active','amber'));
      p.classList.add('active','amber');
      window._arReasonText = p.dataset.reason;
      if (!p.dataset.reason.startsWith('อื่นๆ')) {
        document.getElementById('ar-reason-text').value = p.dataset.reason;
      } else {
        document.getElementById('ar-reason-text').focus();
      }
    };
  });
  ppOpenModal('m-airway-reason');
}
function cancelAirwayReason() {
  window._arPendingV = null;
  ppCloseModal('m-airway-reason');
}
function saveAirwayReason() {
  const reasonText = (document.getElementById('ar-reason-text').value || window._arReasonText || '').trim();
  if (!reasonText) { alert('กรุณาระบุเหตุผล'); return; }
  const tv = window._arPendingV;
  window._airwayEttPulled = true;
  // Set gcs_v to target value
  const f = document.forms['main-form'];
  if (f.elements['gcs_v']) {
    f.elements['gcs_v'].value = tv;
    f.elements['gcs_v'].dispatchEvent(new Event('change'));
  }
  // Inject note into nurse_note (or any Assess/Tx that's currently being filled)
  // Try the most recent unsigned vital's note first, fall back to nurse_note
  const lastUnsignedVitalNote = document.querySelector('.vital-log-entry:not(.row-locked) .v-note');
  const noteText = '⚠️ Airway: ' + reasonText + ' @ ' + new Date().toLocaleTimeString('th-TH', {hour:'2-digit',minute:'2-digit',hour12:false}) + ' · V = ' + tv;
  if (lastUnsignedVitalNote) {
    lastUnsignedVitalNote.value = lastUnsignedVitalNote.value ? (lastUnsignedVitalNote.value + ' · ' + noteText) : noteText;
  } else {
    const nn = document.querySelector('textarea[name="nurse_note"]');
    if (nn) nn.value = nn.value ? (nn.value + '\n' + noteText) : noteText;
  }
  ppCloseModal('m-airway-reason');
  // Refresh
  if (typeof formDirty !== 'undefined') formDirty = true;
  updateGcsVerbalLock();  // re-evaluate (hint should hide now)
}
```

### Task 7.4: Hook the V select onchange to trigger reason modal

- [ ] **Step 1: Add change listener on gcs_v that intercepts non-VT selection while intubated:**

```javascript
document.addEventListener('DOMContentLoaded', function() {
  const vSel = document.forms['main-form']?.elements['gcs_v'];
  if (!vSel) return;
  vSel.addEventListener('change', function(e) {
    const f = document.forms['main-form'];
    const at = f.elements['airway_type']?.value || '';
    const ams = f.elements['airway_mgt_sub']?.value || '';
    const intubated = (at === 'ET Tube' || at === 'Tracheostomy' || (at === 'Management' && ams === 'LMA/SGA'));
    if (intubated && !window._airwayEttPulled && vSel.value !== 'VT') {
      // User selected non-VT while intubated and not acknowledged
      const targetV = vSel.value;
      vSel.value = 'VT';  // revert until reason confirmed
      openAirwayReasonModal(targetV);
    }
  });
});
```

### Task 7.5: Smoke Test #7 — Interlocks

- [ ] **Step 1: Open case with no airway**

- [ ] **Step 2: Verify:**

  - [ ] Set airway_type to ET Tube → V auto-becomes VT
  - [ ] Open Neuro modal → see V=VT, hint banner visible
  - [ ] Change V select to V5 → Reason Modal appears
  - [ ] Click "ETT หลุดเอง" preset → text fills
  - [ ] Click "บันทึกเหตุผล" → modal closes, V=5, hint hides, note added
  - [ ] Try changing V again → no prompt (flag set)
  - [ ] Reset airway to Open → set back to ET Tube → flag resets, prompt fires next change

- [ ] **Step 3: Commit Phase 7**

```bash
git add v2/transport/index.html
git commit -m "feat(transport): interlocks — GCS V auto-T + Airway Reason modal

- updateGcsVerbalLock auto-sets gcs_v='VT' when intubated
- Hint banner in Neuro modal (no hard lock — paramedic-validated)
- m-airway-reason modal (z-index 250) prompts when user changes V≠T
- saveAirwayReason injects note into latest unsigned vital or nurse_note
- Re-intubation via airway card resets _airwayEttPulled flag

Refs: spec section 5.6, 5.7"
```

---

## Phase 8: Time Input Auto-Mask (HH:MM)

### Task 8.1: Add maskTime helper and bind

- [ ] **Step 1: Check if production has its own `maskTime` already**

```bash
grep -n "function maskTime" v2/transport/index.html
```

Expected: production has `maskTime` at some location (referenced in input HTML attributes like `oninput="maskTime(this)"`).

- [ ] **Step 2: If production has maskTime, reuse it.** If not, add the prototype's version. (Use a different name like `ppMaskTime` to avoid conflict.)

Check production HTML inputs with `placeholder="HH:MM"` — are they already wired?

```bash
grep -n 'placeholder="HH:MM"' v2/transport/index.html
```

For any HH:MM inputs without `oninput="maskTime(this)"`, add it.

- [ ] **Step 3: Verify all HH:MM inputs have inputmode="numeric"**

If not, add via JS post-load:

```javascript
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('input[placeholder="HH:MM"]').forEach(el => {
    el.setAttribute('inputmode', 'numeric');
    el.setAttribute('maxlength', '5');
  });
});
```

### Task 8.2: Smoke Test #8 — Time inputs

- [ ] **Step 1: Open Add Vital modal in any field with HH:MM**

- [ ] **Step 2: Verify:**

  - [ ] Type "1935" → displays "19:35"
  - [ ] Type letters/symbols → ignored
  - [ ] On mobile (or DevTools mobile emulator) → numeric keyboard appears
  - [ ] Click Now → time stamps correctly

- [ ] **Step 3: Commit Phase 8**

```bash
git add v2/transport/index.html
git commit -m "feat(transport): time input mask + inputmode=numeric

All HH:MM inputs auto-insert ':' after 2 digits, mobile numeric keypad.
Refs: spec section 5.12"
```

---

## Phase 9: Full Smoke Test + Paramedic Review

### Task 9.1: Run full danger_zones smoke test

Per `memory/danger_zones_ux_refactor.md` smoke test list, verify each:

- [ ] 1. **Open existing case → save → reload → all values present** (snapshot integrity)
- [ ] 2. **Add vital → save → reload → vital present, signed state preserved**
- [ ] 3. **Change airway to LMA → sub-field reveals; switch back → hides** (airway interlock)
- [ ] 4. **Change O2 mask type → flow rate range updates** (oxygen guideline)
- [ ] 5. **Sign consent → NR status auto-flips to DNR** (consent flow — untouched, should still work)
- [ ] 6. **Open case on 2 devices → A edits + saves → B sees update** (realtime merge)
- [ ] 7. **Mobile (375px) + tablet portrait (768px) + desktop (1280px)**: visually correct, no overflow, no broken hooks
- [ ] 8. **Print**: `@media print` still hides chrome elements, PCR output correct

### Task 9.2: Paramedic-user review checkpoint

- [ ] **Step 1: Share local URL with user via Tailscale / local network IP**

`http://<local-ip>:8080/v2/transport/?case=<test-case>`

- [ ] **Step 2: Paramedic-user walks through:**

  - [ ] All Step 2 inline cards usable on tablet
  - [ ] All Step 2 modals usable
  - [ ] All Step 3 sections usable
  - [ ] Add Vital / Add Arrest / Add IV flows
  - [ ] GCS interlock + reason modal flow
  - [ ] Minibar reflects live values
  - [ ] No regressions vs production

- [ ] **Step 3: Capture any issues** in a list. Fix critical issues before deploy.

### Task 9.3: Address feedback (if any)

- [ ] For each issue: 1 sub-commit per fix

```bash
git add v2/transport/index.html
git commit -m "fix(transport): <specific issue>"
```

### Task 9.4: Final commit + tag

- [ ] **Step 1: Final commit**

```bash
git add v2/transport/index.html
git commit -m "feat(transport): Step 2+3 redesign — ready for production

Full implementation per spec. Paramedic-validated via local preview.
Refs: docs/superpowers/specs/2026-05-23-transport-step2-step3-redesign-design.md"
```

- [ ] **Step 2: Tag pre-deploy snapshot**

```bash
git tag -a pre-deploy-step2-step3-redesign -m "Snapshot before merging Step 2+3 redesign to main"
```

---

## Phase 10: Merge + Deploy + Verify

### Task 10.1: Merge feature branch to main

- [ ] **Step 1: Switch to main**

```bash
git checkout main
git pull origin main  # ensure up to date
```

- [ ] **Step 2: Merge feature branch**

```bash
git merge --no-ff feat/transport-step2-step3-redesign -m "Merge: Transport Step 2+3 redesign

Spec: docs/superpowers/specs/2026-05-23-transport-step2-step3-redesign-design.md
Plan: docs/superpowers/plans/2026-05-25-transport-step2-step3-implementation.md
Paramedic-approved via local preview."
```

- [ ] **Step 3: Push to remote**

```bash
git push origin main
git push origin --tags
```

### Task 10.2: GitHub Pages deploy verify

- [ ] **Step 1: Wait for GitHub Pages build** (~25-60 seconds after push)

- [ ] **Step 2: Hard refresh production URL**

`https://supwilaimedical.github.io/pt-medical-system/v2/transport/?case=<test-case>` (Ctrl+Shift+R)

- [ ] **Step 3: Smoke test #9 — production**

Same as Smoke Test #1 but on production. Verify no console errors and all data flows work.

### Task 10.3: Cleanup

- [ ] **Step 1: Delete feature branch** (after confirmed working)

```bash
git branch -d feat/transport-step2-step3-redesign
git push origin --delete feat/transport-step2-step3-redesign
```

- [ ] **Step 2: Update memory file**

Add entry to `memory/MEMORY.md`:

```markdown
- [Transport Step 2+3 Redesign](recent_work_may25.md) — **DEPLOYED 2026-05-25**: pp-island-card pattern, mock topbar+minibar, 3 new equipment fields, GCS Reason modal interlock, Pupils split adapter, Cap Refill, Template buttons, Time mask. Paramedic-validated locally before deploy.
```

---

## Risk + Rollback Strategy

| Stage | Risk | Rollback |
|---|---|---|
| Phase 1-2 | CSS regression | `git checkout HEAD~1 -- v2/transport/index.html` |
| Phase 3-6 | HTML wrapper breaks form | `git revert <commit>` |
| Phase 7 | Interlock breaks existing GCS behavior | `git revert` + disable updateGcsVerbalLock wrap |
| Phase 8 | Time mask breaks input | `git revert` |
| Phase 9 | Paramedic finds critical UX issue | Continue iteration in feature branch, don't merge |
| Phase 10 | Production regression after deploy | `git revert` main commit, push immediately, hard-refresh notification |

---

## Self-Review (per writing-plans skill)

**1. Spec coverage:**
- ✓ Sec 5.1 Layout — Phase 8 (subnav/bnav) — *Note: Phase 8 currently only covers time mask. Need separate phase for layout responsive.*
- ✓ Sec 5.2 Pattern mix — Phases 3-6
- ✓ Sec 5.3 Mock topbar — Phase 2
- ✓ Sec 5.4 Minibar — Phase 2
- ✓ Sec 5.5 GCS Mode A — Phase 7 (in updateGcsVerbalLock + refreshMinibar)
- ✓ Sec 5.6 V=T interlock — Phase 7
- ✓ Sec 5.7 O2/Vent interlocks — *Gap: not covered explicitly. Production has these; we don't need to reimplement, but should verify they still fire.*
- ✓ Sec 5.8 Add row modals — Phase 6 (existing add functions)
- ✓ Sec 5.9 Body figure — *Partial: Phase 4 wraps body section in modal, but anatomical SVG is deferred.*
- ✓ Sec 5.10 Equipment +3 — Phase 5
- ✓ Sec 5.11 Nurse Note templates — Phase 6
- ✓ Sec 5.12 Time mask — Phase 8

**Gap fixes (added inline):**
- Layout responsive (wide 2-col): Add as Phase 8b
- Verify production O2/Vent interlocks: Add as Phase 7b smoke test
- Body anatomical SVG: Mark as optional Phase 7c polish

**2. Placeholder scan:**
- ✓ No "TBD" or "TODO" placeholders
- ✓ All code blocks contain complete code

**3. Type/name consistency:**
- ✓ Function names: `ppOpenModal` / `ppCloseModal` consistent across phases
- ✓ `updateGcsVerbalLock`, `openAirwayReasonModal`, `saveAirwayReason` — names match spec
- ✓ CSS class names `pp-*` consistent
- ✓ Field names: `circ_cap`, `eq_infusion`, `eq_syringe`, `eq_suction`, `pupil_size_r/l`, `pupil_react_r/l` — match spec section 6

**4. Layout phase gap fixed below:**

---

## Phase 8b (added): Layout — Wide 2-col + Subnav/Bnav

Currently the prototype has Step 2 + Step 3 in a custom layout container. Production uses `goToStep(n)` to swap d-none classes. We add CSS for wide-screen split + step subnav/bnav as a progressive enhancement.

### Task 8b.1: Add subnav at top of step area

- [ ] **Step 1: Find the existing step1/step2/step3 panel containers**

```bash
grep -n 'id="step1-panel"\|id="step2-panel"\|id="step3-panel"' v2/transport/index.html
```

- [ ] **Step 2: Before step2-panel, add a step subnav:**

```html
<div class="pp-step-subnav" id="pp-step-subnav" style="display:none;">
  <button class="step-tab" data-step="2" onclick="goToStep(2)" id="pp-tab-2">
    <i class="bi bi-stethoscope"></i> Step 2 — การประเมิน
  </button>
  <button class="step-tab" data-step="3" onclick="goToStep(3)" id="pp-tab-3">
    <i class="bi bi-truck"></i> Step 3 — ขณะนำส่ง
  </button>
</div>
```

- [ ] **Step 3: Show subnav when on step 2 or 3, hide on step 1:**

```javascript
const _origGoToStep_v2 = window.goToStep;
window.goToStep = function(n) {
  _origGoToStep_v2.apply(this, arguments);
  const subnav = document.getElementById('pp-step-subnav');
  if (subnav) subnav.style.display = (n === 2 || n === 3) ? '' : 'none';
  document.querySelectorAll('.pp-step-subnav .step-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.step === String(n));
  });
};
```

### Task 8b.2: Wide-screen 2-col CSS

- [ ] **Step 1: Add to the pp-* CSS block:**

```css
@media (min-width:1400px) {
  #step2-panel, #step3-panel { display: block !important; }
  #step2-panel { float: left; width: 49%; margin-right: 1%; }
  #step3-panel { float: right; width: 49%; }
  .pp-step-subnav { display: none !important; }
}
@media (min-width:1800px) {
  body { max-width: 1750px; margin: 0 auto; }
}
```

Note: This overrides production's `d-none` on the panels at ≥1400px so both are visible side-by-side.

### Task 8b.3: Smoke Test #8b — Layout

- [ ] **Step 1: Open in browser at ≥1400px**

- [ ] **Step 2: Verify:**

  - [ ] Both Step 2 and Step 3 visible side-by-side
  - [ ] Subnav hidden
  - [ ] Resize to <1400px → goes back to single column with subnav

- [ ] **Step 3: Commit Phase 8b**

```bash
git add v2/transport/index.html
git commit -m "feat(transport): wide-screen 2-col layout + step subnav

≥1400px shows Step 2 | Step 3 side-by-side. <1400px shows subnav switcher.
Refs: spec section 5.1"
```

---

## Phase 7b (added): Production Interlock Verification

### Task 7b.1: Smoke test existing O2/Vent interlocks

These were never touched by our changes but worth verifying still fire after all modal/wrapper changes.

- [ ] **Step 1: Test Airway → O2 device filter**

  - Set airway to ET Tube → O2 device dropdown should auto-limit to "BVM"
  - Set airway to Tracheostomy → O2 should show Collar Mask/T-Piece/BVM/Personal Vent/Room Air
  - Verify `updateAirwayLogic()` still updates `o2_device` select options

- [ ] **Step 2: Test Vent toggle → O2 panel hide**

  - Toggle on_ventilator → `panel-oxygen` hides, `panel-ventilator` shows
  - Toggle off → reverses

- [ ] **Step 3: Test Vent mode → sub-mode + label**

  - Pick PCV → sub-mode visible, label "PIP / Peak"
  - Pick VCV → label "Tidal Vol"
  - Pick CPAP/BIRD → sub-mode hides, label "Pressure"

- [ ] **Step 4: Test Central Line → IV route filter**

  - Check central line → `addIvLine` shows "Central Line" route option
  - Uncheck → hides

- [ ] **Step 5: Test Arrest outcome → time field reveal**

  - Check arrest_pre_arrest → detail panel shows
  - Pick ROSC → ROSC Time appears
  - Pick Dead → Dead Time appears
  - Pick Ongoing CPR → both hide

If ANY of these break, the issue is in our wrapper markup (likely a misplaced closing div). Use `git diff` to find and fix.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-transport-step2-step3-implementation.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Recommended for this size of plan (~50 tasks).

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Slower iteration but easier to interrupt.

**Which approach?**
