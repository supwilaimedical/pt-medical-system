# Notification Webhook Setup

> **Status: ✅ LIVE in production (since 2026-04-22)** — Supwilai deployed, Thegood follows in 2-4 weeks.  
> **Version 6.0 — Updated 2026-04-25 (post-V2 migration).** Worker URL paths and payload format unchanged by V2 migration.

Server-side critical-event detection via Supabase Database Webhook → Cloudflare Worker.

---

## Deploy Order (per deployment — do both Supwilai + Thegood)

### 1. Run SQL migrations in Supabase

In Supabase SQL Editor run (if not already):

```
sql/notifications.sql       -- base tables (Phase 2)
sql/notifications_v2.sql    -- adds last_payload column
```

### 2. Set Worker secret for deep links

```bash
cd cloudflare
npx wrangler secret put PUBLIC_BASE_URL
# Supwilai: https://supwilaimedical.github.io/pt-medical-system
# Thegood:  https://officethegood.github.io/pt-medical-system
```

### 3. Deploy the worker

```bash
npx wrangler deploy
```

Verify:
```
curl https://<worker>/notify/health
```
should return `{"ok":true, "service":"notify", "hasLine":true, ...}`.

### 4. Create Supabase Database Webhook

**Dashboard → Database → Webhooks → Create a new hook**

| Field | Value |
|---|---|
| Name | `critical_alert_check` |
| Table | `cases` |
| Events | ✅ Insert, ✅ Update (skip Delete) |
| Type | HTTP Request |
| Method | `POST` |
| URL | `https://<your-worker>.workers.dev/notify/check` |
| HTTP Headers | `Content-Type: application/json` (default) |

Leave timeout default (5s is fine). No HTTP params. Save.

### 5. Smoke test

Go to Transport → open any case → enter `SpO2: 80` → Save.

Within a couple of seconds the notification should appear in the configured Line OA / Telegram chat (if both are enabled in admin Notifications).

Check `notification_log` table in Supabase for a row with `status='sent'`.

---

## How It Works

1. User saves a case → Supabase updates `cases` row
2. Supabase DB Webhook POSTs the `{record, old_record}` payload to worker `/notify/check`
3. Worker:
   - Skips if `raw_data` unchanged (pure metadata update)
   - Runs `detectCritical(row)` — same logic as `monitor_checkCritical`
   - If not critical → skip
   - Loads `notification_state(case_id, 'CRITICAL')`:
     - No state → send
     - State + `acknowledged=true` → send (refire after ack)
     - State + `acknowledged=false` → compare new severity vs `last_payload.severity`:
       - **worse** (any metric further from normal range, or new alert type) → send
       - **same or better** → skip
4. On send: fan out to Line (if enabled) + Telegram (if enabled); log each; upsert state with new payload

---

## Message Format

One merged message per case, aggregating all active alerts:

```
🚨 CRITICAL — #20260422-405
ผู้ป่วย: สมชาย ใจดี (65 ปี)
จาก: รพ. A → รพ. B
รถ: ALS / 1
⚠️ SpO2 80% · HR 145 · GCS 7
https://.../v2/monitor/?case=CASE-20260422-405
```

---

## Acknowledgement

When a user opens the case in Monitor (`monitorPreviewCase`) or Transport (`openCase`), `notifyAck(caseId)` runs and sets `acknowledged=true`. After ack, the next worsening will send a fresh alert.

The deep link in the message opens Monitor (V2: `/v2/monitor/?case=CASE-xxx`) — auto-acks on load. The `PUBLIC_BASE_URL` worker secret should point at the canonical V2 root (e.g. `https://supwilaimedical.github.io/pt-medical-system/v2`).

---

## Troubleshooting

**No notification after saving critical vitals:**
1. Check `notification_log` — is there a recent row for the case_id? If not, the webhook isn't firing.
2. Supabase Dashboard → Database → Webhooks → click your hook → "Logs" tab — see what POSTed
3. Worker logs: `npx wrangler tail` while saving
4. Confirm admin Notifications has Line/TG **enabled** and targets are correct

**Every save triggers a notification:**
- `acknowledged` isn't flipping to `true`. Check: is `notifyAck` being called on case open? Look in `notification_state` table for the `acknowledged_at` column.

**Notification sent but fails at Line:**
- Check `notification_log.error` — `"Line 400: Failed to send"` usually means bot not in that group / user hasn't added OA as friend. Use `/notify/test` from admin to verify channel independently.

---

_Updated 2026-04-25 — post-V2 migration. Note `PUBLIC_BASE_URL` should now end with `/v2` so deep links open V2 Monitor directly (root + V1 paths still redirect, but pointing direct avoids one hop)._
