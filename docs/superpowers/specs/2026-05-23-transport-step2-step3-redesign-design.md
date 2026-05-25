# Transport Form — Step 2 + Step 3 Redesign

**Date:** 2026-05-23
**Status:** Ready for implementation plan
**Domain expert:** Paramedic (user) — clinical decisions validated by primary user
**Working prototype:** `v2/preview/transport-step2-step3-redesign.html` (2,748 lines, served on local HTTP)
**Target file (production):** `v2/transport/index.html` (9,163 lines)

---

## 1. Context

### Problem
After real-world use, paramedics found the existing Transport (PCR) form confusing:
- No clear "island" separation between sections
- Too many dropdowns (e.g. Disability section had 9 dropdowns in one card)
- Touch targets small on mobile (in moving ambulance)
- Step 2's "ระบบประสาท" (Disability) section had 3 distinct concepts (Neuro / Body Exam / Drainage) crammed into one card with motor power + exposure for the same limb split across rows
- Initial V/S used SweetAlert popup — disconnected from the form
- No good way to see all vitals at a glance across Step 2 + Step 3

### Why this redesign
- Pure CSS + new wrapper markup — **logic must stay byte-identical** (per `danger_zones_ux_refactor.md`)
- Snapshot / save flow / medical interlocks UNCHANGED
- All `name=` attributes preserved (production engineering hooks)

---

## 2. Goals

1. **Visual hierarchy** — clear cards (islands), priority highlights, color coding
2. **Mobile-first** — 40px+ touch targets, 16px input (no iOS zoom), Thai word-break
3. **Cognitive load reduction** — split concepts, replace dropdowns with tap-pills for numeric scales
4. **At-a-glance vitals** — sticky minibar visible across Step 2 + Step 3
5. **Clinical safety** — Airway ↔ V=T interlock enforced visually + functionally
6. **Wide-screen support** — Step 2 + Step 3 side-by-side on ≥1400px
7. **Production form parity** — match existing topbar pattern (patient identity + timeline + collapsible details)

---

## 3. Non-Goals (Out of Scope)

Per `danger_zones_ux_refactor.md`:
- ❌ Change snapshot mechanism (`getFormData`, `rawSnapshot`, `populateForm`)
- ❌ Change save flow (`saveData`, `formDirty`, auto-save timer)
- ❌ Change realtime merge state (`_loadedRawSnapshot`, `_handleRemoteCaseUpdate`)
- ❌ Change edit modal sync (`m_*` IDs ↔ form `name=*`)
- ❌ Rename / remove any `name=`, `id=`, `onclick=` hooks
- ❌ Database schema changes
- ❌ Auth / RLS changes
- ❌ Print path (`buildPcrHtml`, `pcrFitToPage`) — already redesigned in PR #18-21

---

## 4. User Profile

- **Primary user:** Paramedic (Thai EMS team)
- **Device:** Tablet portrait (10") + phone (375-414px) in moving ambulance
- **Clinical training:** ABCDE protocol, anatomical convention (R/L = patient's R/L)
- **Field constraints:** Hand vibration, bright sunlight, gloves on, fast workflow during transport
- **Test methodology:** Domain expert (paramedic) tested prototype directly — no external clinician review needed

---

## 5. Architecture Decisions

### 5.1 Layout — Wide split, narrow switcher

| Viewport | Behavior |
|---|---|
| **<1400px** | Single column, `subnav` at top + `bnav` at bottom (mobile <768px) to switch Step 2 ↔ Step 3 |
| **≥1400px** | Side-by-side 2 columns: Step 2 \| Step 3 (subnav hidden, both visible) |
| **≥1800px** | Wider wrap (1750px max-width) to give ~852px per column |

CSS responsive container widths:
```css
.pp-wrap { max-width: 1100px; }
@media (min-width:1400px) { .pp-wrap { max-width: 1500px; } }
@media (min-width:1800px) { .pp-wrap { max-width: 1750px; } }
```

### 5.2 Pattern Mix — Inline + Modal per section

**Decision principle:** Inline for sections used during high-frequency updates / initial fill; Modal for sections with dense interactive content (body diagram, GCS, drainage checklists).

**Step 2 (7 sections):**
| Section | Pattern | Rationale |
|---|---|---|
| สัญญาณชีพแรกรับ (Initial V/S) | **Inline + Edit Modal** | Filled once at intake, displayed prominently |
| ทางเดินหายใจ (Airway) | **Inline** | Simple pills + tube panel (small) |
| การหายใจ & ออกซิเจน (Breathing) | **Inline** | O2 filter pills + Vent panel (toggle reveals) |
| ระบบไหลเวียนเลือด (Circulation) | **Inline + Arrest chip** | Status pills + Cap Refill + EKG + Central Line + Initial IV + **Cardiac Arrest chip** → opens modal |
| ระบบประสาท & ความเจ็บปวด (Neuro) | **Modal** | GCS score ring + 3 pill rows + Pupils + Pain (dense) |
| การตรวจร่างกาย (Body Exam) | **Modal** | Anatomical body figure + 4 limb cards (visual-heavy) |
| สายระบาย & ท่อต่างๆ (Drainage) | **Modal** | 4 row checklist with notes |

**Step 3 (5 sections):**
| Section | Pattern | Rationale |
|---|---|---|
| อุปกรณ์ที่ใช้ (Equipment) | **Modal** | Grid of 9 checkboxes (3 newly added) |
| สารน้ำ / ยา ระหว่างนำส่ง (IV/Meds) | **Inline + Add Modal** | List visible + Add row via modal |
| บันทึกสัญญาณชีพ (Vitals Log) | **Inline + Add Vital/Arrest Modals** | Long list visible + Add via modals |
| บันทึกอาการ (Nurse Note) | **Inline** | Textarea + Template buttons inject text |
| เอกสารแนบ (Refer Docs) | **Inline** | File gallery, max 5 |

### 5.3 Mock Production Topbar (sticky)

The redesign assumes integration into the existing production topbar:
- Timeline strip (top)
- Patient identity row (name, badges Emergency / ลงนามแล้ว, expand chevron)
- Expanded details (toggle): ALS, Route, Dx, CC, แพ้, U/D
- **Vital minibar (always visible)** — connected below the patient row

Cardiac Arrest pre-arrival used to be a separate dashboard row → moved into **Circulation card** as a `pp-circ-arrest-chip` (Option C — ABCDE flow preserved).

### 5.4 Vital Minibar (sticky)

Compact horizontal chip strip showing latest vitals across Step 2 + Step 3:
- Pulls from latest Vitals Log entry; falls back to Initial V/S
- Always shows: BP, PR, RR, SpO2, T°, DTX, GCS (with T suffix if intubated), Pain
- Conditionally shows: 🔒 Airway chip (when intubated), 🚨 Arrest chip (when arrest active)
- `flex-wrap: nowrap` + `overflow-x: auto` → 1 line, swipe on mobile
- Tiny chip size: padding 2-7px / font 9-11px

### 5.5 GCS T Mode A (verified via deep research)

When V = T (intubated):
- **V is NOT counted** (NOT zero, NOT one — dropped entirely)
- **Total = E + M** (only 2 components)
- Display with `T` suffix: e.g. `10T` for E4 VT M6
- Min: 2T (E1 + M1), Max: 10T (E4 + M6)
- Color logic by numeric total (regardless of T):
  - 13–15 green, 9–12 amber, 3–8 red
- This is the **paramedic-confirmed convention** (matches "2T" seen in production charts)
- Sources verified: resus.me, glasgowcomascale.org FAQ, Rivara Health ICU guide

**Note on V value internal representation:**
- Production currently stores `gcs_v = 'VT'` when intubated (`if(isArtificialAirway) gcsV.value = 'VT'`, line 5218)
- Prototype uses `gcs_v = 'T'`
- **Implementation decision:** Keep production's `'VT'` value for backward compat (existing saved cases use VT). UI displays "T" but internal value stays "VT". Add adapter in display logic: if `gcs_v === 'VT' || gcs_v === 'T'` → treat as intubated.

### 5.6 Airway ↔ V=T Interlock

**Auto-set rule:**
When `airway_type ∈ {"ET Tube", "Tracheostomy"}` OR `(airway_type = "Management" AND airway_mgt_sub = "LMA/SGA")`:
- GCS V is auto-set to `"T"` (default)
- A soft hint banner shows: "ℹ️ ผู้ป่วยใส่ [ETT/Trach/LMA] · V default = T · กด V≠T จะถามเหตุผล"
- Minibar shows 🔒 Airway chip

**Unlock pattern (paramedic-validated):**
- V pills 1-5 are NOT visually locked (clickable, no gray-out)
- Clicking V ≠ T while patient is intubated triggers **Airway Reason Modal** (z-index 250, above Add Vital modal at 200)
- Reason modal: preset pills + free text
- On confirm:
  - `STATE.airway_ett_pulled = true` (flag)
  - V value set to clicked target
  - Auto-inject note into current Add Vital's Assess/Tx textarea:
    `⚠️ Airway: [reason] @ HH:MM · V = [value]`
  - Subsequent Add Vital modals: V NOT auto-T (because flag set), no prompt
- On Cancel: V stays T (no change)
- **Re-intubation:** If user changes airway back to ETT/Trach/LMA via Airway card → flag resets, prompt fires again next time

**Note:** Production also auto-sets V=T (line 5218: `if(isArtificialAirway) gcsV.value = 'VT';`) but does not lock. The reason modal pattern is a **safety enhancement** over production.

### 5.7 Airway → O2 Device → Vent Interlock (production parity verified)

**Production rules (verified from `updateAirwayLogic` line 5180, `updateVentLogic` line 5237, `updateO2Detail` line 5260):**

O2 device options filter by airway_type:
| Airway type | sub | O2 options |
|---|---|---|
| Open / Management (non-LMA) | — | Room Air, Cannula, Mask c Bag, HFNC, BVM |
| Management + LMA/SGA | LMA/SGA | BVM only |
| ET Tube | — | BVM only |
| Tracheostomy | — | Collar Mask, T-Piece, BVM, Personal Vent, Room Air |

O2 device → fields shown:
| Device | Flow | FiO2 | Temp |
|---|---|---|---|
| Cannula, Mask c Bag, Collar Mask, BVM, T-Piece | ✓ | — | — |
| HFNC | ✓ | ✓ | ✓ |
| Room Air, Personal Vent | — | — | — |

Vent ↔ O2 mutually exclusive panels:
- `on_ventilator = true` → vent panel shown, O2 panel hidden
- `on_ventilator = false` → O2 panel shown, vent panel hidden

Vent mode sub-logic:
- PCV / VCV → reveal CMV/SIMV sub-mode + label "PIP / Peak" (PCV) / "Tidal Vol" (VCV)
- CPAP / BIRD → hide sub-mode + label "Pressure"

**Visual enhancement:** Interface hint chip auto-detects from airway:
- Open + vent ON → "Mask NIV (CPAP/BiPAP via face mask)"
- ETT + vent ON → "🔒 Invasive · ETT"
- Tracheostomy + vent ON → "🔒 Invasive · Tracheostomy"
- Management LMA + vent ON → "LMA/SGA"

Ventilator can be used **with any airway type** (NIV via mask = Open + vent; invasive = ETT/Trach + vent).

### 5.8 Add Row Modals (Vital / Arrest / IV)

Three "add row" modals trigger from inline section buttons:
- **m-add-vital** — opens from Vitals Log "+ Add Vital" → save → appends to `STATE.vitals_log`
- **m-add-arrest** — opens from Vitals Log "+ Add Arrest" → save → appends to `STATE.vitals_log` (type: 'arrest')
- **m-add-iv** — opens from either Step 2 Circulation "Initial IV +" or Step 3 IV/Meds "+ เพิ่มรายการ" → save → appends to `STATE.initial_iv_lines` or `STATE.iv_lines` based on context

Context chip shown in Add IV modal:
- Step 2 trigger → amber chip "Context: Initial (สารน้ำที่ได้รับมาก่อนนำส่ง — Step 2)"
- Step 3 trigger → blue chip "Context: Transport (เพิ่มเข้า Step 3 IV log)"

**Central Line lock:** In Add IV modal, Route pill "Central Line" is grayed/disabled if `has_central_line` is false (with tooltip).

### 5.9 Body Exam — Anatomical Figure

Inline SVG human silhouette (medical chart style):
- Skin-tone gradient (warm orange `#fef3e2 → #fde8c8`)
- Head with face (eyes, brows, nose, mouth, ears, hair) → orientation unambiguous
- Anatomical proportions: neck, curved torso, arms slightly out at angle, legs separated, feet
- **R / L letters big on torso** (28px bold, opacity 0.85) — primary safety label
- Limb badges (RA, LA, RL, LL) — 18px radius circles with:
  - Top: limb code (RA/LA/RL/LL)
  - Bottom: motor power score (0-5)
  - Color: green (5), amber (3-4), red (0-2)
  - Active limb: amber dashed outline
- Limb cards on right (or below on mobile): Thai-first labels "RA · แขนขวา (Right Arm)"
- Active limb edit panel: Motor pill row [0-5] + Exposure note input
- Confirmation banner in active state: "🎯 กำลังแก้ไข: ขาขวา (Right Leg — ขวาของผู้ป่วย)"

### 5.10 Equipment — Add 3 NEW devices (user-requested)

New checkbox cards (with "NEW" badge):
- `eq_infusion` — Infusion Pump
- `eq_syringe` — Syringe Pump
- `eq_suction` — Suction

Existing kept: `eq_spinal`, `eq_scoop`, `eq_mattress`, `eq_monitor` (default checked), `eq_ecmo`, `eq_other` + `eq_other_note`

### 5.11 Nurse Note — Template Buttons (static text injection)

Three template buttons in Nurse Note inline section:
- **SAMPLE** — Signs/Allergies/Medications/Past History/Last meal/Events
- **OPQRST** — Onset/Provocation/Quality/Region/Severity/Time
- **FDAR** — Focus/Data/Action/Response

Behavior:
- Click button → inject Thai+English template snippet at textarea cursor (or append if empty)
- Static text only — no DB schema change
- No "template_used" tracking — keeps schema simple

### 5.12 Time Input Auto-Mask

All HH:MM time inputs (11 fields):
- `inputmode="numeric"` → mobile shows numeric keypad
- `maxlength="5"` → max "HH:MM"
- `pattern="[0-9]{2}:[0-9]{2}"`
- On input: strip non-digits, cap hours at 23, minutes at 59, auto-insert `:` after 2 digits
- "Now" button stamps current time directly (bypasses mask)

---

## 6. Field Name Preservation (engineering hooks)

**All `name=` attributes preserved exactly — these are read by production `getFormData()` and `populateForm()`. Renaming any breaks the snapshot/save/load cycle.**

### Step 2 fields
```
Initial V/S: init_bp, init_pr, init_rr, init_temp, init_spo2, init_dtx, init_vitals_time
Airway:      airway_type (Open|Management|ET Tube|Tracheostomy)
             airway_mgt_sub (Oral|Nasal|LMA/SGA)
             aw_lma_no
             tube_no, tube_depth, cuff_status
O2/Vent:     o2_device, o2_flow, o2_conc, o2_temp
             on_ventilator (checkbox)
             vent_mode, vent_submode
             vent_rate, vent_vol_pres, vent_peep, vent_fio2, vent_ie
Circulation: circ_status (Stable|Shock)
             circ_ekg
             circ_cap (NEW — added per redesign)
             has_central_line (checkbox), central_line_pos
Disability:  gcs_e, gcs_v (1-5 or "VT"/"T"), gcs_m
             pupil_size_r, pupil_react_r, pupil_size_l, pupil_react_l (NEW split — production has combined pupil_size + pupil_react; needs migration plan)
             pain_score
             motor_ra, motor_la, motor_rl, motor_ll
             exp_ra, exp_la, exp_rl, exp_ll, exp_other
             dr_icd + dr_icd_note, dr_ng + dr_ng_note, dr_foley + dr_foley_note, dr_other + dr_other_note
Arrest:      arrest_pre_arrest (checkbox)
             arrest_pre_time, arrest_pre_cpr_time
             arrest_pre_rhythm (VF|pVT|PEA|Asystole|Unknown)
             arrest_pre_outcome (ROSC|Terminate CPR|Ongoing CPR)
             arrest_pre_rosc_time, arrest_pre_dead_time, arrest_pre_note
```

### Step 3 fields
```
Equipment:   eq_spinal, eq_scoop, eq_mattress, eq_monitor, eq_ecmo
             eq_infusion (NEW), eq_syringe (NEW), eq_suction (NEW)
             eq_other, eq_other_note
IV/Meds:     (managed via addIvLine() in 2 containers)
             initial-iv-lines-container (Step 2 Circulation)
             iv-lines-container (Step 3 Transport)
             Each row: time, route (IV/IO/Central Line), name, rate, isSedate (checkbox)
Vitals Log:  (managed via addVitalLog() + addArrestLog() in vitals-log-container)
             Each vital row: time, bp, pr, rr, temp, spo2, pain, gcs_e, gcs_v, gcs_m, note, isLocked
             Each arrest row: arrest_time, arrest_cpr_time, arrest_rhythm, arrest_outcome, arrest_rosc_time, arrest_dead_time, arrest_note
Nurse Note:  nurse_note (textarea)
Refer Docs:  (managed via handleReferFileSelect() — Cloudinary upload)
```

### Migration risks
- `pupil_size_r/pupil_react_r/pupil_size_l/pupil_react_l` — production currently uses combined `pupil_size` + `pupil_react` (single string for both eyes). Splitting requires:
  - Read old combined value → split on "/" → populate new fields
  - Save new fields → either keep both for backward compat OR migrate snapshot
  - **Decision needed in implementation phase** — recommend: keep old fields as hidden + compute from new, OR add migration helper that reads/writes both

---

## 7. Interlock Functions (extend existing)

Reuse production interlock function names (don't break existing JS callers):
- `updateAirwayLogic()` — extend to also call `updateGcsVerbalLock()`
- `updateVentLogic()` — keep production logic, add interface hint chip update
- `updateO2Detail()` — keep production logic
- `toggleCentralLine()` — keep production logic
- `toggleArrest('pre')` — keep production logic (toggles arrest detail visibility)
- `toggleArrestOutcome('pre')` — keep production logic (reveals ROSC/Dead time)
- `calcArrestCprDuration('pre')` — keep production logic
- **NEW:** `updateGcsVerbalLock()` — auto-sets V=T if intubated, shows lock banner
- **NEW:** `openAirwayReasonModal(targetV)` — triggered when user clicks V≠T while intubated
- **NEW:** `saveAirwayReason()` — sets airway_ett_pulled flag, injects note, sets V

---

## 8. Files Affected

### Modified
- `v2/transport/index.html` — primary target (9,163 lines)
  - HTML restructure: Step 2 cards, Step 3 cards, modals
  - CSS: new `pp-*` prefixed classes (alongside existing `island-card`)
  - JS: new functions for minibar, interlocks, reason modal

### New files (optional — separate CSS for clean diff)
- `v2/transport/_redesign.css` — new island/minibar/modal styles (or inline in index.html for single-file deploy)

### Reference / preview
- `v2/preview/transport-step2-step3-redesign.html` — interactive prototype (DO NOT deploy, only for reference)
- `docs/superpowers/specs/2026-05-23-transport-step2-step3-redesign-design.md` (this file)

### NOT modified
- `v2/shared.js` — no change
- `v2/monitor/index.html` — no change
- `v2/transport/index.html` snapshot serialization — no change
- DB schema — no change
- Edge functions / RLS — no change

---

## 9. Acceptance Criteria

### Functional (smoke test from `danger_zones_ux_refactor.md`)
- [ ] Open existing case → save → reload → all values present (snapshot integrity)
- [ ] Add vital → save → reload → vital present, signed state preserved
- [ ] Change airway to ETT → V automatically becomes T in Neuro modal + locked visually
- [ ] Click V ≠ T in Add Vital while ETT → Reason modal opens
- [ ] Confirm reason → V set, note added to Assess/Tx, flag set
- [ ] Next Add Vital → V no longer auto-T, no prompt
- [ ] Re-confirm airway as ETT → flag resets, prompt fires again
- [ ] Toggle on_ventilator → vent panel reveals, O2 panel hides (mutually exclusive)
- [ ] Pick VCV → label "Tidal Vol"; pick PCV → "PIP/Peak"; pick CPAP/BIRD → "Pressure" + hide CMV/SIMV
- [ ] O2 device pill list filters by airway_type (ETT shows only BVM, Trach shows 5 options, etc.)
- [ ] Equipment: 3 new (infusion/syringe/suction) check/uncheck persists
- [ ] Add IV: Central Line route locked if `has_central_line` is false
- [ ] Initial V/S modal → save → display tile + minibar update
- [ ] Body Exam: tap limb → highlight + edit panel; score update reflects in badge color
- [ ] Cardiac Arrest chip in Circulation → opens m-arrest modal; if filled, chip turns red with summary
- [ ] Nurse Note template button → inject snippet at cursor
- [ ] Time inputs accept only digits + auto-insert `:` after 2 digits
- [ ] Mobile (375px): minibar 1 line with horizontal swipe; subnav switches Step 2 ↔ 3
- [ ] Desktop (≥1400px): Step 2 + Step 3 side-by-side, subnav hidden

### Visual
- [ ] Sticky topbar — patient identity + minibar always visible
- [ ] All cards use new `pp-island-card` style + 5px top accent strip
- [ ] R / L safety labels visible on body figure
- [ ] Pain pill color gradient: green (0-3), amber (4-6), red (7-10) — active state preserves color
- [ ] GCS score ring color: green/amber/red based on total
- [ ] Cardiac Arrest chip: gray when empty, red + pulse when filled

### Performance
- [ ] No JS errors in console
- [ ] Page interactive within 2s
- [ ] Modal open/close < 200ms
- [ ] Save flow unchanged (`saveData` still fires at same checkpoints)

### Multi-device
- [ ] 2 devices on same case → realtime merge still works (snapshot byte-identical)
- [ ] Edit modal sync still works (`m_*` IDs ↔ form `name=*`)

---

## 10. Risks & Mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| Pupils field split breaks snapshot | High | Keep old `pupil_size`/`pupil_react` as hidden inputs computed from new R/L fields; OR migration helper that reads/writes both formats |
| `name=` rename accidentally breaks `populateForm` | Critical | Test smoke test #1 (open case → save → reload → values present) on every commit |
| Time mask conflicts with existing `maskTime()` in production | Medium | Reuse production `maskTime` if compatible; rename our helper to avoid global collision |
| Modal stacking z-index conflict | Low | Document z-index ladder: backdrop 200, airway reason modal 250 |
| Reason flow vs production's confirm() pattern | Medium | Production currently has no confirm prompt — adding reason modal is enhancement. Make sure it doesn't block save flow if user cancels |
| Mobile minibar overflow on very narrow (<350px) | Low | Horizontal scroll already implemented; test on iPhone SE |
| Wide screen 2-col grid breaks at unusual viewports | Low | Test 1399px (boundary), 1400px, 1700px, 1800px, 2560px |
| Browser caching during deploy | Medium | Existing GitHub Pages serves with cache; user must hard-refresh after deploy |

---

## 11. Implementation Phases (high-level — `writing-plans` will detail)

### Phase 1 — Scaffold (CSS + layout)
- Add `pp-*` CSS classes to existing index.html
- Add mock topbar structure (or integrate into existing topbar)
- Add minibar with empty chip placeholders
- Wide screen 2-col layout via media query

### Phase 2 — Step 2 inline sections
- V/S แรกรับ inline card (replace SweetAlert popup with proper modal trigger)
- Airway inline (keep production logic + pill UI)
- Breathing & O2 inline (vent + O2 panel mutual exclusion)
- Circulation inline + Cap Refill input + Arrest chip

### Phase 3 — Step 2 modals
- Neuro modal (GCS dual state + Pupils split + Pain)
- Body Exam modal (anatomical figure + limb cards)
- Drainage modal (4-row checklist)
- Arrest modal (already in production — wrap with new modal chrome)

### Phase 4 — Step 3 inline + Equipment modal
- Equipment modal with 3 new fields
- IV/Meds inline + Add IV modal
- Vitals Log inline + Add Vital/Arrest modals
- Nurse Note inline + Template buttons
- Refer Docs inline

### Phase 5 — Interlocks
- `updateGcsVerbalLock()` — Airway → V=T
- `openAirwayReasonModal()` + `saveAirwayReason()` — VT unlock flow
- Vent interface hint chip
- O2 device filter by airway_type (port from preview)

### Phase 6 — Minibar live update
- Wire minibar chips to STATE / form changes
- Show airway lock chip + arrest pulse chip conditionally

### Phase 7 — Smoke test + polish
- Run full `danger_zones_ux_refactor.md` smoke checklist
- Mobile / tablet / desktop visual verification
- Multi-device realtime merge test
- Performance check

### Phase 8 — Deploy + verify
- GitHub Pages deploy
- Hard refresh verification
- Production smoke test on real case
- Monitor for regression

---

## 12. Decisions Log (chronological — for reference)

1. Initial direction: pure CSS redesign (later expanded to UX overhaul)
2. ETT/Trach options confirmed as airway types (production line 2742-2745)
3. 3 new equipment fields confirmed: `eq_infusion`, `eq_syringe`, `eq_suction`
4. Nurse Note template = static text injection (Option A — no DB change)
5. Step 2 Disability section split: ONE section → 3 modals (Neuro / Body / Drainage)
6. R/L safety overlay confirmed: Option 1 (anatomical + big R/L labels + Thai-first labels)
7. GCS T Mode A confirmed via deep research + paramedic validation: V=T not counted, total=E+M, "10T"
8. Airway → V=T interlock: ETT/Trach/LMA/SGA all force V=T
9. Modal pattern (R3) → Mixed inline+modal (R4) per paramedic UX feedback
10. Step 3 IV/Meds + Vitals Log → moved to inline; Add buttons open modals
11. VT unlock via Airway Reason modal (z-index 250, above Add Vital 200), auto-note injection
12. Cardiac Arrest pre-arrival → chip in Circulation (Option C — ABCDE preserved, no extra row)
13. HR/BP/Cap Refill — removed from Circulation (production parity); Cap Refill added back per paramedic request
14. SpO2/RR — removed from Breathing card (already in V/S แรกรับ + Vitals Log)
15. Mock production topbar with expand/collapse — minibar embedded below patient row
16. Vital minibar — compact 1-line horizontal scroll, smaller chips (9-11px font)
17. Step 2/3 layout — wide=2col @ 1400px, narrow=subnav/bnav switch
18. Wrap max-width: Option D (1500 @ 1400, 1750 @ 1800)
19. Body figure — replaced stick figure with anatomical medical chart silhouette
20. Time inputs — auto-mask `:` after 2 digits, inputmode="numeric"
21. Domain expert = paramedic (user themselves), no external review needed

---

## 13. References

### Internal
- `v2/transport/index.html` lines 2706-3070 (current Step 2 + Step 3 markup)
- `v2/transport/index.html` lines 5180-5300 (medical interlock functions)
- `v2/transport/index.html` lines 5514-5586 (Initial V/S popup)
- `v2/transport/index.html` lines 5368-5512 (IV line helpers)
- `v2/transport/index.html` lines 5610-5840 (Vital + Arrest log helpers)
- `memory/danger_zones_ux_refactor.md` — preview-first workflow rule
- `memory/transport_v2_redesign_plan.md` — original UX-only redesign plan
- `memory/ui_patterns.md` — V2 patterns (flush topbar, kebab menu, mobile rules)
- `memory/working_rules.md` — user's 7 hard rules

### External
- [GCS in intubated patients · resus.me](https://resus.me/gcs-in-intubated-patients/)
- [Glasgow Coma Scale FAQ · Official](https://www.glasgowcomascale.org/faq/)
- [GCS (ICU) Complete Scoring Guide · Rivara Health](https://rivarahealth.com/solutions/icu/blog/glasgow-coma-scale-gcs-icu-guide/)

---

## 14. Approval & Next Step

**Approval gate:** User (paramedic) to review this spec → on approval, invoke `superpowers:writing-plans` to produce a detailed step-by-step implementation plan with review checkpoints.

**Ready signal:** "approved" / "ok" / "ไปต่อ" → proceed to writing-plans
**Hold signal:** "wait" / "เพิ่ม..." → iterate on spec
