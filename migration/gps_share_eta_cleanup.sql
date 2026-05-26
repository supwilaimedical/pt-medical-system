-- =============================================================================
-- migration/gps_share_eta_cleanup.sql
-- DB hygiene for gps_shared_tokens — when a token is revoked or expires,
-- clear heavy ephemeral columns (polyline, ETA cache) immediately.
-- Idempotent.
-- =============================================================================

-- 1. BEFORE UPDATE trigger — auto-clear heavy fields on Revoke
CREATE OR REPLACE FUNCTION public.gps_shared_tokens_clear_on_revoke()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- When status transitions to Revoked, drop ephemeral data
  IF NEW.status = 'Revoked' AND OLD.status <> 'Revoked' THEN
    NEW.route_polyline    := NULL;
    NEW.route_updated_at  := NULL;
    NEW.last_eta_seconds  := NULL;
    NEW.last_eta_at       := NULL;
    NEW.last_distance_m   := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gps_shared_tokens_clear_on_revoke ON gps_shared_tokens;
CREATE TRIGGER trg_gps_shared_tokens_clear_on_revoke
  BEFORE UPDATE ON gps_shared_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.gps_shared_tokens_clear_on_revoke();

-- 2. Cleanup function — call periodically (manual or via pg_cron) to:
--    a) clear heavy fields on tokens whose expires_at has passed
--    b) DELETE tokens that are Revoked AND older than 7 days OR Expired AND
--       older than 30 days (retention window for audit, then purge)
CREATE OR REPLACE FUNCTION public.gps_shared_tokens_cleanup()
RETURNS TABLE(cleared_count INT, deleted_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cleared INT;
  v_deleted INT;
BEGIN
  -- a) Clear heavy fields on tokens past expires_at (kept for short audit)
  UPDATE gps_shared_tokens
  SET route_polyline    = NULL,
      route_updated_at  = NULL,
      last_eta_seconds  = NULL,
      last_eta_at       = NULL,
      last_distance_m   = NULL
  WHERE expires_at < NOW()
    AND route_polyline IS NOT NULL;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  -- b) Permanently DELETE old Revoked + very old Expired rows
  DELETE FROM gps_shared_tokens
  WHERE (status = 'Revoked' AND created_at < NOW() - INTERVAL '7 days')
     OR (expires_at < NOW() - INTERVAL '30 days');
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_cleared, v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.gps_shared_tokens_cleanup() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gps_shared_tokens_cleanup() TO authenticated;

-- 3. Manual run example (call once after deploy to clean any backlog):
-- SELECT * FROM public.gps_shared_tokens_cleanup();
