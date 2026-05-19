-- =============================================
-- Wave 7 — Consent Atomic Re-sign
-- Findings #24 + #25: race condition on re-sign
-- =============================================
-- APPLY ORDER: Section A → (B if needed) → C → D
-- NEVER edit this file after applying to prod.
-- =============================================


-- ─────────────────────────────────────────────
-- SECTION A: Diagnostic — find duplicate actives
-- Run this FIRST.
-- If result > 0 rows: run Section B before Section D.
-- If 0 rows: skip Section B.
-- ─────────────────────────────────────────────
SELECT
    case_id,
    COUNT(*)          AS active_count,
    array_agg(id)     AS ids,
    array_agg(version) AS versions
FROM transport_consents
WHERE status = 'active'
GROUP BY case_id
HAVING COUNT(*) > 1;


-- ─────────────────────────────────────────────
-- SECTION B: Cleanup duplicate actives
-- Policy: keep MAX(version) as active, supersede the rest.
-- Wrapped in transaction. Run only if Section A returned rows.
-- After the inner verification SELECT returns 0 rows → COMMIT.
-- If still > 0 rows → ROLLBACK and investigate manually.
-- ─────────────────────────────────────────────
BEGIN;

WITH dupes AS (
    SELECT case_id, MAX(version) AS keep_version
    FROM transport_consents
    WHERE status = 'active'
    GROUP BY case_id
    HAVING COUNT(*) > 1
)
UPDATE transport_consents tc
SET
    status        = 'superseded',
    superseded_at = NOW(),
    superseded_reason = 'ล้างข้อมูล duplicate active (wave7 pre-flight)'
FROM dupes
WHERE tc.case_id    = dupes.case_id
  AND tc.status     = 'active'
  AND tc.version    < dupes.keep_version;

-- Verification: must return 0 rows before committing.
SELECT
    case_id,
    COUNT(*) AS active_count
FROM transport_consents
WHERE status = 'active'
GROUP BY case_id
HAVING COUNT(*) > 1;
-- If above returns 0 rows: type COMMIT below and run.
-- If above returns > 0 rows: type ROLLBACK and investigate.

COMMIT;


-- ─────────────────────────────────────────────
-- SECTION C: Postgres function sign_consent_atomic
-- Single-transaction supersede + insert with FOR UPDATE lock.
-- Eliminates race window entirely.
--
-- Assumptions:
--   - Postgres 14+ (gen_random_uuid available)
--   - Table: transport_consents with columns verified against
--     create_transport_consents.sql + add_witness_signature.sql
--   - No 'lang' column exists — parameter excluded
--   - SECURITY DEFINER so RLS on the table does not gate this path;
--     the function itself is the only write path for re-signing.
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sign_consent_atomic(
    p_case_id                   TEXT,
    p_consent_data              JSONB,
    p_signature_image           TEXT,
    p_signed_by                 TEXT,
    p_relationship              TEXT,
    p_witness_name              TEXT,
    p_witness_signature_image   TEXT,
    p_signed_at                 TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing_max  INT;
    v_new_version   INT;
    v_new_id        UUID;
BEGIN
    -- Serialize concurrent calls for the SAME case_id using a transaction-scoped
    -- advisory lock. We can't use SELECT ... FOR UPDATE with MAX() — Postgres
    -- rejects FOR UPDATE on aggregates (ERROR 0A000). Advisory lock by case_id
    -- hash gives the same "one signer at a time per case" guarantee. The partial
    -- unique index idx_transport_consents_one_active is the defense-in-depth.
    PERFORM pg_advisory_xact_lock(hashtext('consent_' || p_case_id));

    SELECT COALESCE(MAX(version), 0)
    INTO v_existing_max
    FROM transport_consents
    WHERE case_id = p_case_id;

    v_new_version := v_existing_max + 1;

    -- Supersede the current active row (if any).
    UPDATE transport_consents
    SET
        status            = 'superseded',
        superseded_at     = NOW(),
        superseded_reason = 'เซ็นใหม่ version ' || v_new_version
    WHERE case_id = p_case_id
      AND status  = 'active';

    -- Insert new active row.
    INSERT INTO transport_consents (
        case_id,
        version,
        status,
        consent_data,
        signature_image,
        signed_by,
        relationship,
        witness_name,
        witness_signature_image,
        signed_at,
        created_at
    ) VALUES (
        p_case_id,
        v_new_version,
        'active',
        p_consent_data,
        p_signature_image,
        p_signed_by,
        p_relationship,
        p_witness_name,
        p_witness_signature_image,
        COALESCE(p_signed_at, NOW()),
        NOW()
    )
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
        'id',      v_new_id,
        'version', v_new_version
    );
END;
$$;

-- Grant execute to browser-facing roles.
-- SECURITY DEFINER means the function runs as the owner (bypasses RLS on
-- transport_consents for insert/update). SELECT still goes through RLS.
GRANT EXECUTE ON FUNCTION sign_consent_atomic(
    TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO anon;

GRANT EXECUTE ON FUNCTION sign_consent_atomic(
    TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ
) TO authenticated;


-- ─────────────────────────────────────────────
-- SECTION D: Partial unique index — one active per case
-- Enforces "at most 1 active row per case_id" at DB level.
-- Run AFTER Section B (cleanup). If duplicates still exist,
-- index creation fails with "duplicate key value" — fix and retry.
-- ─────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_consents_one_active
ON transport_consents (case_id)
WHERE status = 'active';

-- Smoke-check: call function with a test case_id and inspect result.
-- SELECT sign_consent_atomic(
--     'TEST-WAVE7-DELETE-ME',
--     '{"test": true}'::jsonb,
--     'sig_placeholder',
--     'Tester',
--     'ตัวเอง',
--     'Witness A',
--     'wit_sig_placeholder',
--     NOW()
-- );
-- Expected: {"id": "<uuid>", "version": 1}
-- Cleanup: DELETE FROM transport_consents WHERE case_id = 'TEST-WAVE7-DELETE-ME';
