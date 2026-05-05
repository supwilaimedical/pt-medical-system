-- =============================================
-- First-Aid Staff Token Feature (Supwilai V2)
-- =============================================
-- Ported from TheGood (2026-05-05). Differences from TheGood spec:
--   - Skipped policies on fa_registry / fa_events (Supwilai already grants
--     full anon CRUD via migration/add_anon_policies.sql — auth flow uses
--     GAS HR API, not Supabase Auth)
--   - Only the new fa_event_tokens table needs RLS here.
--
-- Run this once in the Supwilai Supabase SQL Editor.
-- =============================================

CREATE TABLE IF NOT EXISTS fa_event_tokens (
  token        TEXT PRIMARY KEY,                                    -- 6 chars (A-Z minus O/I, 2-9 minus 0/1)
  event_id     TEXT REFERENCES fa_events(event_id) ON DELETE CASCADE,
  worker_name  TEXT NOT NULL,
  location_tx  TEXT,                                                -- จุดรักษา; NULL = ทุกจุด
  status       TEXT DEFAULT 'Active',                               -- 'Active' | 'Revoked'
  created_by   TEXT,                                                -- admin user that issued the token
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fa_event_tokens_event_idx  ON fa_event_tokens(event_id);
CREATE INDEX IF NOT EXISTS fa_event_tokens_status_idx ON fa_event_tokens(status);

-- RLS — Supwilai uses GAS HR API for auth, so anon role does everything client-side
ALTER TABLE fa_event_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_fa_event_tokens" ON fa_event_tokens;
CREATE POLICY "anon_all_fa_event_tokens" ON fa_event_tokens
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Optional: also grant to authenticated (in case future Supabase Auth migration)
DROP POLICY IF EXISTS "auth_all_fa_event_tokens" ON fa_event_tokens;
CREATE POLICY "auth_all_fa_event_tokens" ON fa_event_tokens
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================
-- Atomic supply counter — fixes race condition between admin & staff
-- =============================================
-- Without this RPC, every "+/-" click does:  read → +1 → write
-- → if 2 users click at the same time, one increment is LOST.
--
-- This RPC does the increment AT THE DATABASE inside one statement —
-- safe under any concurrency. Returns the new value so the UI can
-- echo it without re-fetching.
--
-- Allowed fields (whitelisted to prevent SQL injection via dynamic SQL):
--   q_ammonia, q_plaster, q_spray, q_wound, q_meds
-- =============================================
CREATE OR REPLACE FUNCTION fa_bump_supply(
  p_event_id TEXT,
  p_field    TEXT,
  p_delta    INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_val INT;
BEGIN
  -- Whitelist field names — never trust caller string in dynamic SQL
  IF p_field NOT IN ('q_ammonia','q_plaster','q_spray','q_wound','q_meds') THEN
    RAISE EXCEPTION 'Invalid field: %', p_field;
  END IF;

  EXECUTE format(
    'UPDATE fa_events SET %1$I = GREATEST(0, COALESCE(%1$I,0) + $1) WHERE event_id = $2 RETURNING %1$I',
    p_field
  )
  USING p_delta, p_event_id
  INTO new_val;

  RETURN COALESCE(new_val, 0);
END;
$$;

-- Allow anon + authenticated to call (mirrors RLS model on fa_events)
GRANT EXECUTE ON FUNCTION fa_bump_supply(TEXT, TEXT, INT) TO anon, authenticated;
