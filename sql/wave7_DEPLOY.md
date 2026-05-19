# Wave 7 — Consent Atomic Re-sign Deploy Runbook

Fixes findings #24 + #25: race condition on consent re-sign when 2 devices
sign at the same moment produces 2 active rows for the same case.

---

## CRITICAL — SQL must apply BEFORE frontend code deploys

If frontend deploys first, `saveConsentToDB` calls `rpc('sign_consent_atomic')`
which does not exist yet → all sign attempts fail with "function not found."
DevOps must apply SQL first, then merge/deploy frontend.

---

## Pre-conditions

- Run against: **Supabase production project** (SQL Editor)
- DB version: Postgres 14+ (uses `gen_random_uuid`, `COALESCE`, `FOR UPDATE`)
- Extensions needed: none beyond standard Postgres
- Env/secret: no new env vars required

---

## Deployment order

### Step 1 — Open SQL file

Open `sql/wave7_consent_atomic.sql` in Supabase Dashboard → SQL Editor.

### Step 2 — Section A: Diagnostic

Copy + run Section A only.

- **0 rows returned** → no duplicates. Skip Section B, go to Step 4.
- **1+ rows returned** → duplicates exist. Record the `case_id` and `ids`
  for audit. Proceed to Step 3.

### Step 3 — Section B: Cleanup (only if Step 2 returned rows)

Copy + run the full Section B block (BEGIN through COMMIT).

The inner verification SELECT must return **0 rows** before you type COMMIT.

- 0 rows → type `COMMIT;` and run.
- Still rows → type `ROLLBACK;`, investigate manually, and resolve before
  proceeding. Do not continue until clean.

### Step 4 — Section C: Create function

Copy + run Section C.

Expected output: `CREATE FUNCTION` (or similar success message from Supabase).

No error = function is live.

### Step 5 — Section D: Create unique index

Copy + run Section D.

- Success → index created. Constraint is now enforced at DB level.
- Error "duplicate key" → Section B did not fully clean all duplicates.
  Re-run Section A to find the remaining conflict, supersede manually,
  retry Section D.

### Step 6 — Smoke test the function

In SQL Editor, run the smoke-check block at the bottom of the file
(the commented-out `SELECT sign_consent_atomic(...)` block — uncomment it).

Expected result: `{"id": "<some-uuid>", "version": 1}`

Then clean up: `DELETE FROM transport_consents WHERE case_id = 'TEST-WAVE7-DELETE-ME';`

### Step 7 — Deploy frontend

Now it is safe to deploy this commit's frontend changes.

`saveConsentToDB` in `v2/transport/index.html` now calls
`_supabase.rpc('sign_consent_atomic', ...)` instead of the 3-call flow.

---

## Rollback procedure

**If Section D fails:** fix remaining duplicates (Section B), retry Section D.

**If function returns errors after frontend deploys:**
1. Revert this commit's frontend changes (or hot-patch `saveConsentToDB`
   back to the 3-call flow).
2. The old flow still works — the schema is intact and backward-compatible.
3. The unique index is NOT rolled back (it is additive and safe to keep).
4. Investigate the function error, fix, redeploy.

**Unique index rollback (only if explicitly needed):**
```sql
DROP INDEX IF EXISTS idx_transport_consents_one_active;
```

---

## QA test scenarios

1. **Single sign** — sign consent on a new case. Verify `transport_consents`
   has exactly 1 row with `status='active'`, `version=1`.

2. **Re-sign (sequential)** — sign again on the same case. Verify old row
   now has `status='superseded'`, `superseded_at` is set. New row has
   `status='active'`, `version=2`.

3. **Race simulation (2 browser tabs)** — open same case in 2 tabs,
   click sign simultaneously. One should succeed; the other should either
   succeed as version 3 (sequential due to lock) or show an error if the
   unique index fires. Verify only 1 active row exists afterwards.

4. **DNR auto-set** — sign a consent with DNR items checked. Verify
   `cases.raw_data.rawSnapshot.nr_status` = `'DNR'` in the DB.

5. **Consent version badge** — after re-sign, verify the dashboard
   consent badge updates to the new version number.

---

## Hand-off

1. **devops-engineer** — apply SQL (Steps 1–6 above) then deploy this commit.
2. **qa-engineer** — run QA scenarios 1–5 above in staging then production.
