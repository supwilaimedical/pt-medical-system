-- Mirror of line-oa-hub/sql/003_line_bindings_partial_unique.sql
-- See canonical file at F:\@Coding\line-oa-hub\sql\003_line_bindings_partial_unique.sql

ALTER TABLE line_user_bindings
  DROP CONSTRAINT IF EXISTS uq_employee,
  DROP CONSTRAINT IF EXISTS uq_line_user;

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_active
  ON line_user_bindings (employee_id, company)
  WHERE is_active = true;

CREATE UNIQUE INDEX IF NOT EXISTS uq_line_user_active
  ON line_user_bindings (line_user_id, company)
  WHERE is_active = true;

ALTER TABLE line_user_bindings
  ADD COLUMN IF NOT EXISTS unbound_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unbound_by  TEXT,
  ADD COLUMN IF NOT EXISTS unbound_reason TEXT;
