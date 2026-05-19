-- ============================================================================
-- WAVE 9 — Targeted RLS hardening (truly low-risk subset only)
-- ============================================================================
-- Applies to 2 tables: notification_state, fa_event_tokens.
-- Workers use SUPABASE_SERVICE_KEY (service_role) — bypasses RLS entirely.
-- Only anon (browser) operations are restricted.
--
-- PRE-FLIGHT RESULTS (grepped 2026-05-19 against v2/ + shared/):
--   notification_state : INSERT=0, DELETE=0, UPDATE=1, SELECT=realtime-only
--   fa_event_tokens    : INSERT=1, DELETE=0, UPDATE=2, SELECT=2
--
-- DEVIATION FROM SPEC for fa_event_tokens:
--   Spec said "anon CANNOT UPDATE", but two browser call sites were found:
--     - v2/firstaid/index.html:1818  (auto-revoke on close event)
--     - v2/firstaid/index.html:2234  (manual revoke via fa_revokeToken)
--   Both are active revoke flows — disabling UPDATE would silently break them.
--   Residual risk: anon can DoS staff token access (revoke arbitrary tokens).
--   Mitigated fully only after Phase 3 JWT moves revoke to service_role worker.
--   Wave 9 removes DELETE only — reducing surface without breaking functionality.
-- ============================================================================


-- ============================================================================
-- SECTION 1 — notification_state
-- ============================================================================
-- Replaces FOR ALL anon policy with explicit SELECT + UPDATE only.
-- Workers INSERT/UPSERT and never DELETE via anon — service_role bypasses RLS.
-- ============================================================================

BEGIN;

-- Drop the broad FOR ALL policy
DROP POLICY IF EXISTS notif_state_anon_all ON notification_state;

-- SELECT: browser needs SELECT permission for realtime subscriptions + ack badge
CREATE POLICY notif_state_anon_read ON notification_state
  FOR SELECT TO anon USING (true);

-- UPDATE: browser ack flow flips acknowledged=true (shared/notify.js:60)
-- Field-level restriction (only acknowledged/acknowledged_at/acknowledged_by)
-- deferred to Phase 3 JWT when row ownership is established.
CREATE POLICY notif_state_anon_ack ON notification_state
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- Verify (run this SELECT to confirm exactly 2 policies exist after migration)
SELECT policyname, cmd, roles, qual::text, with_check::text
FROM pg_policies
WHERE tablename = 'notification_state'
ORDER BY cmd;

COMMIT;


-- ============================================================================
-- SECTION 2 — fa_event_tokens
-- ============================================================================
-- Replaces FOR ALL anon policy with explicit SELECT + INSERT + UPDATE only.
-- DELETE is removed: no browser code performs DELETE on this table.
--
-- Residual risk acknowledged: anon UPDATE allows token revoke by any browser
-- caller. This will be tightened in Phase 3 by moving revoke to a signed
-- worker endpoint that uses service_role.
-- ============================================================================

BEGIN;

-- Drop the broad FOR ALL policy
DROP POLICY IF EXISTS "anon_all_fa_event_tokens" ON fa_event_tokens;

-- SELECT: admin lists tokens (v2/firstaid/index.html:2099)
--         staff verifies token (v2/firstaid/staff.html:479)
CREATE POLICY fa_tokens_anon_read ON fa_event_tokens
  FOR SELECT TO anon USING (true);

-- INSERT: admin creates token (v2/firstaid/index.html:2179)
--         admin auth is currently localStorage-based, uses anon key.
--         Will migrate to service_role worker in Phase 3.
CREATE POLICY fa_tokens_anon_insert ON fa_event_tokens
  FOR INSERT TO anon WITH CHECK (true);

-- UPDATE: revoke flow sets status='Revoked'
--         - auto-revoke on close event (v2/firstaid/index.html:1818)
--         - manual revoke (v2/firstaid/index.html:2234)
--         DELETE is intentionally excluded — no browser code uses it.
CREATE POLICY fa_tokens_anon_update ON fa_event_tokens
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- Verify (run this SELECT to confirm exactly 3 policies exist after migration)
SELECT policyname, cmd, roles, qual::text, with_check::text
FROM pg_policies
WHERE tablename = 'fa_event_tokens'
ORDER BY cmd;

COMMIT;
