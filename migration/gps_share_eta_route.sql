-- =============================================================================
-- migration/gps_share_eta_route.sql
-- Phase 2: Directions API polyline storage on gps_shared_tokens.
-- Idempotent.
-- =============================================================================

ALTER TABLE gps_shared_tokens
  ADD COLUMN IF NOT EXISTS route_polyline    TEXT,
  ADD COLUMN IF NOT EXISTS route_updated_at  TIMESTAMPTZ;
