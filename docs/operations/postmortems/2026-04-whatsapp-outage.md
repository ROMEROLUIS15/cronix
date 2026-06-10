# Postmortem: WhatsApp Cloud API Routing Fix — Cronix

**Date:** March 28, 2026
**Duration:** ~3 hours
**Result:** 100% functional system with official production number +58 414-7531158

---

## Original Problem

The WhatsApp AI Agent (RAG/Scheduling) was sending responses through the Meta **test phone number** instead of the official production number **+58 414-7531158**. The webhook received messages correctly, but responses were being dispatched using the wrong Phone Number ID.

---

## Issues Found and Solutions (Chronological Order)

### 1. Dynamic Phone Number ID Routing

**Problem:** In `whatsapp.ts`, the `sendWhatsAppMessage` function accepted an optional `phoneNumberId` parameter that took precedence over the environment variable:

```typescript
// BEFORE (bug)
const pid = phoneNumberId || Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
```

In `index.ts`, `value?.metadata?.phone_number_id` was passed (the ID Meta includes in the webhook payload, corresponding to the number that RECEIVED the message). If the webhook was configured on both numbers, entering via the test number caused the response to exit via the same test number.

**Solution:** Remove the dynamic parameter and always force the environment variable:

```typescript
// AFTER (fix)
export async function sendWhatsAppMessage(to: string, text: string) {
  const pid = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')
```

**Modified Files:**
- `supabase/functions/whatsapp-webhook/whatsapp.ts` — removed `phoneNumberId` parameter
- `supabase/functions/whatsapp-webhook/index.ts` — removed third argument in both `sendWhatsAppMessage` calls

---

### 2. Incorrect WHATSAPP_PHONE_NUMBER_ID in Supabase Secrets

**Problem:** Could not visually confirm that the `WHATSAPP_PHONE_NUMBER_ID` secret pointed to the official number because `supabase secrets list` only shows hashes.

**Solution:** Obtain the correct Phone Number ID from Meta Business Manager:
- Go to Meta Developers > WhatsApp > API Setup
- Select the number +58 414-7531158
- Copy the **Phone number ID:** `1035519006312517`

```bash
npx supabase secrets set WHATSAPP_PHONE_NUMBER_ID=1035519006312517
```

**How to find the Phone Number ID:**
Meta Developers → Your App → WhatsApp → API Setup → "From" Selector → Select number → ID appears underneath.

---

### 3. Supabase JWT Blocked Meta Calls

**Problem:** The `whatsapp-webhook` Edge Function had **"Verify JWT with legacy secret"** enabled in Supabase. This required every request to include a valid Supabase JWT in the `Authorization` header. Meta does NOT send Supabase JWTs, so **all Meta calls were silently rejected** (didn't even appear in logs).

**Symptoms:**
- 0 POST invocations in Supabase dashboard
- 0 function logs
- Only GET 403 (verification failed) appeared

**Solution:**
1. Go to Supabase Dashboard > Edge Functions > whatsapp-webhook > **Settings**
2. Toggle **"Verify JWT with legacy secret"** → OFF
3. Click **"Save changes"**

The function already has its own HMAC-SHA256 authentication (`verifyMetaSignature`) using the `WHATSAPP_APP_SECRET`, so it DOES NOT need the Supabase JWT.

**Can also be disabled via CLI during deployment:**
```bash
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

---

### 4. Out-of-Sync WHATSAPP_VERIFY_TOKEN

**Problem:** The verification token in Supabase Secrets did not match the one configured in Meta. When Meta attempted to verify the webhook (GET request), the function returned 403.

**Symptoms:**
- GET requests to the webhook returned 403
- Meta could not verify the webhook subscription

**Solution:**
1. Check token in `.env.local`: `WHATSAPP_VERIFY_TOKEN=claveDesde01.croNix.?`
2. Sync it in Supabase Secrets (using quotes for the `?` character):

```bash
npx supabase secrets set "WHATSAPP_VERIFY_TOKEN=claveDesde01.croNix.?"
```

3. Redeploy the function to apply new secrets:
```bash
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

4. In Meta > WhatsApp > Configuration → Click **"Verify and save"**

**Manual Verification (for debugging):**
```bash
curl "https://<PROJECT>.supabase.co/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=claveDesde01.croNix.?&hub.challenge=TEST_OK"
# Should return: TEST_OK with status 200
```

---

### 5. App Not Subscribed to Production WABA (Graph API)

**CRITICAL Problem:** This was the hardest issue to diagnose. The Cronix-Notificador app was subscribed to the development WABA (`821805894282372`) but **NOT to the production WABA** (`1314182490760261`) where the official number +58 414-7531158 resides.

**Symptoms:**
- Webhook verified correctly (GET 200)
- Meta test events arrived (POST 200)
- But real WhatsApp messages triggered 0 invocations

**Diagnosis:** Using the Graph API:
```bash
# Production WABA — NO subscription
curl "https://graph.facebook.com/v19.0/1314182490760261/subscribed_apps" \
  -H "Authorization: Bearer <TOKEN>"
# Result: {"data":[]}  ← EMPTY

# Development WABA — HAS subscription
curl "https://graph.facebook.com/v19.0/821805894282372/subscribed_apps" \
  -H "Authorization: Bearer <TOKEN>"
# Result: {"data":[{"name":"Cronix-Notificador","id":"940041878528412"}]}
```

**Solution:**
```bash
curl -X POST "https://graph.facebook.com/v19.0/1314182490760261/subscribed_apps" \
  -H "Authorization: Bearer <WHATSAPP_ACCESS_TOKEN>"
# Result: {"success":true}
```

**How to find your WABA ID:**
- Meta Developers > WhatsApp > API Setup > Select official number
- The **"WhatsApp Business Account ID"** appears next to the Phone Number ID.

**IMPORTANT:** Every WABA (WhatsApp Business Account) requires an independent subscription. If you have multiple WABAs (production + test), you must subscribe the app to each one you want to monitor.

---

### 6. Gemini Quota Exhausted — Migration to Groq

**Problem:** Gemini 2.0 Flash (free tier) hit its daily quota with error 429:
```
Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests
```
The Gemini free tier has very low limits (15 RPM, ~1,000 requests/day).

**Solution:** Migration to **Groq with Llama 3.3 70B Versatile**:

| Metric | Gemini 2.0 Flash | Groq Llama 3.3 70B |
|---------|-----------------|---------------------|
| RPM | 15 | 30 |
| Requests/day | ~1,000 | 14,400 |
| Speed | ~100 tok/s | 300+ tok/s |
| Cost | Free | Free |
| Credit Card Required | No | No |

**Changes in `gemini.ts` (renamed to `ai-agent.ts` later):**
- URL: `https://api.groq.com/openai/v1/chat/completions`
- Model: `llama-3.3-70b-versatile`
- Format: OpenAI-compatible (messages with system/user roles)
- Auth: `Authorization: Bearer <GROQ_API_KEY>`

```bash
npx supabase secrets set "GROQ_API_KEY=gsk_..."
```

**To create Groq account:** https://console.groq.com (free, no card).

---

### 7. Badly Constructed Action Tags Regex

**Problem:** Regex for parsing `[CONFIRM_BOOKING]` and `[RESCHEDULE_BOOKING]` only had one comma separator, but the format has 3 comma-separated values:

```typescript
// BEFORE (bug) — missing comma between date and time
const CONFIRM_REGEX = /\[CONFIRM_BOOKING:\s*([^,]+?)\s*,\s*([^,]+?)\s*([^\]]+?)\]/

// AFTER (fix) — correct comma separator
const CONFIRM_REGEX = /\[CONFIRM_BOOKING:\s*([^,]+?)\s*,\s*([^,]+?)\s*,\s*([^\]]+?)\]/
```

**Symptoms:** `Invalid time value` error in `localTimeToUTC` because regex captured date and time incorrectly.

---

### 8. Booking Errors Crashed the System

**Problem:** Legitimate business errors (slot unavailable, invalid date) were not caught by try/catch, causing the system to respond with the generic "technical difficulties" message.

**Solution:** Wrap booking operations (create, reschedule, cancel) in individual try/catch blocks with user-friendly error messages.

---

## WhatsApp Cloud API Configuration Checklist

Use this checklist when setting up a webhook from scratch or diagnosing issues:

### Meta Business Manager
- [ ] Official number selected in API Setup
- [ ] Phone Number ID noted
- [ ] WABA ID (WhatsApp Business Account ID) noted
- [ ] App Secret noted (App Dashboard > Settings > Basic > App Secret)

### Meta Developers — WhatsApp > Configuration
- [ ] Webhook URL configured: `https://<PROJECT>.supabase.co/functions/v1/whatsapp-webhook`
- [ ] Verification token entered (must match `WHATSAPP_VERIFY_TOKEN`)
- [ ] Successful verification ("Verify and save" button)
- [ ] `messages` field subscribed (toggle ON)

### Graph API — WABA Subscription
- [ ] App subscribed to production WABA:
```bash
curl -X POST "https://graph.facebook.com/v19.0/<WABA_ID>/subscribed_apps" \
  -H "Authorization: Bearer <TOKEN>"
```

### Supabase Secrets
- [ ] `WHATSAPP_PHONE_NUMBER_ID` = Official number's Phone Number ID
- [ ] `WHATSAPP_ACCESS_TOKEN` = Permanent token with permissions over official number
- [ ] `WHATSAPP_APP_SECRET` = App secret (for HMAC verification)
- [ ] `WHATSAPP_VERIFY_TOKEN` = Verification token (must match Meta)
- [ ] `GROQ_API_KEY` = Groq API key

### Supabase Edge Function
- [ ] **Verify JWT: OFF** (function uses custom HMAC)
- [ ] Deployed with `--no-verify-jwt`:
```bash
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

---

## Useful Debugging Commands

```bash
# View configured secrets (hashes only)
npx supabase secrets list

# Manually verify webhook
curl "https://<PROJECT>.supabase.co/functions/v1/whatsapp-webhook?hub.mode=subscribe&hub.verify_token=<TOKEN>&hub.challenge=TEST"

# View crash logs in database
curl -s "https://<PROJECT>.supabase.co/rest/v1/wa_audit_logs?ai_response=like.CRASH_LOG*&order=created_at.desc&limit=5&select=created_at,ai_response" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"

# View apps subscribed to a WABA
curl "https://graph.facebook.com/v19.0/<WABA_ID>/subscribed_apps" \
  -H "Authorization: Bearer <TOKEN>"

# Subscribe app to a WABA
curl -X POST "https://graph.facebook.com/v19.0/<WABA_ID>/subscribed_apps" \
  -H "Authorization: Bearer <TOKEN>"

# Deploy function
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

---

## Key Project IDs

| Resource | ID |
|---------|-----|
| App ID (Cronix-Notificador) | `940041878528412` |
| Production WABA | `1314182490760261` |
| Development WABA | `821805894282372` |
| Phone Number ID (official) | `1035519006312517` |
| Official Number | +58 414-7531158 |
| Supabase Project | `psuthbtdvprojdbsimvq` |

---

## Lessons Learned

1. **Always disable JWT on functions receiving external webhooks.** Supabase enables JWT by default, which silently blocks third-party calls (Meta, Stripe, etc.).

2. **Each WABA requires independent subscription via Graph API.** Configuring the webhook in Meta Developers is NOT enough — you must also subscribe the app to the specific WABA using `POST /{waba_id}/subscribed_apps`.

3. **Never use the dynamic `phone_number_id` from the webhook to respond.** Always force the environment variable to ensure responses exit via the correct number.

4. **Supabase secrets require redeploy to take effect.** After changing secrets, always redeploy the function.

5. **Meta's "Test" events are useful but limited.** They verify reachability but don't exactly replicate real message flows.

6. **Special characters in secrets (`?`, `!`, `*`) require quotes** in bash commands to avoid glob interpretation.

7. **Business errors should be handled with individual try/catch** instead of letting the global catch turn them into "technical difficulties."

---

### 9. QStash Synchronization and Regions (April 2026)

**Problem:** Following a system reset and QStash project change, the AI stopped responding. Meta's webhook received messages (POST 200), but they never reached the processor function.

**Root Causes:**
1.  **Region Mismatches:** QStash was configured in **US East 1**, but code attempted to send messages to the global URL (`qstash.upstash.io`). Credentials from one region do not work in another.
2.  **Outdated Secrets:** `QSTASH_TOKEN` and `SIGNING_KEYS` (Current and Next) had changed in the new Upstash project.
3.  **Insufficient Logs:** We couldn't see why the QStash `fetch` failed because the error body wasn't printed.

**Solution:**
1.  **Dynamic URL Support:** Modified `whatsapp-webhook/index.ts` to use the `QSTASH_URL` environment variable:
    ```typescript
    const qstashUrl = Deno.env.get('QSTASH_URL') || 'https://qstash.upstash.io'
    ```
2.  **Debug Logs:** Added `console.log` to show the publishing URL and error text if `qstashResponse.ok` is false.
3.  **Massive Secret Update:**
    ```bash
    supabase secrets set QSTASH_URL="..." QSTASH_TOKEN="..." QSTASH_CURRENT_SIGNING_KEY="..." QSTASH_NEXT_SIGNING_KEY="..."
    ```

**Lesson Learned:** QStash credentials are **regional**. Always explicitly configure the `QSTASH_URL` if not using the global region, and ensure both signing keys (`CURRENT` and `NEXT`) are synced so the receiver can validate the `Upstash-Signature`.

---

### 10. QStash Credential Duplication & Silent Failures (April 2026 - Incident 2)

**Problem:** Following an attempt to change QStash zones (US East to EU Central), the AI stopped responding completely. Meta received 200 OK from the Webhook, but no messages reached the AI agent.

**Root Causes:**
1.  **Duplicate Environment Variables:** `.env.local` contained both EU Central configurations (incorrectly formatted) and US East 1 configurations, causing deployment misalignment.
2.  **Signature Mismatch:** Because the `QSTASH_CURRENT_SIGNING_KEY` on Supabase did not correspond to the actual active project, `process-whatsapp`'s `verifyQStash` function rejected all incoming QStash payloads with a 401 Unauthorized error.
3.  **Silent Security Block:** `verifyQStash` explicitly returns a `401` and exits BEFORE the core logic runs. This means `logToDLQ` is never triggered (to prevent database bloat from unauthorized attackers), causing a "silent drop" from the developer's perspective. 

**Solution:**
1.  **Environment Cleanup:** Removed the legacy/commented EU zone credentials from `.env.local` to strictly maintain a single source of truth for the active US East 1 QStash instance.
2.  **CLI Synchronization:** Re-pushed the correct US East 1 credentials directly using the CLI:
    ```bash
    npx supabase secrets set QSTASH_URL="https://qstash-us-east-1.upstash.io" QSTASH_TOKEN="..." QSTASH_CURRENT_SIGNING_KEY="..." QSTASH_NEXT_SIGNING_KEY="..."
    ```

**Lesson Learned:** When dealing with dual-service webhooks (Meta -> Supabase -> QStash -> Supabase), signature mismatches will silently drop traffic. Always keep `.env.local` absolutely clean from legacy regions, and actively push changes specifically to `supabase secrets` as Supabase Deno Deploy does not auto-sync local files.

---

## New Configuration Checklist Steps

### QStash (Upstash)
- [ ] **QSTASH_URL** configured based on the chosen region (e.g., `qstash-us-east-1.upstash.io`).
- [ ] **QSTASH_TOKEN** updated.
- [ ] **QSTASH_CURRENT_SIGNING_KEY** and **QSTASH_NEXT_SIGNING_KEY** extracted from the "APIs" tab in Upstash.
- [ ] **Verify `.env.local` has exactly ONE block of QStash keys** to prevent deployment confusion.
- [ ] Verify the destination in the webhook (`PROCESS_WHATSAPP_URL`) points to the correct Supabase function.
