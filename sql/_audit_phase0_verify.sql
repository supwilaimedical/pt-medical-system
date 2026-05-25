-- ============================================================================
-- PHASE 0 — VERIFY SUPABASE PRODUCTION STATE
-- ============================================================================
-- รันใน Supabase Dashboard → SQL Editor → New Query → ทีละ block
-- ผลลัพธ์ใช้ตัดสินใจว่าแต่ละ RLS/Index finding "จริงใน prod" หรือ "ฟิกใน dashboard ไปแล้ว"
-- ห้าม commit ไฟล์นี้ — เป็น read-only audit, ไม่ใช่ migration
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 1: RLS Status (table-level)
-- เช็คว่าทุกตารางสำคัญ RLS enable หรือยัง
-- ถ้า rowsecurity = false → ใครก็ทำอะไรก็ได้ (no protection at all)
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  tablename,
  rowsecurity AS rls_enabled,
  CASE
    WHEN rowsecurity THEN '✅ RLS ON'
    ELSE '🔴 RLS OFF — anyone with anon key can do anything'
  END AS verdict
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'cases',
    'notification_state',
    'notification_log',
    'fa_event_tokens',
    'fa_registry',
    'fa_events',
    'transport_consents',
    'loc_shared_tokens',
    'gps_shared_tokens',
    'gps_vehicles',
    'gps_providers',
    'settings',
    'activity_log'
  )
ORDER BY tablename;


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 2: All RLS Policies (the actual rules)
-- ดูทุก policy ที่ active ใน prod
-- โฟกัส: roles, cmd (SELECT/INSERT/UPDATE/DELETE/ALL), qual (USING), with_check
-- 🔴 Flag ถ้า: roles={anon} + cmd=ALL + qual=true → anon ทำอะไรก็ได้
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  tablename,
  policyname,
  roles,
  cmd,
  qual AS using_clause,
  with_check,
  CASE
    WHEN cmd = 'ALL' AND 'anon' = ANY(roles) AND qual = 'true'
      THEN '🔴 CRITICAL — anon full CRUD'
    WHEN cmd IN ('UPDATE', 'DELETE') AND 'anon' = ANY(roles) AND qual = 'true'
      THEN '🟠 HIGH — anon can mutate'
    WHEN cmd = 'SELECT' AND 'anon' = ANY(roles) AND qual = 'true'
      THEN '🟡 review — check if PHI exposed'
    ELSE '✅ scoped'
  END AS severity
FROM pg_policies
WHERE tablename IN (
    'cases',
    'notification_state',
    'notification_log',
    'fa_event_tokens',
    'fa_registry',
    'fa_events',
    'transport_consents',
    'loc_shared_tokens',
    'gps_shared_tokens',
    'gps_vehicles',
    'gps_providers',
    'settings',
    'activity_log'
  )
ORDER BY tablename, cmd, policyname;


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 3: Existing Indexes (performance baseline)
-- ดู index ที่มีอยู่จริงในตารางที่ query บ่อย
-- ใช้เทียบกับ task #14 (Phase 5) ว่ายังขาด index ไหน
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('cases', 'notification_log', 'notification_state',
                    'fa_registry', 'fa_events', 'transport_consents')
ORDER BY tablename, indexname;


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 4: Check for duplicate active consent versions
-- ถ้า > 0 rows → race condition (#24) เกิดขึ้นจริงในอดีต
-- ต้อง cleanup ก่อนจะใส่ unique constraint ใน Phase 2.3
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  case_id,
  COUNT(*) AS active_versions,
  MIN(version) AS min_ver,
  MAX(version) AS max_ver
FROM transport_consents
WHERE status = 'active'
GROUP BY case_id
HAVING COUNT(*) > 1
ORDER BY active_versions DESC;


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 5: Check for case_id collisions (#26 has it happened?)
-- ถ้า > 0 rows → มี case ที่ ID ชนกัน → upsert overwrite เคยเกิดจริง
-- ───────────────────────────────────────────────────────────────────────────
-- หมายเหตุ: ถ้า cases มี PRIMARY KEY (case_id) จะไม่มี duplicate ใน DB —
-- แต่เราอยากดูว่าจำนวน random suffix ที่ใช้ในแต่ละวันชนสถิติเท่าไหร่
SELECT
  SUBSTRING(case_id FROM 6 FOR 8) AS date_prefix,
  COUNT(*) AS cases_per_day,
  ROUND(100.0 * COUNT(*) / 1000, 2) AS collision_probability_pct
FROM cases
WHERE case_id LIKE 'CASE-________-___'
GROUP BY 1
ORDER BY 2 DESC
LIMIT 20;


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 7: Verify public_token column length (Wave 3A deployment check)
-- token ใหม่จาก crypto.getRandomValues = 35 chars ('pt-' + 32 hex)
-- ถ้า data_type='text' หรือ character_maximum_length >= 35 → ✅ deploy ได้
-- ถ้า < 35 → ต้อง ALTER COLUMN ก่อน deploy
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  column_name,
  data_type,
  character_maximum_length AS max_len,
  CASE
    WHEN data_type = 'text' THEN '✅ unlimited — safe to deploy 35-char token'
    WHEN character_maximum_length >= 35 THEN '✅ ' || character_maximum_length || ' chars — safe'
    ELSE '🔴 ONLY ' || character_maximum_length || ' chars — must ALTER COLUMN before deploy'
  END AS verdict
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'cases'
  AND column_name = 'public_token';


-- ───────────────────────────────────────────────────────────────────────────
-- BLOCK 6: Sample notification_log payload (PHI exposure check)
-- ดูตัวอย่าง payload จริง — ถ้ามี patient name/age/route → leak จริง (#23)
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  id,
  case_id,
  channel,
  alert_type,
  status,
  -- ตัด payload ให้สั้นเพื่อไม่ leak ตัวจริงไปใน output
  LEFT(payload::text, 200) AS payload_sample,
  created_at
FROM notification_log
ORDER BY created_at DESC
LIMIT 3;
