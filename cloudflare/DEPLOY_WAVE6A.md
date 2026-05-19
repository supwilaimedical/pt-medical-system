# Wave 6A Deploy Runbook — Worker Authentication

## CRITICAL — atomic deploy required

Notifications WILL STOP if you deploy the updated worker code **before** updating the
Supabase webhook header. The new code rejects requests without `Authorization: Bearer <SECRET>`,
so Supabase will receive `401 Unauthorized` and stop retrying.

**Follow the exact order below.**

---

## Pre-flight (do before any deploy)

1. **Generate 2 secrets** — each must be 32+ random characters:

   ```powershell
   # Option A: PowerShell (copy each value carefully — no trailing newline in variable)
   $WEBHOOK_SECRET = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
   $WORKER_SECRET  = [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
   Write-Host "WEBHOOK_SECRET = $WEBHOOK_SECRET"
   Write-Host "WORKER_SECRET  = $WORKER_SECRET"
   ```

   ```bash
   # Option B: openssl (Linux/macOS/Git Bash)
   openssl rand -base64 32   # run twice — one per secret
   ```

   Store both values securely (password manager). You will need them in steps 1 and 3.

2. **Confirm wrangler CLI** is installed and authenticated:

   ```powershell
   wrangler whoami
   ```

3. **Have the Supabase Dashboard open** at:
   Database → Webhooks → (find the webhook pointing to `/notify/check`) → ready to edit.

4. **Confirm no active incidents** — avoid deploying during a live critical patient event.

---

## Deploy order (must be in this exact order)

### Step 1 — Set worker secrets in Cloudflare

> **Windows PowerShell gotcha:** `Read-Host | wrangler secret put` or `echo | wrangler secret put`
> adds a trailing newline that becomes part of the secret value, causing auth mismatches.
> Use the Cloudflare REST API method below instead.

**Option A — Cloudflare REST API (recommended on Windows):**

```powershell
# Replace <ACCOUNT_ID> with your CF account ID (visible at dash.cloudflare.com → right sidebar)
# Replace <WORKER_NAME> with "gps-proxy" or "speed-watcher" as appropriate
# Replace <SECRET_VALUE> with the generated value (no trailing newline)

$headers = @{ "Authorization" = "Bearer <CF_API_TOKEN>"; "Content-Type" = "application/json" }

# For ocr-proxy (gps-proxy worker)
Invoke-RestMethod -Method Put `
  -Uri "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/gps-proxy/secrets" `
  -Headers $headers `
  -Body ('{"name":"WEBHOOK_SECRET","text":"<WEBHOOK_SECRET_VALUE>","type":"secret_text"}' | ConvertFrom-Json | ConvertTo-Json)

# For speed-watcher worker
Invoke-RestMethod -Method Put `
  -Uri "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/speed-watcher/secrets" `
  -Headers $headers `
  -Body ('{"name":"WORKER_SECRET","text":"<WORKER_SECRET_VALUE>","type":"secret_text"}' | ConvertFrom-Json | ConvertTo-Json)
```

**Option B — wrangler with stdin redirection (avoids newline on Windows):**

```powershell
# From cloudflare/ directory
[System.Console]::In.ReadToEnd() | Out-Null   # flush
printf '%s' '<WEBHOOK_SECRET_VALUE>' | wrangler secret put WEBHOOK_SECRET --config wrangler.toml
printf '%s' '<WORKER_SECRET_VALUE>'  | wrangler secret put WORKER_SECRET  --config wrangler-speed-watcher.toml
```

> Do NOT proceed to Step 2 until both secrets are confirmed set.

---

### Step 2 — Deploy updated worker code

```powershell
# From the cloudflare/ directory
cd F:\@Coding\pt-medical-system\.claude\worktrees\distracted-elbakyan-4fcc5d\cloudflare

# Deploy ocr-proxy (handles /notify/check + OCR)
wrangler deploy --config wrangler.toml

# Deploy speed-watcher
wrangler deploy --config wrangler-speed-watcher.toml
```

> After this step: `/notify/check` will return 401 for all requests without the correct header.
> Existing Supabase webhook calls will fail until Step 3 is done — window should be < 2 minutes.

---

### Step 3 — Update Supabase webhook header

1. Open Supabase Dashboard → **Database → Webhooks**.
2. Find the webhook that fires on `patient_cases` table (INSERT + UPDATE) pointing to
   `https://gps-proxy.<your-account>.workers.dev/notify/check`.
3. Click **Edit**.
4. Under **HTTP Headers**, add:
   - Name: `Authorization`
   - Value: `Bearer <WEBHOOK_SECRET_VALUE>` (exact value from Step 1)
5. Click **Save**.

> Supabase will now send the `Authorization` header on every webhook call.

---

### Step 4 — Speed-watcher cron note

The cron trigger (`*/2 * * * *`) fires the `scheduled()` handler, **not** the `fetch()` handler.
The auth gate added in Wave 6A is only on `fetch()` — cron runs are unaffected and do not need
a secret header. No wrangler.toml change is needed for cron.

Manual HTTP calls to `/run`, `/state`, `/clear`, `/test-alert` now require:
```
Authorization: Bearer <WORKER_SECRET_VALUE>
```

---

### Step 5 — Verify

**A. Token rejection check (both workers):**

```powershell
# Should return 401
Invoke-RestMethod -Uri "https://gps-proxy.<acct>.workers.dev/notify/check" -Method Post `
  -ContentType "application/json" -Body '{"test":1}'

# Should return 401
Invoke-RestMethod -Uri "https://speed-watcher.<acct>.workers.dev/run" -Method Get
```

**B. Token acceptance check — ocr-proxy:**

```powershell
# Should return 200 (skipped / not critical — no real case_id)
Invoke-RestMethod -Uri "https://gps-proxy.<acct>.workers.dev/notify/check" -Method Post `
  -Headers @{ Authorization = "Bearer <WEBHOOK_SECRET_VALUE>" } `
  -ContentType "application/json" -Body '{"record":{"case_id":"TEST-0"}}'
```

**C. Token acceptance check — speed-watcher:**

```powershell
# dry run — should return 200 with cycle log
Invoke-RestMethod -Uri "https://speed-watcher.<acct>.workers.dev/run?dry=1" `
  -Headers @{ Authorization = "Bearer <WORKER_SECRET_VALUE>" }
```

**D. End-to-end notification test:**

1. Open the monitor page (`/v2/monitor/`).
2. Create or edit a patient case with critical vitals (e.g., SpO2 = 85%).
3. Wait up to 30 seconds for Supabase to fire the webhook.
4. Confirm LINE/Telegram alert is received.
5. Check Supabase → `notification_log` table — should show `status = 'sent'`, not `'failed'`.

**E. Speed alert test (optional):**

```powershell
Invoke-RestMethod -Uri "https://speed-watcher.<acct>.workers.dev/test-alert" `
  -Headers @{ Authorization = "Bearer <WORKER_SECRET_VALUE>" }
```

Confirm LINE/Telegram receives the test speed alert.

---

## Rollback

If notifications stop after deploy:

1. **Immediate:** In Supabase Dashboard → Webhooks → edit the webhook → remove the
   `Authorization` header → Save. This restores the old unauthenticated behavior
   (notifications resume but endpoint is unprotected again).

2. **Worker rollback** (if Step 2 was done but Step 3 was not):

   ```powershell
   # From cloudflare/ directory — roll back to previous version
   wrangler rollback --config wrangler.toml
   wrangler rollback --config wrangler-speed-watcher.toml
   ```

3. Diagnose using Cloudflare Dashboard → Workers → gps-proxy → Logs (tail mode).

---

## Verification checklist after deploy

- [ ] `curl -X POST .../notify/check` (no header) → `401 Unauthorized`
- [ ] `curl -X POST .../notify/check -H "Authorization: Bearer <secret>"` with minimal body → `200` (skipped)
- [ ] `curl .../run` (no header) on speed-watcher → `401`
- [ ] `curl .../run?dry=1 -H "Authorization: Bearer <secret>"` on speed-watcher → `200` with cycle log
- [ ] Supabase `notification_log` shows `status='sent'` after a real critical-vitals case update
- [ ] LINE or Telegram receives the critical notification
- [ ] Speed-watcher `/test-alert` (with token) delivers fake speed alert to LINE/Telegram
- [ ] Supabase webhook editor shows the `Authorization` header saved correctly
