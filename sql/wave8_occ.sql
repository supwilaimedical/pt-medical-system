-- =============================================
-- Wave 8 — Optimistic Concurrency Control
-- Fixes Race C (concurrent close) + Race E (concurrent vitals add)
-- on the cases table using a row_version counter.
-- =============================================
-- APPLY ORDER: Section A → B → C → D
-- NEVER edit this file after applying to prod.
-- =============================================


-- ─────────────────────────────────────────────
-- SECTION A: Diagnostic
-- Run this FIRST to confirm idempotency.
-- If row_version column already exists → skip Section B, go to C.
-- If 0 rows returned → column does not exist yet → run Section B.
-- ─────────────────────────────────────────────
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name   = 'cases'
  AND column_name  = 'row_version';

-- Also check approximate row count (to gauge ALTER TABLE duration):
SELECT COUNT(*) AS total_cases FROM cases;


-- ─────────────────────────────────────────────
-- SECTION B: Add column + backfill + NOT NULL
-- Wrapped in a transaction.
-- ALTER TABLE on an existing table is non-blocking in Postgres 14+
-- when adding a nullable column first, then backfilling, then constraining.
-- ─────────────────────────────────────────────
BEGIN;

-- Step 1: Add column nullable (fast metadata-only operation)
ALTER TABLE cases ADD COLUMN IF NOT EXISTS row_version int;

-- Step 2: Backfill all existing rows to version 1
UPDATE cases SET row_version = 1 WHERE row_version IS NULL;

-- Step 3: Enforce NOT NULL + default for future INSERTs
ALTER TABLE cases ALTER COLUMN row_version SET NOT NULL;
ALTER TABLE cases ALTER COLUMN row_version SET DEFAULT 1;

-- Verify backfill before commit
SELECT COUNT(*) AS rows_with_null_version
FROM cases
WHERE row_version IS NULL;
-- Expected: 0

COMMIT;


-- ─────────────────────────────────────────────
-- SECTION C: Trigger — auto-increment on UPDATE
-- INSERT: column default (1) already handles it.
-- UPDATE: trigger increments from OLD.row_version.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cases_bump_row_version()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Increment from the previous row version.
        -- COALESCE handles the edge case where OLD.row_version was somehow NULL
        -- (e.g., rows inserted before this trigger existed).
        NEW.row_version := COALESCE(OLD.row_version, 0) + 1;
    END IF;
    -- For INSERT: the column DEFAULT 1 handles it; trigger does not override.
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cases_bump_row_version_trg ON cases;
CREATE TRIGGER cases_bump_row_version_trg
    BEFORE INSERT OR UPDATE ON cases
    FOR EACH ROW
    EXECUTE FUNCTION cases_bump_row_version();


-- ─────────────────────────────────────────────
-- SECTION D: Smoke test
-- Run ALL three blocks in sequence. Clean up at the end.
-- ─────────────────────────────────────────────

-- Block D1: INSERT — expect row_version = 1
INSERT INTO cases (case_id, status, opened_by, opened_at, raw_data)
VALUES (
    'TEST-OCC-' || extract(epoch from now())::bigint::text,
    'Active',
    'occ-smoke-test',
    now(),
    '{}'::jsonb
);

SELECT case_id, row_version
FROM cases
WHERE case_id LIKE 'TEST-OCC-%'
ORDER BY opened_at DESC
LIMIT 1;
-- Expected: row_version = 1


-- Block D2: UPDATE — expect row_version = 2
UPDATE cases
SET status = 'Active'
WHERE case_id LIKE 'TEST-OCC-%';

SELECT case_id, row_version
FROM cases
WHERE case_id LIKE 'TEST-OCC-%'
ORDER BY opened_at DESC
LIMIT 1;
-- Expected: row_version = 2


-- Block D3: Cleanup
DELETE FROM cases WHERE case_id LIKE 'TEST-OCC-%';
SELECT COUNT(*) AS leftover FROM cases WHERE case_id LIKE 'TEST-OCC-%';
-- Expected: 0
