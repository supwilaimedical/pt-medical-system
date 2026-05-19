-- ============================================================================
-- WAVE 6B -- Performance Indexes (#47, #48, #49)
-- ============================================================================
-- Apply via: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- All indexes use IF NOT EXISTS -- idempotent, safe to re-run
-- ============================================================================

-- #47: notification_log (alert_type, created_at DESC)
-- Optimises the critical-log query:
--   WHERE alert_type='CRITICAL' ORDER BY created_at DESC LIMIT 50
-- Existing indexes are (created_at) and (case_id) -- neither covers this
-- filter+sort combo efficiently.
CREATE INDEX IF NOT EXISTS idx_notif_log_alert_created
  ON notification_log (alert_type, created_at DESC);

-- #48: cases (status, created_at DESC)
-- Hot path: monitor loadMonitor() runs
--   SELECT ... WHERE status='Active' ORDER BY created_at DESC
-- Triggered on every realtime burst (debounced 1.5 s).
CREATE INDEX IF NOT EXISTS idx_cases_status_created
  ON cases (status, created_at DESC);

-- #49: fa_registry (event_id)
-- Supports the batched .in('event_id', [...]) query added in Wave 6B Fix 3.
-- Even with batching, a seq-scan on large fa_registry tables is expensive;
-- this index makes the IN lookup an index-scan.
CREATE INDEX IF NOT EXISTS idx_fa_registry_event
  ON fa_registry (event_id);
