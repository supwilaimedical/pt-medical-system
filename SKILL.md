---
name: pt-medical-system
description: Working rules and conventions for PT Medical System — multi-deployment medical/EMS records app (Transport / Firstaid / Location / GPS / Monitor / Fleet). Use whenever editing v2/* modules, shared/, supabase/, cloudflare/, gas/. Especially helpful for mobile UX refactor (preview-first, breakpoint-isolated, logic-byte-identical), GAS backup mirroring, PowerShell Thai encoding gotcha, GPS_ENABLED gating, and Supwilai/Thegood sync rules.
---

# PT Medical System — Working Rules

ระบบบันทึกผู้ป่วย (EMS). Multi-deployment (Supwilai primary + Thegood). Single HTML per module + Supabase + Cloudinary + CF Workers. รายละเอียดระบบดู `design.md`.

## 1. Hard Rules (ห้ามฝ่าฝืน)

1. **No magic.** ห้ามใช้ค่า/พฤติกรรมที่ไม่อธิบาย. ทุก behavior ต้อง trace กลับ source ได้.
2. **Verify before "done".** ก่อนรายงานเสร็จ — อ่านไฟล์จริง, run check, ดู actual state. ไม่เดาจาก memory.
3. **Dissent.** ถ้า user request ขัดกับ logic หรือ design — แย้งก่อนทำ. ไม่ silently comply.
4. **No scope drift.** แก้แค่ที่สั่ง. งานเพิ่มเติมเสนอก่อน, ไม่ทำเอง.
5. **Explicit assumptions.** ถ้าต้องเดา — บอกว่าเดาอะไร.
6. **Tell me all you do.** รายงานทุก file ที่แตะ + ทุก change.

## 2. Buddhist-way Refactor (mobile/tablet UX)

ระหว่างทำ mobile redesign:
- **Logic byte-identical** — snapshot, medical interlocks, data flow ไม่แตะ
- **Preview-first** — mockup ที่ `v2/preview/<module>.html` ก่อน, user review บนเครื่องจริง, แล้วค่อย apply
- **CSS + wrapper classes only** — ห้าม rename/remove existing `id`, `name`, `onclick`, `class` ที่ JS อ่าน
- **Breakpoint isolation** — mobile rules อยู่ใน `@media (max-width:1024px) and (orientation:portrait)` เท่านั้น. Desktop + landscape ไม่แตะ
- **Order**: Transport → Firstaid → Location → GPS → Monitor → Fleet → Admin → Dashboard

ดู `memory/danger_zones_ux_refactor.md` สำหรับรายการ JS hooks / medical interlocks ที่ห้าม restructure.

## 3. Medical Interlocks (immutable)

Transport form — ห้ามเปลี่ยน:
- `airway_mgt` → `airway_mgt_sub` (LMA/SGA → `input-lma-no`) → `updateAirwayLogic()`
- `o2_device` → `o2_flow` range validation → `updateO2Detail()`
- `vent_mode` → param fields → `updateVentLogic()`
- `toggleCentralLine()`, `toggleArrestOutcome('pre'|'post')`
- Vitals `isLocked` (signed = immutable)
- Triage `mt1-mt4` color + sort
- GCS `E+V+M` sum display
- NR Status: `Full Support` / `DNR` / `Palliative` (DNR auto-flipped จาก consent)

Firstaid:
- `fa_bump_supply` atomic RPC — ห้ามแทนด้วย direct UPDATE (race condition)
- `recordedBy` case sensitivity (admin='Admin', staff=staff name)
- `vitals_json`: NULL when empty (ไม่ใช่ empty string)

## 4. Multi-Deployment Sync

แก้แล้วต้อง mirror ระหว่าง Supwilai + Thegood:

**DO sync:** HTML/JS/CSS, schema migrations (run separately), worker code
**DO NOT sync:** `shared/config.js` (credentials), `cloudflare/wrangler.toml`, CF secrets

เพิ่ม DEFAULTS keys ใหม่ใน `shared/config.js` — paste block ทั้งสอง repo มือ, ไม่ copy ทั้งไฟล์.

## 5. GAS Edit → Local Backup (RULE)

ทุกครั้งที่แก้ใน GAS editor ต้อง mirror กลับ local:
- Supwilai HR → `F:\@Coding\ระบบ\Supwilai HR System\`
- The Good HR → `F:\@Coding\ระบบ\The Good Backup\`
- DMS → `F:\@Coding\ระบบใบเสร็จ ใบเสนอราคา\`

User ต้องการ backup นอก Google.

## 6. PowerShell Thai Encoding (GOTCHA)

`Get-Content -Raw | Set-Clipboard` ทำให้ Thai เพี้ยน (Win-874 → mojibake).

ใช้:
```powershell
$txt = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
Set-Clipboard -Value $txt
```
Verify: Ctrl+F หาคำไทยหลัง paste.

## 7. UI Pattern Quick Reference

ดู `memory/ui_patterns.md` ละเอียด. สรุป:
- **Flush topbar**: container `padding:0`, topbar `margin:0` + own padding
- **Kebab menu**: portal-to-body (Location) หรือ CSS overflow+flip-up (Transport)
- **Mobile touch**: ≥40px buttons, ≥16px input font (กัน iOS zoom)
- **FAB + bnav**: bnav grid = `repeat(visible+1, 1fr)` ใส่ invisible pocket cell ตรงกลาง, FAB center ตกในช่อง
- **GPS_ENABLED**: ใช้ explicit `display = enabled ? '' : 'none'` (ไม่ใช่ show-only)

## 8. File Conventions

- Single HTML per module — CSS + HTML + JS ในไฟล์เดียว
- Shared: `v2/shared.js`, `v2/shared.css`, `shared/config.js`
- ห้ามสร้าง `.md` ใหม่ ถ้า user ไม่ขอ
- Edit ก่อน Write (ใช้ Write เฉพาะไฟล์ใหม่หรือ rewrite ทั้งหมด)

## 9. Reporting Format

ทุกครั้งที่จบงาน:
- รายการ file ที่แตะ (path absolute)
- สาเหตุ + วิธีแก้
- ระบุชัดว่า logic แตะหรือไม่แตะ
- ถ้า user ใช้ PORDEE MODE — ตอบสั้น, Thai กระชับ, technical English เดิม, ไม่มี polite particles

## 10. Working Method Cross-ref

Task ต้องคิดละเอียด/ดีบัก/user pushback → consult `~/.claude/skills/buddhist-method/SKILL.md` (Kalāma / Yoniso / Sati / Anatta / Pahāna / Upekkhā).

## 11. Memory Files (อ่านตอน task ต้องการ context)

- `memory/working_rules.md` — 6 hard rules (full)
- `memory/danger_zones_ux_refactor.md` — JS hooks/interlocks ห้ามแตะ
- `memory/ui_patterns.md` — V2 pattern ละเอียด
- `memory/parallel_system.md` — Supwilai + Thegood configs
- `memory/project_architecture.md` — full architecture
- `memory/coding_style.md` — fix-right-first-time, no backward compat
