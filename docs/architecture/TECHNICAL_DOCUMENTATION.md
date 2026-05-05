# Cronix — Technical Documentation

Deep technical dive into Cronix architecture, security implementation, AI agent behavior, database schema, and system integrations.

---

## Table of Contents

- [Security & Anti-Spam Architecture](#security--anti-spam-architecture)
- [WhatsApp AI Agent — Comprehensive Workflow](#whatsapp-ai-agent--comprehensive-workflow)
- [Voice Transcription (Groq Whisper)](#voice-transcription-groq-whisper)
- [Push Notifications Architecture](#push-notifications-architecture)
- [Database Design & RLS](#database-design--rls)
- [Key TypeScript Interfaces](#key-typescript-interfaces)
- [Performance Optimization](#performance-optimization)
- [LLM Provider Abstraction](#llm-provider-abstraction)
- [Error Handling & Logging](#error-handling--logging)
- [Luis IA V4 — Strategic Evolution & Hardening](#luis-ia-v4--strategic-evolution--hardening)

---

## Security & Anti-Spam Architecture

Cronix implements a **3-layer defense system** to protect against WhatsApp AI abuse (spam, fake bookings, resource exhaustion):

### Layer 1: Message Rate Limiting (Atomic PostgreSQL)

**Table:** `wa_rate_limits` — sliding-window counter per `sender_phone`

```sql
fn_wa_check_rate_limit(
  p_sender: text,
  p_window_secs: int = 60,
  p_max_msgs: int = 10
) → boolean
```

**Implementation Details:**
- **Limit:** 10 messages per 60 seconds per phone number
- **Strategy:** Atomic UPSERT in PostgreSQL — no race conditions, no locks needed
- **Garbage Collection:** Automatic cleanup of windows older than 1 hour (prevents table bloat)
- **Cost:** Zero external API calls — runs entirely in database
- **Integration Point:** Called in `supabase/functions/whatsapp-webhook/index.ts` line 241 before message processing

**Behavior When Rate Limited:**
- Message is logged to `wa_audit_logs` with status `RATE_LIMITED`
- No processing occurs (cost avoidance)
- No response sent to attacker (fail-secure, no confirmation of receipt)
- Continues to next message attempt

**Why Atomic?**
- Prevents race conditions under concurrent requests
- No need for distributed locks or Redis
- Sub-millisecond execution on indexed column

### Layer 2: Message Sanitization (Anti Prompt Injection)

**Function:** `sanitizeMessage()` in `supabase/functions/whatsapp-webhook/index.ts` (lines 282-310)

**Defenses:**
1. **Hard Truncation:** Max 500 characters
   - Prevents token abuse in Groq API requests
   - Forces attacker to split message into multiple requests (subject to Layer 1 rate limit)

2. **Fake Action Tag Stripping:** Remove user-provided tags
   - `[CONFIRM_BOOKING]` → removed
   - `[RESCHEDULE_BOOKING]` → removed
   - `[CANCEL_BOOKING]` → removed
   - Prevents bypassing two-turn confirmation protocol

3. **Prompt Injection Patterns:** Strip common attacks
   - "ignore previous instructions"
   - "system prompt:"
   - "you are now..."
   - "assistant: " at message start
   - XML/HTML tags (`<instruction>`, `<!--`, etc.)

4. **Whitespace Normalization:** Collapse excessive spaces
   - Prevents token inflation via whitespace padding
   - Improves message readability

**Integration Point:** Called before routing to AI agent (line 259)

**Why Before AI, Not After?**
- AI processing is expensive (Groq API call)
- Better to reject malicious input early
- Prevents loading bad data into system prompt

### Layer 3: Booking Rate Limiting (Anti Calendar Spam)

**Table:** `wa_booking_limits` — counter per `(sender_phone, business_id)`

```sql
fn_wa_check_booking_limit(
  p_sender: text,
  p_business_id: uuid,
  p_window_secs: int = 86400,      -- 24 hours
  p_max_bookings: int = 2
) → boolean
```

**Implementation Details:**
- **Limit:** 2 new bookings per sender per business per 24 hours
- **Trigger:** Only executes when `CONFIRM_BOOKING` action tag is emitted (not on every message)
  - Avoids punishing legitimate conversations
  - Only counts actual booking attempts
- **Window:** Rolling 24-hour window per sender per business

**Behavior When Limited:**
- User receives: "Has alcanzado el límite de citas nuevas por hoy. Por favor contáctanos directamente..."
- Booking is not created
- Logged to audit logs with `BOOKING_LIMIT_EXCEEDED` status

**Plan B — Pending Approval Workflow:**
Even without rate limiting, all WhatsApp bookings arrive as `status='pending'`:
- Requires explicit owner approval in dashboard
- Shows green approval bar with Confirm/Reject buttons
- Provides human oversight layer
- Prevents calendar from being auto-confirmed with spam

**Why Three Layers Instead of One?**
- **Layer 1** stops noisy attackers early (cheap)
- **Layer 2** prevents AI exploitation (medium cost)
- **Layer 3** prevents calendar flooding (high cost, avoided if possible)
- **Plan B** provides human safeguard

---

## WhatsApp AI Agent — Comprehensive Workflow

### System Architecture

**Single Shared Number:** `+584147531158` for all businesses (multi-tenancy via slug routing)

**Edge Function:** `supabase/functions/whatsapp-webhook/`

**Files:**
- `index.ts` — Main webhook orchestrator & action execution
- `ai-agent.ts` — AI conversation engine with Groq integration
- `types.ts` — Type definitions for Meta webhooks
- `whatsapp.ts` — WhatsApp API client (media download, message sending)
- `database.ts` — Database layer with RLC functions

### Input Processing Pipeline

```
Meta Webhook Event
  ↓
Signature Verification (HMAC-SHA256)
  ↓
Extract Message (text or audio)
  ↓
Rate Limit Check (Layer 1)
  ↓
Message Sanitization (Layer 2)
  ↓
Slug Extraction → Route to Business
  ↓
[If Audio] Transcribe → Groq Whisper
  ↓
Call AI Agent → Groq Llama 3.3
  ↓
Parse Action Tags
  ↓
Execute Actions (Layer 3 check for bookings)
  ↓
Database RPC (atomic insertion)
  ↓
Trigger Database Webhook → Push Notification
  ↓
Send Response Message
  ↓
Log to Audit
```

### 1. Meta Signature Verification

**File:** `index.ts` lines 200-220

**Implementation:**
```typescript
const expectedSignature = crypto.createHmac('sha256', WHATSAPP_APP_SECRET)
  .update(raw)
  .digest('hex')

if (signature !== expectedSignature) {
  return new Response('Forbidden', { status: 403 })
}
```

**Why Critical:**
- Verifies webhook is genuinely from Meta
- Prevents spoofed webhook attacks
- Required for business compliance

**Secret Management:**
- `WHATSAPP_APP_SECRET` stored in Supabase Edge Function secrets
- Never logged or exposed
- Rotated via Meta dashboard

### 2. Rate Limit Check

**File:** `index.ts` line 243

```typescript
const rateLimited = await checkRateLimit(
  supabase,
  senderPhone,
  60,  // window seconds
  10   // max messages
)

if (rateLimited) {
  await logAudit('RATE_LIMITED', ...)
  return new Response('OK', { status: 200 })  // silent, don't confirm to attacker
}
```

**Behavior:**
- Non-blocking: doesn't throw, returns boolean
- Returns 200 to Meta (webhook processed) but doesn't process message
- Logged for debugging, no notification to user

### 3. Message Extraction

**File:** `index.ts` lines 229-235

**Handles Three Message Types:**

**Text Message:**
```typescript
const textBody = msg.text?.body  // Extract text
```

**Voice Note:**
```typescript
const audioId = msg.audio?.id
const mimeType = msg.audio?.mime_type || 'audio/ogg'
```

**Other Types:**
- Button replies, document shares, etc. → ignored gracefully
- Falls back to "non-text ignored" message

### 4. Voice Transcription

**File:** `ai-agent.ts` lines 50-90

**Flow:**
```
audio.id (Meta CDN reference)
  ↓
downloadMediaBuffer(audioId, accessToken)
  ├─ Resolve CDN URL via Meta API
  └─ Download binary buffer (with timeout)
  ↓
transcribeAudio(buffer, mimeType, LLM_API_KEY)
  ├─ Build FormData with audio blob
  ├─ POST to Groq Whisper: https://api.groq.com/openai/v1/audio/transcriptions
  ├─ Headers: Authorization: Bearer {LLM_API_KEY}
  ├─ Params: model=whisper-large-v3-turbo, language=es, response_format=text
  └─ Return: plain Spanish transcript
  ↓
Transcript replaces audio.id in message pipeline
```

**Error Handling:**
- If download fails (timeout, 404, etc.) → log error, send "non-text ignored"
- If transcription fails with 429 → throw `LlmRateLimitError` (bubble up, user gets retry message)
- If transcription fails with other error → log, send "non-text ignored"
- **No silent failures:** all errors logged to `wa_audit_logs`

**Why Groq Whisper?**
- Included in same API key as chat completions (no extra credential)
- Supports Spanish language directly (hardcoded, configurable via business settings in future)
- Cost: ~0.1¢ per minute of audio (cheaper than voice API + chat)
- Latency: <3 seconds typically (satisfactory for async WhatsApp)

### 5. Slug Extraction & Tenant Routing

**File:** `index.ts` lines 257-264

**Slug Format:** `#business-slug-xxxxx` (hashtag prefix required)

**Extraction Regex:** `/^#([a-z0-9-]+)/i` (must be at start of message)

**Routing Priority:**
1. **Explicit `#slug` in message:**
   - Call `getBusinessBySlug(slug)`
   - Fails gracefully if slug not found → send SaaS landing page

2. **No slug, but sender has session:**
   - Check `wa_sessions` table for sender_phone + business_id
   - Retrieve last-active business (user can switch by new `#slug`)

3. **Neither:**
   - Return SaaS landing page with instructions

**Session Management:**
- `wa_sessions` table: `(sender_phone, business_id, last_message_at)`
- Updated on every message
- Allows sender to have multi-business context without repeating slug every message

**Why Before Sanitization?**
- Sanitization runs AFTER slug extraction
- Ensures `#slug` tag isn't stripped before routing
- Slug validation happens before expensive processing

### 6. Message Sanitization

**File:** `index.ts` lines 282-310

Runs after slug extraction, before AI agent

See [Layer 2](#layer-2-message-sanitization-anti-prompt-injection) above for details

### 7. AI Processing

**File:** `ai-agent.ts`

#### System Prompt Construction (lines 94-216)

**Dynamic Context Injected:**

1. **Business Identity:**
   - Business name, category
   - Isolation rule: "Only help with your business, not others"

2. **Client Context:**
   - Recurring vs new client
   - Active appointment count
   - Last appointment date

3. **Service Catalog:**
   ```
   Servicio: Corte de cabello
   Precio: $15
   Duración: 30 minutos

   Servicio: Tinte completo
   Precio: $45
   Duración: 90 minutos
   ```

4. **Working Hours:**
   ```
   Lunes–Viernes: 9:00 AM – 6:00 PM
   Sábado: 10:00 AM – 2:00 PM
   Domingo: Cerrado
   ```

5. **Available Staff:**
   ```
   Profesionales:
   - María (especialista en tintes)
   - Pedro (todos los servicios)
   ```

6. **Conversation History:**
   - Last 8 messages (client + assistant)
   - Prevents context loss in multi-turn conversations

7. **Action Tag Rules (Critical):**
   ```
   Regla: SIEMPRE propone la cita, espera confirmación del cliente ("sí", "ok", etc.)
   Solo después que el cliente confirma, emite:
   [CONFIRM_BOOKING: service_id, YYYY-MM-DD, HH:mm]

   Otros tags:
   [RESCHEDULE_BOOKING: appointment_id, YYYY-MM-DD, HH:mm]
   [CANCEL_BOOKING: appointment_id]
   ```

**Why This Approach?**
- **In-Context Learning:** No RAG or external knowledge retrieval
- **Low Latency:** All business data in prompt (fast)
- **Deterministic:** Reduced hallucinations via "thinking" scratchpad
- **Anti-Injection:** Tags can only be those defined in prompt

#### API Call

**File:** `ai-agent.ts` lines 222-260

```typescript
const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${LLM_API_KEY}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ],
    temperature: 0.1,
    max_tokens: 500
  })
})
```

**Parameters:**
- **temperature: 0.1** → Deterministic (reduced randomness, consistent tag format)
- **max_tokens: 500** → Limit response size (cost + speed)
- **Model:** Groq's fastest reasoning model (1.2s avg latency)

**Response Format:**
```json
{
  "choices": [
    {
      "message": {
        "content": "Perfecto, propongo una cita para mañana a las 3:00 PM para corte. ¿Te va bien? [CONFIRM_BOOKING: service123, 2026-03-30, 15:00]"
      }
    }
  ]
}
```

### 8. Action Tag Parsing & Execution

**File:** `index.ts` lines 328-427

#### CONFIRM_BOOKING

**Regex:** `/\[CONFIRM_BOOKING:\s*([^,]+),\s*(\d{4}-\d{2}-\d{2}),\s*(\d{2}:\d{2})\]/g`

**Execution Steps:**
1. **Parse:** Extract `service_id`, `date`, `time` from tag
2. **Validate:**
   - Service exists and belongs to business
   - Date is in future
   - Time is within business hours
3. **Check Booking Limit:** `checkBookingLimit(senderPhone, businessId)`
4. **If Limited:** Send "Has alcanzado el límite..." and return
5. **Create Appointment:**
   - Call RPC `fn_book_appointment_wa`
   - Passes: business_id, client_phone, service_id, start_at, notes='Agendado vía WhatsApp AI'
   - Status: `pending` (requires owner approval)
6. **Confirm to User:** "Solicitud recibida! Tu cita está pendiente de confirmación..."
7. **Notify Owner:**
   - Database Webhook triggers automatically on INSERT
   - `push-notify` Edge Function sends Web Push
   - Message: "Nueva solicitud de cita vía WhatsApp"
8. **Audit Log:** Record appointment_id, status, timestamp

**Why Pending Status?**
- Provides human review layer
- Owner can reject spam bookings
- Prevents calendar from being auto-filled by attackers (even if rate limits bypassed)
- Green approval bar in dashboard shows pending items

#### RESCHEDULE_BOOKING

**Regex:** `/\[RESCHEDULE_BOOKING:\s*([^,]+),\s*(\d{4}-\d{2}-\d{2}),\s*(\d{2}:\d{2})\]/g`

**Steps:**
1. Extract `appointment_id`, `new_date`, `new_time`
2. Fetch existing appointment (must be active, not cancelled)
3. Validate new time within business hours
4. Calculate new duration (based on services)
5. Update appointment: `start_at`, `end_at`
6. Cancel old reminder, create new
7. Confirm to user with new time
8. Notify owner

#### CANCEL_BOOKING

**Regex:** `/\[CANCEL_BOOKING:\s*([^\]]+)\]/g`

**Steps:**
1. Extract `appointment_id`
2. Update status to `cancelled`, set `cancelled_at`
3. Delete pending reminder
4. Confirm cancellation to user
5. Notify owner
6. **Supports multiple cancels in single message** (processes all tags)

### 9. Graceful Degradation (429 Rate Limit)

**Error Class:** `LlmRateLimitError` (lines 37-47 in `ai-agent.ts`)

**When Groq Returns 429:**
```typescript
if (res.status === 429) {
  const retryAfter = res.headers.get('retry-after') || '60'
  throw new LlmRateLimitError(`Rate limited by LLM. Retry after ${retryAfter}s`)
}
```

**Handling in Webhook (index.ts lines 441-465):**
```typescript
try {
  const response = await getAiResponse(...)
} catch (err) {
  if (err instanceof LlmRateLimitError) {
    // User-friendly message
    await sendMessage(
      senderPhone,
      "Estoy atendiendo muchas consultas. Intenta de nuevo en " +
      err.retrySeconds + " minutos."
    )
    // Log as info, not error
    await logAudit('LLM_RATE_LIMITED', {
      retry_after: err.retrySeconds
    })
    return new Response('OK', { status: 200 })
  }
  // Handle other errors...
}
```

**Why Graceful?**
- User gets clear, actionable message (not "technical difficulties")
- Webhook returns quickly (200 OK), doesn't block Meta
- Logged separately (doesn't pollute error logs)
- Prevents cascade failures (retries happen on user initiative, not server retry loops)

---

## Voice Transcription (Groq Whisper)

### Architecture Diagram

```
Voice Note Sent
  ↓
Meta Webhook: msg.audio.id (CDN reference)
  ↓
downloadMediaBuffer(msg.audio.id, WHATSAPP_ACCESS_TOKEN)
  ├─ Step 1: GET /media/{id} → returns URL + expires_after
  ├─ Step 2: Download binary from URL (with timeout)
  └─ Returns: Uint8Array buffer
  ↓
transcribeAudio(buffer, mimeType, LLM_API_KEY)
  ├─ Build FormData:
  │  ├─ file: buffer (as Blob)
  │  ├─ model: whisper-large-v3-turbo
  │  ├─ language: es
  │  └─ response_format: text
  ├─ POST https://api.groq.com/openai/v1/audio/transcriptions
  ├─ Auth: Bearer {LLM_API_KEY}
  └─ Returns: plain text transcript
  ↓
Transcript flows into AI agent as typed message
```

### Implementation Details

**Files:**
- `types.ts` — `MetaMessage.audio` interface (line 106)
- `whatsapp.ts` — `downloadMediaBuffer()` function (lines 38-66)
- `ai-agent.ts` — `transcribeAudio()` function (lines 50-90)
- `index.ts` — voice detection & orchestration (lines 264-279)

### Media Download (whatsapp.ts)

```typescript
export async function downloadMediaBuffer(
  mediaId: string,
  accessToken: string
): Promise<Uint8Array> {
  // Step 1: Get media URL
  const metaResponse = await fetch(
    `https://graph.instagram.com/v18.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const { url } = await metaResponse.json()

  // Step 2: Download from URL (expires after 1 hour)
  const mediaResponse = await fetch(url, {
    signal: AbortSignal.timeout(30000) // 30s timeout
  })
  return new Uint8Array(await mediaResponse.arrayBuffer())
}
```

**Why Two Steps?**
- Meta doesn't give direct CDN URL in webhook
- First call gets URL (valid for 1 hour only)
- Second call downloads binary
- Prevents URL leakage, adds security layer

**Timeout:** 30 seconds
- Accounts for network latency
- Prevents hanging requests if CDN slow
- Fails gracefully if timeout exceeded

### Transcription (ai-agent.ts)

```typescript
export async function transcribeAudio(
  audioBuffer: Uint8Array,
  mimeType: string,
  apiKey: string
): Promise<string> {
  const formData = new FormData()
  formData.append('file', new Blob([audioBuffer], { type: mimeType }))
  formData.append('model', 'whisper-large-v3-turbo')
  formData.append('language', 'es')
  formData.append('response_format', 'text')

  const res = await fetch(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    }
  )

  if (res.status === 429) {
    // Throw special error for rate limit handling
    throw new LlmRateLimitError(...)
  }

  return await res.text() // Plain text response
}
```

**Groq Whisper Configuration:**
- **Model:** `whisper-large-v3-turbo` (faster than regular whisper)
- **Language:** `es` (Spanish) — hardcoded, could be dynamic per business_settings
- **Response Format:** `text` (returns transcript only, not JSON with metadata)
- **Auth:** Same `LLM_API_KEY` as chat completions (single credential)

**Cost Analysis:**
- ~$0.001 per minute of audio (0.1¢)
- Much cheaper than voice API + chat completion combo
- Groq typically faster than competitors

### Error Handling

**Download Errors:**
```typescript
try {
  const buffer = await downloadMediaBuffer(audioId, accessToken)
} catch (err) {
  logger.warn('Download failed', err)
  return 'non-text ignored' // Don't process further
}
```

**Transcription Rate Limited (429):**
```typescript
try {
  const transcript = await transcribeAudio(buffer, mimeType, apiKey)
} catch (err) {
  if (err instanceof LlmRateLimitError) {
    throw err // Bubble up to webhook handler
  }
  logger.warn('Transcription failed', err)
  return 'non-text ignored'
}
```

**Other Transcription Errors:**
- Log and ignore
- Return to user: "non-text ignored"
- No exception thrown

---

## Push Notifications Architecture

### RFC 8291 Web Push Implementation

**Standards:**
- RFC 8291: Generic Event Delivery Using HTTP Push
- VAPID (Voluntary Application Server Identification)
- AES-128-GCM encryption at rest

### Subscription Lifecycle

**On Client (useNotifications hook):**

```
1. Feature Detection
   ├─ Check: Notification API available
   ├─ Check: Push API available
   └─ Check: ServiceWorker available

2. Permission Request
   └─ window.Notification.requestPermission()

3. ServiceWorker Registration
   └─ navigator.serviceWorker.ready (8s timeout)

4. PushManager Subscription
   └─ reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKeyToUint8Array(publicKey)
      })

5. Serialize Subscription
   └─ Extract: endpoint, p256dh (Elliptic Curve key), auth (shared secret)

6. Persist to Database
   └─ INSERT INTO notification_subscriptions
      (user_id, business_id, endpoint, p256dh, auth, user_agent, updated_at)
      VALUES (...)
      ON CONFLICT (user_id, endpoint) DO UPDATE
```

**File:** `lib/hooks/use-notifications.ts` (144-212)

**Multi-Tenant Safety:**
- Scoped to `user_id` + `business_id` (RLS enforced)
- User can have multiple devices subscribed
- Unsubscribing removes row from DB too

### Notification Sending

**Trigger Events:**

1. **Appointment Created (WhatsApp):**
   - Database Webhook on `appointments` INSERT
   - Calls `push-notify` Edge Function
   - Message: "Nueva solicitud de cita vía WhatsApp"

2. **Appointment Confirmed:**
   - Server action approves appointment
   - Calls `notifyOwner()` service
   - Message: "Cita confirmada: [client name]"

3. **Reminder Sent:**
   - pg_cron triggers `cron-reminders` daily
   - After WhatsApp reminder sent, calls `push-notify`

**Non-Blocking Design:**
```typescript
export async function notifyOwner(params: PushNotifyParams): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke('push-notify', {
      body: params
    })
    if (error) logger.warn('push-notify error', error.message)
  } catch (err) {
    logger.warn('push-notify error', err)
    // Never throws — push failure doesn't block original action
  }
}
```

### Edge Function: push-notify

**Location:** `supabase/functions/push-notify/index.ts`

**Flow:**
```
Request from Database Webhook (or Server Action)
  ↓
Extract: title, body, url
  ↓
Resolve business_id from JWT
  ↓
SELECT from notification_subscriptions WHERE business_id
  ↓
For each subscription:
  ├─ Build encrypted message (AES-128-GCM)
  ├─ Build VAPID JWT (signed with private key)
  └─ POST to endpoint (Push Service provider, e.g., Google FCM)
  ↓
Log results (success/failure per device)
  ↓
Return 200 OK (fire-and-forget)
```

**VAPID JWT:**
- Signed with `VAPID_PRIVATE_KEY` (stored in Edge Function secrets)
- Contains: iss (HTTPS origin), sub (contact email), exp (1 hour)
- Identifies server to Push Service

**Encryption:**
- Uses `p256dh` (public key from subscription)
- Uses `auth` (shared secret from subscription)
- Payload encrypted with AES-128-GCM
- Decrypted by browser Service Worker

### Service Worker: Message Handling

**Location:** `worker/sw.ts` or compiled to `public/sw.js`

**On Push Event:**
```typescript
self.addEventListener('push', (event) => {
  const { title, body, url } = JSON.parse(event.data.text())

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      badge: '/icon-192x192.png',
      icon: '/icon-192x192.png',
      tag: 'cronix-notification'
    })
  )
})

// On Click
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      if (clientList.length > 0) {
        return clientList[0].focus()
      }
      return clients.openWindow(event.notification.tag)
    })
  )
})
```

**Why Service Worker?**
- Receives notifications even if browser tab closed
- Shows native OS notification (desktop, mobile)
- Handles click events (focus app or open URL)

---

## Database Design & RLS

### Multi-Tenancy via RLS

All user-facing tables have RLS policies enforced by database:

```sql
-- Appointments
CREATE POLICY appointments_select ON appointments
  FOR SELECT
  USING (
    business_id IN (
      SELECT id FROM businesses
      WHERE owner_id = auth.uid()
      OR id IN (SELECT business_id FROM team_members WHERE user_id = auth.uid())
    )
  );

-- Clients
CREATE POLICY clients_select ON clients
  FOR SELECT
  USING (business_id = get_business_id());
```

**get_business_id() Function:**
```sql
CREATE OR REPLACE FUNCTION get_business_id() RETURNS UUID
LANGUAGE SQL SECURITY DEFINER
AS $$
  SELECT business_id FROM business_context
  WHERE user_id = auth.uid()
  LIMIT 1
$$;
```

**Why Database-Level RLS?**
- Can't be bypassed by application code
- Enforced even if admin client used (with explicit check)
- All queries filtered automatically (no N+1 risks)

### Key Tables

**businesses**
- `id` (UUID, PK)
- `owner_id` (UUID, FK to auth.users)
- `name` (text)
- `slug` (text, UNIQUE)
- `category` (enum: salon, clinic, gym, etc.)
- `settings` (jsonb): hours, double_booking_policy, etc.
- `created_at`, `updated_at`

**appointments**
- `id` (UUID, PK)
- `business_id` (UUID, FK)
- `client_id` (UUID, FK)
- `start_at` (timestamp)
- `end_at` (timestamp)
- `status` (enum: pending, confirmed, completed, cancelled, no_show)
- `notes` (text) — `"Agendado vía WhatsApp AI"` for AI bookings
- `created_at`

**appointment_services** (junction table)
- `id` (UUID, PK)
- `appointment_id` (UUID, FK)
- `service_id` (UUID, FK)
- Multi-service support in single appointment

**appointment_reminders**
- `id` (UUID, PK)
- `appointment_id` (UUID, FK)
- `business_id` (UUID, FK)
- `remind_at` (timestamp)
- `status` (enum: pending, sent, failed, cancelled)
- `error_message` (text, nullable)

**wa_rate_limits**
- `id` (UUID, PK)
- `sender_phone` (text)
- `window_start` (timestamp)
- `message_count` (int)
- `updated_at` (timestamp)
- Index: (sender_phone, window_start)

**wa_booking_limits**
- `id` (UUID, PK)
- `sender_phone` (text)
- `business_id` (UUID, FK)
- `window_start` (timestamp)
- `booking_count` (int)
- `updated_at` (timestamp)
- Index: (sender_phone, business_id, window_start)

**wa_sessions**
- `sender_phone` (text, PK)
- `business_id` (UUID, FK)
- `last_message_at` (timestamp)
- Enables multi-turn conversations without repeating `#slug`

**wa_audit_logs**
- `id` (UUID, PK)
- `business_id` (UUID, FK)
- `sender_phone` (text)
- `message_text` (text, truncated)
- `ai_response` (text, nullable)
- `status` (enum: RECEIVED, PROCESSED, RATE_LIMITED, BOOKING_LIMIT_EXCEEDED, etc.)
- `error_message` (text, nullable)
- `timestamp` (timestamp)

**notification_subscriptions**
- `id` (UUID, PK)
- `user_id` (UUID, FK to auth.users)
- `business_id` (UUID, FK)
- `endpoint` (text, UNIQUE per user_id)
- `p256dh` (text) — EC public key (base64url)
- `auth` (text) — shared secret (base64url)
- `user_agent` (text, first 200 chars)
- `updated_at` (timestamp)
- RLS: users see only their own subscriptions

### Atomic RPC Functions

**fn_book_appointment_wa()**
```sql
CREATE FUNCTION fn_book_appointment_wa(
  p_business_id UUID,
  p_client_phone TEXT,
  p_service_id UUID,
  p_start_at TIMESTAMP,
  p_end_at TIMESTAMP
) RETURNS JSON
LANGUAGE PLPGSQL SECURITY DEFINER
AS $$
DECLARE
  v_appointment_id UUID;
  v_client_id UUID;
BEGIN
  -- Transaction-like: either all succeed or all fail

  -- Upsert client
  INSERT INTO clients (business_id, phone, name)
  VALUES (p_business_id, p_client_phone, 'WhatsApp Client')
  ON CONFLICT (business_id, phone) DO UPDATE SET updated_at = NOW()
  RETURNING id INTO v_client_id;

  -- Insert appointment
  INSERT INTO appointments (
    business_id, client_id, start_at, end_at, status, notes
  )
  VALUES (
    p_business_id, v_client_id, p_start_at, p_end_at, 'pending',
    'Agendado vía WhatsApp AI'
  )
  RETURNING id INTO v_appointment_id;

  -- Link service
  INSERT INTO appointment_services (appointment_id, service_id)
  VALUES (v_appointment_id, p_service_id);

  RETURN JSON_BUILD_OBJECT('success', true, 'appointment_id', v_appointment_id);
END $$;
```

**Why RPC?**
- Atomicity: all-or-nothing semantics
- No round-trips: single network call
- No race conditions: database handles locking
- Runs with SECURITY DEFINER (bypasses RLS if needed)

---

## Key TypeScript Interfaces

**File:** `supabase/functions/whatsapp-webhook/types.ts`

### Meta Webhook Types

```typescript
interface MetaWebhookEvent {
  object: 'whatsapp_business_account'
  entry: Array<{
    id: string
    changes: Array<{
      value: MetaWebhookValue
    }>
  }>
}

interface MetaWebhookValue {
  messaging_product: 'whatsapp'
  metadata: {
    display_phone_number: string
    phone_number_id: string
  }
  messages?: MetaMessage[]
  statuses?: MetaStatus[]
}

interface MetaMessage {
  from: string  // Sender phone (without +)
  id: string    // Message ID (for ACK)
  timestamp: string  // Unix timestamp
  type: 'text' | 'audio' | 'image' | 'button' | 'order' | 'interactive'
  text?: { body: string }
  audio?: {
    id: string
    mime_type?: string  // e.g., 'audio/ogg'
  }
  image?: { id: string; mime_type?: string }
  document?: { id: string; mime_type?: string }
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string }
  }
}

interface MetaStatus {
  id: string  // Message ID
  status: 'sent' | 'delivered' | 'read'
  timestamp: string
  recipient_id: string
}
```

### LLM Interfaces

```typescript
interface LlmResponse {
  choices?: Array<{
    message?: {
      content?: string
      role: 'assistant'
    }
    finish_reason: 'stop' | 'length' | 'content_filter'
  }>
  error?: {
    type: string
    message: string
    code?: string
  }
}

class LlmRateLimitError extends Error {
  constructor(public retrySeconds: number) {
    super(`Rate limited by LLM. Retry after ${retrySeconds}s`)
    this.name = 'LlmRateLimitError'
  }
}
```

### Audit Log

```typescript
interface AuditLogData {
  business_id: string
  sender_phone: string
  message_text: string  // Truncated to 500 chars
  ai_response?: string  // Full AI response or error
  status: 'RECEIVED' | 'PROCESSED' | 'RATE_LIMITED' | 'BOOKING_LIMIT_EXCEEDED'
  error_message?: string
  tool_calls?: Record<string, unknown>
}
```

---

## Performance Optimization

### Latency Targets

- **Message → AI Response:** <2 seconds
  - Rate limit check: <1ms
  - Slug routing: <5ms
  - AI call (Groq): ~1.2s
  - Overhead: ~0.8s
- **Voice → Transcription:** <3 seconds
  - Download: ~1.5s
  - Transcribe: ~1.5s
- **RLS Check:** <10ms per query
- **Atomic SQL:** <1ms (rate limit check)

### Caching Strategies

**React Query (Client):**
- Global query cache
- Stale-while-revalidate pattern
- Mutations update cache immediately (optimistic updates)

**Business Context (Hook):**
```typescript
const supabase = useMemo(() => createClient(), [])
const { data: business, isLoading } = useQuery({
  queryKey: ['business', businessId],
  queryFn: () => fetchBusiness(businessId),
  staleTime: 5 * 60 * 1000  // 5 minutes
})
```

**Session Cookie (Server):**
- User `active`/`rejected` status cached for 5 minutes
- Reduces Auth roundtrip on every dashboard navigation

**Database Indexes:**

```sql
-- wa_rate_limits lookups
CREATE INDEX idx_wa_rate_limits_sender_window
  ON wa_rate_limits(sender_phone, window_start DESC);

-- wa_booking_limits lookups
CREATE INDEX idx_wa_booking_limits_sender_business
  ON wa_booking_limits(sender_phone, business_id, window_start DESC);

-- wa_sessions lookups
CREATE INDEX idx_wa_sessions_sender_business
  ON wa_sessions(sender_phone, business_id);

-- Appointments filtering
CREATE INDEX idx_appointments_business_status
  ON appointments(business_id, status);

-- Audit logs archival queries
CREATE INDEX idx_wa_audit_logs_business_timestamp
  ON wa_audit_logs(business_id, timestamp DESC);
```

### Throughput Capacity

- **Concurrent Users:** ~1,000 per Vercel instance
- **WhatsApp Messages:** ~100/sec sustained (with rate limiting)
- **Database Connections:** 100 max (Supabase free tier), pooled via PgBouncer
- **Edge Function Concurrency:** 1,000 concurrent executions (Deno runtime)

---

## LLM Provider Abstraction

To change LLM providers (Groq → OpenAI, Anthropic, etc.), modify **2 files only**:

**supabase/functions/whatsapp-webhook/ai-agent.ts (lines 28–29):**
```ts
const LLM_API_URL = 'https://api.openai.com/v1/chat/completions'
const LLM_MODEL = 'gpt-4-turbo'
```

**lib/actions/voice-assistant.ts (lines 14–15):**
```ts
const LLM_API_URL = 'https://api.openai.com/v1/chat/completions'
const LLM_MODEL = 'gpt-4-turbo'
```

**Environment:** No change needed
- Same `LLM_API_KEY` env var for all OpenAI-compatible providers
- Works with Groq, OpenAI, Anthropic, Together AI, etc.

**Request Format (Universal OpenAI-Compatible):**
```typescript
{
  "model": "gpt-4-turbo",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "..." }
  ],
  "temperature": 0.1,
  "max_tokens": 500
}
```

**Why This Design?**
- Decouples business logic from provider implementation
- Single point of change (avoids grep-refactoring)
- Supports provider rotation (Groq down? Switch to OpenAI)
- No vendor lock-in at application level

---

## Error Handling & Logging

### Error Propagation

```
Layer 1 (Webhook)
  ↓ validate signature
  ↓ rate limit check (fail-secure: silent)
  ↓ extract message
  ↓ [if audio] transcribe
  │  ├─ Download fails → log, continue (ignore voice)
  │  ├─ Transcribe 429 → throw LlmRateLimitError (bubble up)
  │  └─ Transcribe other → log, continue (ignore voice)
  ↓ sanitize message
  ↓ route to business
  ↓ [if no business] → return landing page (graceful)
  ↓ call AI agent
  │  ├─ 429 → catch, send retry message, log as info, return 200
  │  ├─ other error → catch, send "server error" message, log as error, return 200
  └─ (always return 200 to Meta to confirm webhook receipt)
  ↓ parse action tags
  ↓ execute actions
  │  ├─ Database errors → log, include in response to user
  │  └─ Booking limit → send user message
  ↓ send response
  ↓ audit log
```

**Key Principle:** Never block the webhook (always return 200 to Meta)

### Logging Utility

**File:** `lib/logger.ts`

```typescript
export const logger = {
  info: (service: string, message: string, data?: unknown) => {
    console.log(`[${service}] ${message}`, data)
  },
  warn: (service: string, message: string, data?: unknown) => {
    console.warn(`[${service}] ${message}`, data)
  },
  error: (service: string, message: string, data?: unknown) => {
    console.error(`[${service}] ${message}`, data)
  }
}

// Usage:
logger.info('whatsapp-webhook', 'Message received', { from, text })
logger.warn('push-notify', 'Subscription failed', { endpoint, reason })
logger.error('ai-agent', 'LLM call failed', { error, url })
```

**Audit Logging**

All WhatsApp events logged to `wa_audit_logs`:

```typescript
await logAudit(supabase, {
  business_id: businessId,
  sender_phone: from,
  message_text: messageBody.slice(0, 500),
  ai_response: aiContent.slice(0, 1000),
  status: 'PROCESSED',
  tool_calls: { tags: parsedTags }
})
```

**Query Audit Logs:**
```sql
SELECT * FROM wa_audit_logs
WHERE business_id = '...'
ORDER BY timestamp DESC
LIMIT 100;
```

**Statuses:**
- `RECEIVED` — Message entered system
- `PROCESSED` — Fully handled, action executed
- `RATE_LIMITED` — Blocked by Layer 1
- `BOOKING_LIMIT_EXCEEDED` — Blocked by Layer 3
- `LLM_RATE_LIMITED` — Groq 429, user got retry message
- `ERROR` — Unexpected error, user got apology message

---

**Last Updated:** 2026-03-29

**Author:** Luis C.
## Luis IA V4 — Strategic Evolution & Hardening

The V4 evolution transforms Luis from a reactive assistant into a **Proactive Growth Agent**, implementing "Platinum Architecture" standards for resilience and security.

### 1. AI Shielding & Hardening (Defense in Depth)

We implement a 3-layer security system to protect the AI Orchestrator:

#### Layer 1: Prompt Firewall (Alignment)
The `SYSTEM_PROMPT` (managed in `assistant-prompt-helper.ts`) includes non-negotiable security directives:
- **Instruction Protection**: Explicitly forbids revealing internal prompts or system rules.
- **Jailbreak Resistance**: Ignores common injection patterns like "ignore previous instructions".
- **Purpose Alignment**: Refuses any request outside the scope of business management.

#### Layer 2: Domain Guardrails (Execution)
Every tool in `assistant-tools.ts` now features strict input validation:
- **Amount Validation**: `register_payment` rejects non-positive or suspiciously high amounts.
- **Date validation**: `book_appointment` validates dates to prevent ghost bookings in the far past or future.
- **Multi-tenant Verification**: Tools perform an explicit ownership check (client belongs to business) before execution.

#### Layer 3: Response Sanitization (Transport)
- **Error Masking**: Database or technical errors are caught at the `AssistantService` level. 
- **Friendly Fallback**: The user receives a polite "Technical difficulty" message instead of raw SQL or system traces, preventing architectural leakage.

### 2. CFO Advanced: Monthly Forecasting

Luis can now project revenue based on real-time data:
- **Logic**: Aggregates confirmed transactions + projected income from future appointments (based on service price).
- **Tool**: `get_monthly_forecast`.
- **Business Rule**: Only accounts for the current calendar month to maintain focus.

### 3. Active CRM: WhatsApp Reactivation

A strategic tool to recover "sleeping" revenue:
- **Inactive Detection**: Identifies clients without appointments in >60 days via `get_inactive_clients_rpc` (optimized at the DB level).
- **One-Click Reactivation**: A voice command ("Who hasn't come lately? ... Send them a message") triggers a template-based WhatsApp message via the `whatsapp-service` Edge Function.

### 4. Performance Shield (Platinum Infrastructure)

To ensure the "Executive Assistant" experience feels premium and lag-free:
- **DB Indexing**: Compound indexes on `start_at` and `paid_at` for sub-second BI queries.
- **RPC Migration**: Heavy data processing (like client filtering) moved from Node/Deno memory to PostgreSQL RPCs for maximum efficiency.
- **AbortController UX**: The dashboard voice greeting handles component unmounting professionally to avoid resource leaks.

---

## 10. B2B Crypto Payments Integration (NOWPayments)

### Architecture Diagram

The SaaS billing architecture is completely isolated from the final customer's transactions to ensure data purity. It uses Upstash QStash to guarantee webhook delivery and idempotency.

```text
Dashboard UI -> Select Plan ($10 / $15)
  ↓
Server Action (createInvoice)
  ├─ Calls NOWPayments API
  └─ Returns checkout URL
  ↓
Business Owner pays via Crypto Wallet
  ↓
NOWPayments IPN Webhook (POST /api/webhooks/nowpayments)
  ├─ Validates HMAC SHA-512 Signature
  ├─ Publishes to QStash Queue (Deduplication-Id = np_payment_id)
  └─ Returns 200 OK immediately
  ↓
QStash Worker (POST /api/queue/process-saas-payment)
  ├─ Normalizes Status (waiting, confirming, finished, partially_paid)
  ├─ Updates `saas_invoices` table
  ├─ If finished: Updates `businesses.plan` & `subscription_ends_at`
  └─ Inserts in-app Notification (Billing Success / Alert)
```

### Database Isolation

We strictly avoid polluting the `transactions` table (which is meant for B2C).
- **`saas_invoices`**: A dedicated table handling only NOWPayments B2B invoices.
- **`businesses.subscription_ends_at`**: A timestamp managing the SaaS lifecycle.

### Resilience & Idempotency (Vercel-Safe)

To prevent double-provisioning or race conditions in serverless environments:
1. **QStash Deduplication**: Every webhook payload from NOWPayments generates an `Upstash-Deduplication-Id` header based on the unique `payment_id`. QStash guarantees that duplicate webhooks (common in crypto networks) are rejected before hitting the worker.
2. **Asynchronous Processing**: Webhooks return `200 OK` in <50ms. All heavy DB logic and notifications happen in the background queue.
3. **Partial Payments (Crypto Chaos)**: If a business sends less crypto than required (`partially_paid`), the system creates a database alert but does *not* provision the plan.

### Lifecycle Management (CRON)

A daily CRON job (`/api/cron/check-subscriptions`) polls the `businesses` table:
```sql
UPDATE businesses
SET plan = 'free', subscription_ends_at = NULL
WHERE subscription_ends_at < NOW() AND plan != 'free';
```
This automatically degrades businesses that did not renew their crypto-subscription, requiring no manual intervention.

### UI & Realtime

- The `PlanManager` component subscribes to `saas_invoices` changes via **Supabase Realtime**.
- The dashboard automatically updates the active plan and displays a success state without requiring a page refresh, offering a seamless UX despite the asynchronous nature of blockchains.
