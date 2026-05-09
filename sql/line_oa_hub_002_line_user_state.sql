-- Stateful conversation flag for LINE bot.
-- Lets the bot remember "user just clicked X, expect their next text to be Y".
-- e.g. user clicks 'ค้นหาสถานที่' → store action='location_search' with short TTL.
-- Next text message from that line_user_id is treated as the search query.

CREATE TABLE IF NOT EXISTS line_user_state (
  line_user_id TEXT PRIMARY KEY,
  action       TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lus_expires ON line_user_state(expires_at);

ALTER TABLE line_user_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full" ON line_user_state;
CREATE POLICY "service_role_full"
  ON line_user_state FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
