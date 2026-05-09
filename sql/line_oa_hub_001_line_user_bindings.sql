-- Migration: 001_line_user_bindings
-- Line OA Hub: binding table between LINE userId and HR employee
-- Run via Supabase SQL Editor (service_role)

CREATE TABLE line_user_bindings (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  line_user_id    TEXT NOT NULL,
  employee_id     TEXT NOT NULL,
  employee_name   TEXT NOT NULL,
  employee_role   TEXT DEFAULT 'Employee',
  company         TEXT DEFAULT 'supwilai',
  line_display_name TEXT,
  line_picture_url  TEXT,
  bound_at        TIMESTAMPTZ DEFAULT NOW(),
  is_active       BOOLEAN DEFAULT true,

  CONSTRAINT uq_line_user  UNIQUE (line_user_id, company),
  CONSTRAINT uq_employee   UNIQUE (employee_id, company)
);

CREATE INDEX idx_lub_line_user ON line_user_bindings(line_user_id);
CREATE INDEX idx_lub_employee  ON line_user_bindings(employee_id);
CREATE INDEX idx_lub_company   ON line_user_bindings(company);

ALTER TABLE line_user_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full"
  ON line_user_bindings FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
