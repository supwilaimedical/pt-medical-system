-- =============================================================================
-- notifications_v3_percase_cap.sql
-- เพดานแจ้งเตือน LINE ต่อเคส + แยกเลน Arrest ออกจาก Critical
-- =============================================================================
-- ที่มา (2026-07-31): LINE OA "Supwilai Notify" โควตาเดือน ก.ค. เต็ม 300/300
--   ทำให้ทั้งบริษัทไม่ได้รับแจ้งเตือนอะไรเลยหลายวันโดยไม่มีใครรู้
--   ตัวกินหลักคือ handleNotifyCheck ที่ "ไม่มีเพดานต่อเคส" — ยิงซ้ำได้ทุกครั้งที่
--   อาการแย่ลง และทุกครั้งที่มีคนกด ack แล้ว refire
--
-- มติ Pex:
--   1) 1 เคส ส่ง LINE ได้ไม่เกิน 2 ครั้ง
--   2) Arrest แยกออกมาเป็นอีกเลน มีโควตาของตัวเอง (อีก 2 ครั้ง)
--      → ใช้ alert_type='ARREST' ซึ่ง PK (case_id, alert_type) รองรับอยู่แล้ว
--   3) เพดานนี้นับเฉพาะ LINE — Telegram ส่งต่อได้ไม่จำกัด (ฟรี ไม่มีโควตา)
--      ⇒ ประหยัดโควตาโดยไม่สูญเสียการแจ้งเตือนทางคลินิก ถ้าเปิด Telegram ไว้
--
-- ปลอดภัย: เพิ่มคอลัมน์อย่างเดียว มี DEFAULT ครบ ไม่แตะข้อมูลเดิม ไม่ล็อกนาน
-- =============================================================================

ALTER TABLE notification_state
  ADD COLUMN IF NOT EXISTS line_sent_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_sent_at    TIMESTAMPTZ;

COMMENT ON COLUMN notification_state.line_sent_count IS
  'จำนวนครั้งที่ส่ง LINE สำเร็จจริงของ (case_id, alert_type) นี้ — worker กันไม่ให้เกิน NOTIFY_LINE_MAX_PER_CASE (ค่าเริ่มต้น 2) · Telegram ไม่นับ';
COMMENT ON COLUMN notification_state.last_sent_at IS
  'เวลาที่ส่งครั้งล่าสุด (first_sent_at เก็บครั้งแรกไว้เหมือนเดิม ไม่ถูกทับอีกแล้ว)';

-- แถวเก่าที่เคยส่งไปแล้วก่อนมีคอลัมน์นี้: ถือว่าใช้ไป 1 ครั้ง
-- (ไม่ตั้งเป็น 0 เพราะจะเท่ากับแจกโควตาใหม่ให้เคสเก่าทั้งหมดพร้อมกัน)
UPDATE notification_state
   SET line_sent_count = 1,
       last_sent_at    = COALESCE(last_sent_at, first_sent_at)
 WHERE line_sent_count = 0
   AND first_sent_at IS NOT NULL;

-- =============================================================================
-- ✅ เช็คหลังรัน
-- =============================================================================
-- select alert_type, count(*), sum(line_sent_count) as line_sent
--   from notification_state group by alert_type;
--
-- ดูว่าเคสไหนชนเพดานบ้าง (ควรมีน้อย ถ้าเยอะแปลว่าเกณฑ์ critical ไวเกินไป):
-- select case_id, alert_type, line_sent_count, first_sent_at, last_sent_at
--   from notification_state where line_sent_count >= 2 order by last_sent_at desc limit 50;
--
-- ดูว่าถูกบล็อกเพราะเพดานไปกี่ครั้ง:
-- select date_trunc('day', created_at) d, count(*)
--   from notification_log
--  where status='skipped' and error like 'LINE_CAP_PER_CASE%'
--  group by 1 order by 1 desc;
-- =============================================================================
