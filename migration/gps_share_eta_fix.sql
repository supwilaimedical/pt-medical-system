-- =============================================================================
-- migration/gps_share_eta_fix.sql
-- Hardens dest-lock against the RLS WITH CHECK loophole identified by audit.
-- Drops the broad anon UPDATE policy; replaces with a SECURITY DEFINER RPC
-- that only ever writes the 5 specific dest-lock columns.
-- =============================================================================

-- 1. Drop the over-permissive anon UPDATE policy
DROP POLICY IF EXISTS "anon_lock_dest" ON gps_shared_tokens;

-- 2. Create RPC — anon can call, function runs as definer, writes only the
--    intended columns. No way to escalate allow_camera, expires_at, status,
--    last_eta_*, audience, device_id, provider, created_by, ttl_hours.
CREATE OR REPLACE FUNCTION public.lock_customer_dest(
  p_token  TEXT,
  p_lat    DOUBLE PRECISION,
  p_lng    DOUBLE PRECISION,
  p_name   TEXT,
  p_source TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INT;
BEGIN
  -- Validate source — only the 2 customer-side values allowed
  IF p_source NOT IN ('customer_map_pick', 'customer_geo') THEN
    RAISE EXCEPTION 'invalid dest_source';
  END IF;

  -- Validate coordinates sane (worldwide range, but finite)
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90  OR p_lat > 90
     OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'invalid coordinates';
  END IF;

  -- Atomic update — only the 5 dest-lock columns. Race-guarded by
  -- dest_locked_at IS NULL (first writer wins).
  UPDATE gps_shared_tokens
  SET dest_lat       = p_lat,
      dest_lng       = p_lng,
      dest_name      = COALESCE(LEFT(p_name, 200), ''),  -- cap length, safe default
      dest_source    = p_source,
      dest_locked_at = NOW()
  WHERE token          = p_token
    AND status         = 'Active'
    AND expires_at     > NOW()
    AND dest_locked_at IS NULL
    AND dest_mode      = 'customer_choose';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

-- 3. Grant execute to anon role (customers viewing share link)
REVOKE ALL ON FUNCTION public.lock_customer_dest(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_customer_dest(TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO anon, authenticated;
