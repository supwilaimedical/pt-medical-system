# Wave 8 — Optimistic Concurrency Control Deploy Runbook

Fixes Race C (2 devices close the same case simultaneously → last-write-wins wipes vitals)
and Race E (2 devices add vitals + save before realtime delivers → only one entry persists).

---

## CRITICAL — atomic deploy required

The frontend commit replaces `upsert` with `insert` (new case) / `update + version predicate`
(existing case). If the SQL has **not** been applied yet:

- New cases: `INSERT` will succeed (no change in INSERT behavior).
- Existing cases: `UPDATE WHERE row_version = _loadedRowVersion` — this column does not exist
  yet → Supabase returns an error "column row_version does not exist" → every save fails.

**SQL MUST apply first. Deploy frontend second.**

---

## Pre-conditions

- Target: **Supabase production project** (SQL Editor)
- DB version: Postgres 14+ (uses `COALESCE`, `BEFORE INSERT OR UPDATE` trigger)
- Extensions needed: none
- Env/secret: no new env vars required

---

## Deployment order

### Step 1 — Open SQL file

Open `sql/wave8_occ.sql` in Supabase Dashboard → SQL Editor.

### Step 2 — Section A: Diagnostic

Copy + run Section A only.

- **0 rows returned** (no `row_version` column): column does not exist. Proceed to Step 3.
- **1 row returned** (column already exists): Section B has been applied before. Skip to Step 4.
- Check the `total_cases` count. If > 100,000 rows, the UPDATE in Section B may take a few
  seconds. This is expected; the transaction holds a brief lock.

### Step 3 — Section B: Add column + backfill

Copy + run the full Section B block (BEGIN through COMMIT).

Before committing, verify the inner SELECT returns **0 rows** (no nulls left).

- 0 rows → run `COMMIT;`.
- Non-zero → run `ROLLBACK;`, investigate (unusual — implies rows were inserted between
  the UPDATE and the check), then re-run from Section B.

### Step 4 — Section C: Create trigger function

Copy + run Section C.

Expected output: `CREATE FUNCTION` then `CREATE TRIGGER`.

### Step 5 — Section D: Smoke test

Run all three blocks (D1, D2, D3) in sequence.

| Block | Expected |
|-------|----------|
| D1 INSERT | `row_version = 1` |
| D2 UPDATE | `row_version = 2` |
| D3 Cleanup | `leftover = 0` |

If any block returns unexpected values, **stop** and investigate before deploying frontend.

### Step 6 — Verify in Dashboard

Supabase Dashboard → Table Editor → `cases` → confirm `row_version` column appears
with default `1` and existing rows show `row_version = 1`.

### Step 7 — Deploy frontend

Merge / deploy the Wave 8 frontend commit.

`saveData` in `v2/transport/index.html` now:
- Captures `_loadedRowVersion` on case open and after each successful save.
- Uses `UPDATE WHERE row_version = _loadedRowVersion` for existing cases.
- On 0-rows-updated (version mismatch): shows "ข้อมูลถูกอัปเดตจากเครื่องอื่น" toast,
  triggers `_scheduleRemoteCaseMerge` to pull latest, asks user to re-save manually.

---

## Rollback procedure

**Frontend only (if version-check logic breaks UX):**

```
git revert <frontend-commit-hash>
```

The `cases` table retains `row_version` (column default 1 is harmless). The old `upsert`
frontend code ignores unknown columns, so old and new frontend code coexist safely.

**Full rollback (remove column + trigger):**

```sql
DROP TRIGGER IF EXISTS cases_bump_row_version_trg ON cases;
DROP FUNCTION IF EXISTS cases_bump_row_version();
ALTER TABLE cases DROP COLUMN IF EXISTS row_version;
```

---

## QA test scenarios

### Scenario 1 — 2-tab concurrent close (Race C)

1. Open the same active case in 2 browser tabs (Tab A, Tab B).
2. In Tab A, add a vitals entry. Do NOT save yet.
3. In Tab B, click "ปิดเคส" → save succeeds → `row_version` becomes 2.
4. In Tab A, click "ปิดเคส".

**Expected:** Tab A sees "ข้อมูลถูกอัปเดตจากเครื่องอื่น" toast (orange warning).
Form auto-refreshes with latest data. Tab A must re-save manually.
DB after both operations: exactly 1 closed case with Tab B's data intact.

### Scenario 2 — 2-tab concurrent vitals add (Race E)

1. Open the same active case in 2 browser tabs.
2. Tab A adds vitals entry X, Tab B adds vitals entry Y (different entries).
3. Both click Save before realtime delivers.

**Expected:** One tab saves first (succeeds), second tab gets version conflict toast,
triggers re-merge which brings in the first tab's vitals. User re-saves → both X and Y
are present.

### Scenario 3 — Normal save on existing pre-Wave-8 case

1. Open a case created before Wave 8 (row_version = 1 from backfill).
2. Edit any field. Click Save.

**Expected:** Save succeeds. `_loadedRowVersion` updates to 2 (returned by `.select('row_version')`).
Subsequent saves increment normally.

### Scenario 4 — New case create

1. Click "เคสใหม่". Fill form. Click Save.

**Expected:** INSERT succeeds. `_loadedRowVersion` captures `row_version = 1` from server.
Subsequent saves use UPDATE path with version check.

### Scenario 5 — Realtime self-echo after save

1. Save a case (any).
2. Realtime delivers the update back to the same tab.

**Expected:** `_handleRemoteCaseUpdate` triggers merge. Merge detects
current === loaded === remote (baseline was re-snapshotted after save) → no-op.
`_loadedRowVersion` updated to match server's version (same value). No toast, no UI disruption.

---

## Hand-off

1. **devops-engineer** — apply SQL Steps 1–6, confirm smoke test passes, then deploy frontend commit.
2. **qa-engineer** — execute Scenarios 1–5 in staging before production cutover.
