# Wave 9 — RLS Targeted Hardening Deploy

## What this changes

Restricts anonymous (browser) operations on 2 tables to ONLY the operations
that the frontend code actually performs. Workers continue to use service_role
and bypass RLS — no impact on worker behavior.

### notification_state

| Operation | Before | After | Rationale |
|-----------|--------|-------|-----------|
| SELECT    | allowed (FOR ALL) | allowed | realtime + ack badge |
| INSERT    | allowed (FOR ALL) | **blocked** | worker-only (service_role) |
| UPDATE    | allowed (FOR ALL) | allowed | browser ack flow (shared/notify.js:60) |
| DELETE    | allowed (FOR ALL) | **blocked** | no browser code does this |

### fa_event_tokens

| Operation | Before | After | Rationale |
|-----------|--------|-------|-----------|
| SELECT    | allowed (FOR ALL) | allowed | admin list + staff verify |
| INSERT    | allowed (FOR ALL) | allowed | admin creates token |
| UPDATE    | allowed (FOR ALL) | allowed | revoke flow (2 browser call sites) |
| DELETE    | allowed (FOR ALL) | **blocked** | no browser code does this |

### Deviation from original spec

The spec stated "Anon CANNOT UPDATE" for fa_event_tokens. Pre-flight grep
found two active UPDATE call sites in v2/firstaid/index.html (lines 1818,
2234). Blocking UPDATE would silently break revoke functionality. The UPDATE
policy is retained; DELETE is removed as the only safe reduction.

Residual risk: an anon attacker who knows a token string can revoke it (DoS
on staff access). This is accepted until Phase 3 JWT migrates revoke to a
signed worker endpoint using service_role.

## Pre-deploy verification

Before running this migration, confirm with QA that:

- [ ] Browser ack flow (clicking acknowledge on a critical alert) works in staging
- [ ] FA event token creation by admin works
- [ ] Staff token verify works
- [ ] Admin close event auto-revokes tokens

## Deploy order

1. Open Supabase Dashboard → SQL Editor
2. Open `sql/wave9_rls_targeted.sql`
3. Run SECTION 1 (notification_state block — transaction-wrapped)
4. Verify the SELECT at the end shows exactly 2 rows:
   - `notif_state_anon_read` (SELECT)
   - `notif_state_anon_ack` (UPDATE)
5. Run SECTION 2 (fa_event_tokens block — transaction-wrapped)
6. Verify the SELECT at the end shows exactly 3 rows:
   - `fa_tokens_anon_insert` (INSERT)
   - `fa_tokens_anon_read` (SELECT)
   - `fa_tokens_anon_update` (UPDATE)

## Rollback

```sql
-- notification_state rollback
DROP POLICY IF EXISTS notif_state_anon_read ON notification_state;
DROP POLICY IF EXISTS notif_state_anon_ack ON notification_state;
CREATE POLICY notif_state_anon_all ON notification_state
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- fa_event_tokens rollback
DROP POLICY IF EXISTS fa_tokens_anon_read ON fa_event_tokens;
DROP POLICY IF EXISTS fa_tokens_anon_insert ON fa_event_tokens;
DROP POLICY IF EXISTS fa_tokens_anon_update ON fa_event_tokens;
CREATE POLICY "anon_all_fa_event_tokens" ON fa_event_tokens
  FOR ALL TO anon USING (true) WITH CHECK (true);
```

## QA verification (post-deploy)

1. Open monitor → trigger critical alert → click Acknowledge → succeeds
2. Admin firstaid → create event token → token appears in list
3. Staff page → enter token → verify works
4. Admin firstaid → close event → active tokens auto-revoke
5. anon REST: `POST /rest/v1/notification_state` with anon key → expect 401/403
6. anon REST: `DELETE /rest/v1/fa_event_tokens?id=eq.<uuid>` with anon key → expect 401/403

## Phase 3 follow-up (after JWT)

Once Phase 3 signed JWT is implemented:
- Move `fa_event_tokens` INSERT + UPDATE to a service_role worker endpoint
- Remove `fa_tokens_anon_insert` and `fa_tokens_anon_update` policies
- At that point anon access on fa_event_tokens becomes SELECT-only
