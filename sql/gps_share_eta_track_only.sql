-- =============================================================================
-- migration/gps_share_eta_track_only.sql
-- Adds 'none' to gps_shared_tokens.dest_mode CHECK constraint.
-- Enables track-only share links (no destination, no ETA computation).
-- Idempotent — drops the old named constraint if present, then re-adds.
-- =============================================================================

-- The constraint added by ALTER TABLE ... ADD COLUMN ... CHECK (...) is an
-- anonymous column-level CHECK whose name PostgreSQL auto-generates as
-- "<table>_<column>_check". Drop by that name, then re-add with the wider set.

ALTER TABLE gps_shared_tokens
  DROP CONSTRAINT IF EXISTS gps_shared_tokens_dest_mode_check;

ALTER TABLE gps_shared_tokens
  ADD CONSTRAINT gps_shared_tokens_dest_mode_check
  CHECK (dest_mode IN ('paramedic_set', 'customer_choose', 'none'));
