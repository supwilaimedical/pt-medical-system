-- ============================================================================
-- FIX: Admin can't delete Consent (real production bug, 2026-05-25)
-- ============================================================================
--
-- SYMPTOM (reported by user):
--   "Consent เวลาลงไปแล้ว Admin จะลบก็ลบไม่ได้ เพราะกรอกผิด"
--   Admin clicks 🗑️ ลบฉบับนี้ (Admin) button → SweetAlert "ลบไม่สำเร็จ"
--   with Supabase RLS error.
--
-- ROOT CAUSE (verified in sql/create_transport_consents.sql line 52):
--   transport_consents has RLS enabled but ONLY SELECT/INSERT/UPDATE
--   policies — NO DELETE policy. PostgreSQL RLS default-denies any
--   operation without a matching permissive policy → DELETE rejected
--   for all roles including anon (which is what the client uses).
--
--   Original design intent (line 54 of create script):
--     "ห้ามลบ ใช้ status superseded แทน"
--   But admin needs HARD delete to fix data-entry errors (e.g. wrong
--   patient consent, wrong destination, typo in DNR).
--
-- FIX (this file):
--   Add a permissive DELETE policy matching current RLS openness model
--   (anon has full access pre-JWT). After Phase 3 (auth JWT), this
--   policy will be tightened to admin-role-only:
--     USING (auth.jwt() ->> 'role' = 'admin')
--
-- CLIENT CODE (already correct, no change needed):
--   v2/transport/index.html line 9106 — _supabase.from('transport_consents').delete().eq('id', ver.id)
--   v2/transport/index.html line 9062 — same pattern from dashboard
--
-- DEPLOY:
--   1. Open Supabase project SQL editor (production)
--   2. Paste this file's content + Run
--   3. Verify policy exists:
--        SELECT policyname, cmd FROM pg_policies
--         WHERE tablename = 'transport_consents';
--      Should return 4 rows: Allow read / insert / update / delete access
--   4. Test: log in as admin → open old case with wrong consent → click ลบ
-- ============================================================================

CREATE POLICY "Allow delete access" ON transport_consents
  FOR DELETE USING (true);

COMMENT ON POLICY "Allow delete access" ON transport_consents IS
  'Admin hard-delete for data-entry error correction (2026-05-25). Currently open per the pre-JWT RLS model — will be restricted to admin role after Phase 3 auth/JWT lockdown.';

-- ============================================================================
-- VERIFY (run after the CREATE POLICY above)
-- ============================================================================
-- SELECT policyname, cmd, qual
--   FROM pg_policies
--  WHERE tablename = 'transport_consents'
--  ORDER BY cmd;
--
-- Expected 4 rows:
--   Allow delete access | DELETE | true
--   Allow insert access | INSERT | <wf>
--   Allow read access   | SELECT | true
--   Allow update access | UPDATE | <wf>
-- ============================================================================
