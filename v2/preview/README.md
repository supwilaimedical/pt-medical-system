# v2/preview/ — Mobile + Tablet Portrait Redesign Sandbox

Static HTML mockups (no JS, no logic) for iterating on the mobile/tablet-portrait UX.
Reference style: IAD SmartCare (clean cards, soft pastel, numbered sections, sticky CTA, bottom nav).

## Hard rules

1. **Logic must not change.** Live module code is byte-identical until a pattern is approved here, then applied with CSS + class additions only — no JS edits.
2. **Mobile + tablet portrait only.** `≤1024px portrait`. Desktop & landscape stay as-is.
3. **Theme stays.** Reuse existing palette / Bootstrap 5 / Sarabun. No new colors.
4. **Element hooks preserved.** Anything JS reads (`id=`, `name=`, `onclick=`, certain classes) must remain on the live element when patterns get applied.

See `memory/danger_zones_ux_refactor.md` for the full list of code/elements that JS depends on.

## Workflow

```
1. Build static preview here  →  2. User reviews on real device  →  3. Approve  →
4. Move pattern into shared/mobile-patterns.css (live)  →  5. Apply to live module
6. Smoke test  →  7. Push
```

## Order

Transport → Firstaids → Location → GPS → Monitor → Fleet → Admin Settings → Dashboard

## Files

- `index.html` — preview gallery
- `shared/mobile-patterns.css` — pattern library being built
- `transport-list.html`, `transport-form.html`, ... — per-screen mockups

## Patterns (in `shared/mobile-patterns.css`)

| Class | Purpose |
|---|---|
| `.pp-patient-header` | Sticky patient identity card (avatar + name + HN + age + gender) |
| `.pp-stat-strip` | 3-column meta strip with icons (Ward / Bed / Dx) |
| `.pp-section-num` | Numbered section header |
| `.pp-big-toggle` | Card-style toggle (replaces tiny radio for triage/severity) |
| `.pp-sticky-cta` | Full-width sticky bottom action button |
| `.pp-bottom-nav` | 5-tab bottom navigation |

(more added as approved)

## Decisions log

- 2026-05-08 — Project started. Reference: IAD SmartCare. Cutoff `≤1024px portrait`. Theme stays.
