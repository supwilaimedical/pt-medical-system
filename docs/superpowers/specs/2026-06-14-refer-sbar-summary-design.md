# Refer AI Summary → SOAP format

วันที่: 2026-06-14
ไฟล์หลัก: `v2/transport/index.html` (ฟีเจอร์ [[refer-ai-summary-feature]])

## เป้าหมาย

เปลี่ยนผลสรุปใบ Refer ที่ AI อ่าน (OCR) จาก free-text ภาษาไทยก้อนเดียว →
จัดรูปแบบ **SOAP** (Subjective / Objective / Assessment / Plan)
ซึ่งเป็นรูปแบบบันทึกทางการแพทย์มาตรฐานที่บุคลากรคุ้นเคย

> ประวัติการตัดสิน: รอบแรกเลือก SBAR (handoff) แต่ user เปลี่ยนเป็น **SOAP**
> (2026-06-14, รอบสอง) เพราะคุ้นเคยกว่าในงานบันทึกเวชระเบียน — ไม่เลือก FDAR
> (เป็น charting เชิงเวลา ไม่เหมาะกับการสรุปเอกสาร refer)

## ขอบเขต (เปลี่ยนน้อยสุด)

| สิ่งที่เปลี่ยน | สิ่งที่ **ไม่** แตะ |
|---|---|
| prompt ใน `_ocrSummarize` → ออกเป็น SOAP | ชื่อ fn/id หลัก: `_ocrSummarize`, `v2SummarizeReferDocs`, `_referOcrProxy`, `referSummary`, badge 🤖, modal, cache, gate เคสปิด |
| logic เลือก model: Pro×3 (backoff) → Flash | responseSchema `{ summary: string }` (เก็บเป็น string เหมือนเดิม) |
| | storage `raw_data.referSummary` (string มีหัวข้อ S/B/A/R) |
| | display: `#refer-summary-body` มี `white-space:pre-wrap` แล้ว — ไม่ต้องแก้ (render หัวข้อ S/O/A/P ได้เลย) |
| | คำเตือนท้าย modal ("ไม่ใช่คำวินิจฉัย/คำแนะนำการรักษา") — คงไว้ |

## โครง output SOAP ที่ AI ต้องคืน (เป็น text ในก้อน `summary` เดียว)

```
S (Subjective): อาการสำคัญ, ระยะเวลา/ประวัติ, โรคประจำตัว ตามที่เอกสารระบุ
O (Objective): สัญญาณชีพ, ตรวจร่างกาย, ผลแล็บ/ภาพถ่ายรังสี, การรักษาที่ให้มาก่อนส่ง
A (Assessment): การวินิจฉัย/ประเมินของแพทย์ต้นทาง (เฉพาะที่เขียนในเอกสาร)
P (Plan): แผนการรักษา/เหตุผลส่งต่อ/สิ่งที่ขอให้ปลายทางทำต่อ (เฉพาะที่เขียนในเอกสาร)
```

## กฎเข้มงวด (เดิม + เพิ่มกันขัดกับ A/P)

1. ถอด/สรุป **เฉพาะที่ปรากฏในเอกสาร** ห้ามเติม เดา อนุมาน
2. **A และ P** = ถอดเฉพาะข้อความที่แพทย์ผู้ส่งเขียนไว้เอง — ห้าม AI สร้าง
   ความเห็น/คำวินิจฉัย/คำแนะนำของตัวเอง
3. ช่องไหนเอกสารไม่ระบุ → ใส่ `(ไม่ระบุในเอกสาร)` ไม่เว้นว่าง ไม่เดา
4. ไม่ใส่ชื่อ-สกุลผู้ป่วย (PII; อายุ/เพศ ได้); ชื่อ รพ./สถานที่/บุคคล อ่านไม่ชัด → `(อ่านไม่ชัด)`
5. ไม่ระบุต้นทาง-ปลายทาง เว้นแต่เอกสารเขียนไว้ชัด → ใส่ตามที่เขียนเป๊ะ

## Model fallback (ใหม่)

`gemini-2.5-pro` → retry Pro อีก 2 ครั้ง (รวม 3) พร้อม backoff สั้นๆ เมื่อเจอ
429/503/500 → ถ้ายังไม่ได้ค่อย fallback `gemini-2.5-flash` 1 ครั้ง → error
(ของเดิม: pro 1 ครั้ง → flash ทันที)

## Part 2 — สคริปต์ regen เคสเก่า (one-time, Claude รัน)

มีเคสที่มีสรุปเก่า ≤10 เคส → regen ใหม่เป็น SBAR ทีเดียว

- **Node script** `tools/regen-refer-sbar.mjs` (one-time, ไม่ commit เป็นของถาวรก็ได้)
- เข้าถึงข้อมูลแบบเดียวกับ browser:
  - Supabase REST + anon key (จาก `shared/config.js`) — เลียน `persistReferSummary`
    pattern: SELECT `case_id, raw_data` from `cases` → merge → PATCH `raw_data`
  - OCR ผ่าน proxy `gps-proxy.supwilai-ambulance.workers.dev/?model=...`
    (proxy ถือ Gemini key เอง — สคริปต์ไม่ต้องมี key) ส่ง `Origin` header
    ให้ผ่าน CORS check ของ worker
- ขั้นตอนต่อเคส:
  1. parse `raw_data.referDocsJson` → list `{url, type}`
  2. fetch แต่ละ doc → base64 + mime (รูป: ใช้ Cloudinary transform `w_2000,q_auto,f_jpg`;
     PDF: ส่ง bytes ตรงด้วย mime `application/pdf` — Gemini อ่าน PDF ได้ ไม่ต้อง pdf.js)
  3. เรียก SBAR prompt เดียวกับ Part 1 (Pro×3 → flash)
  4. PATCH `raw_data.referSummary` + `referSummaryAt = now`
- **ปลอดภัย:** อ่านเอกสารเดิม (ใบจริงบน Cloudinary) ใหม่หมด — ไม่ได้แปลงจากข้อความเก่า
- **เงื่อนไข:** เอกสารต้องยังอยู่บน Cloudinary; ถ้าเคสไหนไม่มี doc → ข้าม + รายงาน

## Verification

1. เปิดเคสที่มีใบ Refer → กด "สรุปด้วย AI" → ผลออกเป็น S/O/A/P ครบ 4 หัวข้อ
2. เคสที่เอกสารไม่ระบุบางช่อง → ช่องนั้นขึ้น `(ไม่ระบุในเอกสาร)` ไม่ใช่เดา
3. รัน regen script → log บอกผลทุกเคส (สำเร็จ/ข้าม/error) → เปิดดู badge 🤖 + เนื้อ SOAP
4. ตรวจว่าไม่มีชื่อ-สกุลผู้ป่วยหลุดเข้าไปในสรุป
