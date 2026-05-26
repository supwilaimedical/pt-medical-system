-- =============================================================================
-- migration/gps_share_eta.sql
-- Extends gps_shared_tokens with destination + ETA cache columns.
-- Idempotent — safe to re-run.
-- Reference: docs/superpowers/specs/2026-05-26-gps-shared-eta-design.md §4
-- =============================================================================

-- 1. Add 10 columns (all IF NOT EXISTS for idempotency)
ALTER TABLE gps_shared_tokens
  ADD COLUMN IF NOT EXISTS ttl_hours        INT  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dest_mode        TEXT NOT NULL DEFAULT 'paramedic_set'
    CHECK (dest_mode IN ('paramedic_set', 'customer_choose')),
  ADD COLUMN IF NOT EXISTS dest_lat         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dest_lng         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS dest_name        TEXT,
  ADD COLUMN IF NOT EXISTS dest_source      TEXT
    CHECK (dest_source IN ('link', 'search', 'preset', 'map_click',
                           'customer_map_pick', 'customer_geo') OR dest_source IS NULL),
  ADD COLUMN IF NOT EXISTS dest_locked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS audience         TEXT
    CHECK (audience IN ('family', 'contractor') OR audience IS NULL),
  ADD COLUMN IF NOT EXISTS last_eta_seconds INT,
  ADD COLUMN IF NOT EXISTS last_eta_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_distance_m  INT;

-- 2. Indexes for Worker cooldown + paramedic list view
CREATE INDEX IF NOT EXISTS gps_shared_tokens_token_active_idx
  ON gps_shared_tokens (token)
  WHERE status = 'Active';

CREATE INDEX IF NOT EXISTS gps_shared_tokens_created_by_active_idx
  ON gps_shared_tokens (created_by, expires_at DESC)
  WHERE status = 'Active';

-- 3. Anon UPDATE policy for customer-side destination lock
-- ONLY allows transitioning from "not locked" → "locked" with customer source values.
-- Existing anon_select_active policy stays; this adds the narrow UPDATE permission.
DROP POLICY IF EXISTS "anon_lock_dest" ON gps_shared_tokens;
CREATE POLICY "anon_lock_dest" ON gps_shared_tokens
  FOR UPDATE TO anon
  USING (
    status = 'Active'
    AND expires_at > NOW()
    AND dest_locked_at IS NULL
    AND dest_mode = 'customer_choose'
  )
  WITH CHECK (
    status = 'Active'
    AND dest_locked_at IS NOT NULL
    AND dest_lat IS NOT NULL
    AND dest_lng IS NOT NULL
    AND dest_source IN ('customer_map_pick', 'customer_geo')
  );

-- 4. Seed a TEST token for Phase 1 Worker verification (will be deleted after Phase 4)
INSERT INTO gps_shared_tokens (
  token, device_id, provider, expires_at, created_by, reason,
  status, ttl_hours, dest_mode, dest_lat, dest_lng, dest_name,
  dest_source, dest_locked_at
) VALUES (
  'TK-TESTSEED', '51041', NULL, NOW() + INTERVAL '4 hours', 'system-test',
  'Phase 1 Worker /api/eta/refresh verification — DELETE after Phase 4',
  'Active', 4, 'paramedic_set', 15.7008, 100.1362, 'รพ.ร่มฉัตร (test)',
  'manual', NOW()
) ON CONFLICT (token) DO UPDATE
  SET expires_at = EXCLUDED.expires_at,
      dest_lat = EXCLUDED.dest_lat,
      dest_lng = EXCLUDED.dest_lng,
      dest_locked_at = NOW();
