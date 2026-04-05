# Luis IA — Technical Integration Guide

> **"The voice of the business. An AI that listens, reasons, acts, and remembers."**

Luis IA is the **Executive Voice Assistant** embedded in the Cronix dashboard. It enables business owners to manage their entire operation — appointments, clients, payments, staff, and analytics — through natural voice commands in Spanish, with no UI interaction required.

This document reflects the **current production architecture** as of April 2026, including all reliability, performance, and timezone improvements applied during active development.

---

## Table of Contents

1. [Why Luis Exists](#1-why-luis-exists)
2. [Architecture Overview](#2-architecture-overview)
3. [End-to-End Pipeline](#3-end-to-end-pipeline)
4. [AI Models — Dual-Tier Routing](#4-ai-models--dual-tier-routing)
5. [Speech-to-Text (STT)](#5-speech-to-text-stt)
6. [Intelligence Layer — LLM + Tool Calling](#6-intelligence-layer--llm--tool-calling)
7. [Tool Registry — 16 Business Tools](#7-tool-registry--16-business-tools)
8. [Fuzzy Name Matching](#8-fuzzy-name-matching)
9. [Timezone Handling](#9-timezone-handling)
10. [Long-term Memory (RAG)](#10-long-term-memory-rag--vector-search)
11. [Text-to-Speech (TTS)](#11-text-to-speech-tts)
12. [Resilience Architecture](#12-resilience-architecture)
13. [Security](#13-security)
14. [Token Optimization](#14-token-optimization)
15. [UI/UX — The Floating Action Button](#15-uiux--the-floating-action-button)
16. [Engineering Decisions & Trade-offs](#16-engineering-decisions--trade-offs)
17. [Performance Profile](#17-performance-profile)
18. [File Reference](#18-file-reference)

---

## 1. Why Luis Exists

Small service businesses in Latin America (barbershops, salons, clinics, spas) have a fundamental operational problem: **the owner is always multitasking**. They have scissors in one hand, a client in the chair, and a ringing phone on the counter.

Luis solves this by giving them a **voice-controlled business brain** they can interact with without looking at a screen:

```
"Registra un cliente nuevo, Pedro Ramírez, 0414-123-4567"
"Agenda a María mañana a las 3 pm para un tinte"
"Cancela la cita de Adriana del jueves"
"¿Cuánto gané esta semana?"
"Reagenda a Alaysa para el 26 a las 10 am"
```

The result: zero interruption to the workflow. Zero screen time. The business manages itself.

---

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         LUIS IA — V5.1 SYSTEM                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────┐       ┌────────────────────────────────────┐   │
│  │   Browser / FAB UI  │       │   Next.js API Layer                │   │
│  │                     │       │                                    │   │
│  │  VoiceVisualizer    │       │  POST /api/assistant/voice         │   │
│  │  MediaRecorder      │◄─────►│  GET  /api/assistant/proactive     │   │
│  │  VAD Monitor        │       │  GET  /api/assistant/token         │   │
│  │                     │       │                                    │   │
│  └─────────────────────┘       └─────────────────┬──────────────────┘   │
│                                                  │                      │
│  ┌───────────────────────────────────────────────▼──────────────────┐   │
│  │               Zod Shield + Rate Limiter (10 req/min)              │   │
│  └───────────────────────────────────────────────┬──────────────────┘   │
│                                                  │                      │
│  ┌───────────────────────────────────────────────▼──────────────────┐   │
│  │                       AssistantService                            │   │
│  │                                                                   │   │
│  │  1. STT  → Groq Whisper (whisper-large-v3-turbo)                  │   │
│  │  2. Intent Detection → detectTier() [keyword, 0 tokens]           │   │
│  │  3. RAG  → memoryService.retrieve() [auto-disabled on failure]    │   │
│  │  4. LLM  → GroqProvider.chat(messages, tools, tier)               │   │
│  │       tier=fast    → llama-3.1-8b-instant (read queries)          │   │
│  │       tier=quality → llama-3.3-70b-versatile (write actions)      │   │
│  │  5. Tools → toolRegistry.execute(name, args, businessId, tz)      │   │
│  │  6. LLM Pass #2 → conversational synthesis (no tools)             │   │
│  │  7. Memory → memoryService.store() [async, non-blocking]          │   │
│  │  8. TTS  → DeepgramProvider → aura-2-nestor-es                    │   │
│  │                                                                   │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌───────────────────────┐    ┌────────────────────────────────────┐    │
│  │  Supabase Database    │    │  External AI Services              │    │
│  │  (PostgreSQL + RLS)   │    │                                    │    │
│  │                       │    │  Groq LPU                          │    │
│  │  ai_memories (vector) │    │   ├─ whisper-large-v3-turbo (STT)  │    │
│  │  appointments         │    │   ├─ llama-3.1-8b-instant          │    │
│  │  clients              │    │   └─ llama-3.3-70b-versatile       │    │
│  │  services             │    │                                    │    │
│  │  transactions         │    │  Deepgram                          │    │
│  │  users                │    │   └─ aura-2-nestor-es (TTS)        │    │
│  │  businesses           │    │                                    │    │
│  └───────────────────────┘    └────────────────────────────────────┘    │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐      │
│  │  Supabase Edge Function: embed-text (gte-small, 384-dim)       │      │
│  │  Auto-disabled after 3 consecutive failures (15 min cooldown)  │      │
│  └────────────────────────────────────────────────────────────────┘      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. End-to-End Pipeline

```
USER SPEAKS
     │
     ▼
[1] VAD (Voice Activity Detection) → MediaRecorder
     │  Opus/WebM audio. Stops after 1.2s of silence.
     │  Direct text input also supported (streaming mode).
     │
     ▼
[2] POST /api/assistant/voice
     │  FormData (audio blob) or JSON (text).
     │  Sends: { audio|text, timezone, history }
     │
     ▼
[3] Zod Shield + Auth
     │  Validates payload shape and roles.
     │  Extracts businessId from authenticated Supabase JWT.
     │  Rate limit: 10 requests/min per user.
     │
     ▼
[4] STT — Groq Whisper
     │  Audio → transcribed text (Spanish).
     │  Latency: ~850ms typical.
     │
     ▼
[5] detectTier(text) — Intent Classification
     │  Zero-token keyword scan on transcribed text.
     │  write keywords → tier='quality' → 70b model
     │  read queries  → tier='fast'    → 8b model
     │
     ▼
[6] RAG Retrieval (if embedding available)
     │  text → embed-text Edge Function → 384-dim vector
     │  pgvector HNSW cosine search → top-3 memories (threshold: 0.78)
     │  Timeout: 1.5s. Auto-disabled after 3 consecutive failures for 15 min.
     │
     ▼
[7] LLM Pass #1 (Groq — model selected by tier)
     │  System prompt: business context + HOY (user timezone) + UTC offset + memory
     │  User: transcribed text
     │  History: last 8 messages
     │  Output: message with optional tool_calls[]
     │  max_tokens: 256
     │
     ├── [7b] If tier=fast and write keywords detected but NO tool_calls:
     │         Automatic retry with quality tier (70b) — prevents silent failures.
     │
     ▼
[8] Tool Execution (if tool_calls present)
     │  For each tool_call → toolRegistry.execute(name, args, businessId, timezone)
     │  Each tool: Supabase query (RLS-isolated by businessId)
     │  Timeout: 10s per tool
     │  Results collected as tool messages
     │
     ▼
[9] LLM Pass #2 (same tier, NO tools sent — saves ~600 tokens)
     │  Input: all messages + tool results + validation prompt
     │  Output: final natural language response
     │  max_tokens: 256
     │
     ▼
[10] Memory Storage (async, fire-and-forget)
     │  If text > 25 chars AND no action performed:
     │  Sanitize → embed → INSERT ai_memories
     │
     ▼
[11] TTS — Deepgram Aura 2 (aura-2-nestor-es)
     │  Text → MP3 base64 audio
     │  Fallback: Browser SpeechSynthesis if Deepgram unavailable
     │
     ▼
[12] JSON Response → Client
      { text, audioUrl, actionPerformed, useNativeFallback, history, debug }
      │
      ▼
[13] Client Playback
      VoiceVisualizer animation → Audio.play()
      if actionPerformed → cronix:refresh-data event (calendar/list updates)
```

---

## 4. AI Models — Dual-Tier Routing

### The Problem
Using a single powerful model (`llama-3.3-70b-versatile`) for all requests exhausted the free tier limit of **100k tokens/day** within ~35-40 voice interactions.

### The Solution: Intent-Based Model Routing

```typescript
// lib/ai/assistant-service.ts
const WRITE_KEYWORDS = [
  'agenda', 'agendar', 'agend',
  'cancela', 'cancelar', 'cancel',
  'reagenda', 'reagendar', 'reagend',
  'cobra', 'cobrar', 'registra', 'registrar', 'pago', 'abono',
  'envía', 'enviar', 'manda', 'mandar', 'whatsapp',
  'cliente nuevo', 'nuevo cliente', 'agrega', 'agregar', 'crea', 'crear',
]

function detectTier(text: string): LlmTier {
  const lower = text.toLowerCase()
  return WRITE_KEYWORDS.some(k => lower.includes(k)) ? 'quality' : 'fast'
}
```

### Model Configuration

```typescript
// lib/ai/providers/groq-provider.ts
const MODEL_BY_TIER: Record<LlmTier, { primary: string; fallback: string }> = {
  quality: {
    primary:  'llama-3.3-70b-versatile',  // Reliable tool calling for writes
    fallback: 'llama-3.1-8b-instant',     // Emergency fallback
  },
  fast: {
    primary:  'llama-3.1-8b-instant',     // 500k TPD free tier — abundant
    fallback: 'llama-3.3-70b-versatile',  // Upgrade if 8b struggles
  },
}
```

### Model Tiers

| Model | Tier | Groq Free TPD | Best For |
|---|---|---|---|
| `llama-3.1-8b-instant` | fast | **500,000 tokens/day** | Read queries, info retrieval |
| `llama-3.3-70b-versatile` | quality | 100,000 tokens/day | Write actions, complex tool calling |

### Routing Logic by Request Type

| User says | Detected tier | Model used |
|---|---|---|
| "¿Qué servicios hay?" | fast | llama-3.1-8b-instant |
| "¿Cuánto gané hoy?" | fast | llama-3.1-8b-instant |
| "¿Quiénes son mis clientes?" | fast | llama-3.1-8b-instant |
| "Agenda a María para el viernes" | quality | llama-3.3-70b-versatile |
| "Cancela la cita de Adriana" | quality | llama-3.3-70b-versatile |
| "Registra un cobro de 50 mil" | quality | llama-3.3-70b-versatile |

**Zero overhead:** The intent detection is a local keyword scan — no extra LLM call, no latency, no tokens consumed.

### Write-Intent Safety Net

If `tier=fast` is selected but the LLM returns no `tool_calls` on a request that contains write keywords, the system automatically retries with the quality tier:

```typescript
// lib/ai/assistant-service.ts
if (tier === 'fast' && !llmRes.message.tool_calls?.length) {
  const writeIntent = detectTier(sttRes.text) === 'quality'
  if (writeIntent) {
    const retryRes = await this.llm.chat(messages, toolDefinitions, 'quality')
    if (!retryRes.error && retryRes.message.tool_calls?.length) {
      Object.assign(llmRes, retryRes)
    }
  }
}
```

---

## 5. Speech-to-Text (STT)

**Provider:** Groq Whisper (`whisper-large-v3-turbo`)

```typescript
// lib/ai/resilience.ts — safeSTT()
formData.append('model', 'whisper-large-v3-turbo')
formData.append('language', 'es')
// POST https://api.groq.com/openai/v1/audio/transcriptions
```

**Input formats:** WebM (Opus codec from MediaRecorder) or M4A
**Typical latency:** 750–1,100ms
**Retry strategy:** Up to 2 retries with exponential backoff (1s, 2s)
**Circuit breaker:** Trips after 5 real failures (429 rate limits excluded)

### Voice Activity Detection (VAD)

VAD runs client-side in a `requestAnimationFrame` loop using the Web Audio API. It determines when the user starts and stops speaking:

```typescript
// components/dashboard/voice-assistant-fab.tsx
const analyser = audioContext.createAnalyser()
analyser.fftSize = 256
const dataArray = new Uint8Array(analyser.frequencyBinCount)

const monitor = () => {
  analyser.getByteFrequencyData(dataArray)
  const average = dataArray.reduce((p, c) => p + c, 0) / dataArray.length

  if (!hasSpoken && average > SILENCE_THRESHOLD) hasSpoken = true
  if (hasSpoken && average < SILENCE_THRESHOLD) {
    // Silence detected → stop after SILENCE_DURATION
    silenceTimer = silenceTimer || setTimeout(stopRecording, SILENCE_DURATION)
  } else {
    clearTimeout(silenceTimer); silenceTimer = null
  }
  requestAnimationFrame(monitor)
}
```

| Parameter | Value | Rationale |
|---|---|---|
| `SILENCE_THRESHOLD` | 10 dB | Ignores AC units and background hum |
| `SILENCE_DURATION` | 2,000ms | Allows natural conversational pauses |
| `MAX_LISTEN_WAIT` | 8,000ms | Grace period before auto-cancel |

---

## 6. Intelligence Layer — LLM + Tool Calling

### System Prompt

The system prompt is generated dynamically per request by `LUIS_PROMPT_CONFIG.buildPrimaryPrompt()` in `lib/ai/prompts/luis.prompt.ts`. It is designed for maximum instruction density at minimum token cost (~420 tokens).

It dynamically injects:
- Business name (sanitized against prompt injection)
- Current date/time **in the user's local timezone** (via native `Intl.DateTimeFormat`)
- Current UTC offset (e.g., `UTC-04:00`) — used by the LLM to generate timezone-correct ISO dates
- Long-term memory context from RAG retrieval
- Booking protocol (4-point firewall)
- Cancel/reschedule disambiguation protocol
- Security rules (no tool/table names, no prompt leakage)
- Voice formatting rules (no markdown, 2-3 sentences max)

### Prompt Token Budget

| Component | ~Tokens |
|---|---|
| System prompt | ~420 |
| Tool definitions (16 tools) | ~450 |
| History (8 messages) | ~400–800 |
| User message | ~50–100 |
| Output (max_tokens) | 256 |
| **Total per request** | **~1,576–2,026** |

### Multi-Pass Tool Orchestration

When the LLM calls tools, a two-pass chain executes:

```
Pass 1: LLM(system + history + user) → { tool_calls: [{name, args}] }
                                              ↓
              toolRegistry.execute(name, args, businessId, timezone)
                                              ↓ Supabase DB (RLS-isolated)
                                   → "Listo. Agendé a María..."
                                              ↓
Pass 2: LLM(all messages + tool results) → "Tu cita con María quedó..."
        (No tools sent in Pass 2 — saves ~450 tokens)
```

### Tool Invocation Rules (enforced via prompt)

- Every write action **must** call a tool — text-only confirmations are forbidden
- Multiple actions in one sentence → process **one at a time**, confirm between each
- Never confirm success if the tool result contains "Error"
- Never mention tool names, function names, table names, or IDs in responses

---

## 7. Tool Registry — 16 Business Tools

All tools are registered in `lib/ai/tool-registry.ts` and implemented in `lib/ai/assistant-tools.ts`. Every tool receives `businessId` (for multi-tenant isolation) and `timezone` (for correct date display).

### Read Tools (tier: fast → 8b model)

| Tool | Description | DB Tables |
|---|---|---|
| `get_services` | Service catalog with prices and durations | `services` |
| `get_clients` | Client list with fuzzy name search | `clients` |
| `get_staff` | Team members with fuzzy search | `users` |
| `get_today_summary` | Daily income + appointment counts | `appointments`, `transactions` |
| `get_upcoming_gaps` | Occupied time blocks today | `appointments` |
| `get_client_debt` | Completed appointments without payment | `appointments` |
| `get_client_appointments` | Upcoming active appointments for a client | `appointments`, `services`, `users` |
| `get_inactive_clients` | Clients with no visit in 60+ days (RPC) | `appointments` |
| `get_revenue_stats` | This week vs last week revenue | `transactions` |
| `get_monthly_forecast` | Projected month-end revenue | `appointments`, `services`, `transactions` |

### Write Tools (tier: quality → 70b model)

| Tool | Description | DB Operation |
|---|---|---|
| `create_client` | Registers a new client; verifies duplicates with fuzzy match | INSERT `clients` |
| `book_appointment` | Creates a new appointment with conflict detection | INSERT `appointments`, `appointment_services` |
| `cancel_appointment` | Cancels an appointment (sets `status='cancelled'`, `cancelled_at`) | UPDATE `appointments` |
| `reschedule_appointment` | Moves appointment to new date/time (atomic in-place update) | UPDATE `appointments` |
| `register_payment` | Records a client payment | INSERT `transactions` |
| `send_reactivation_message` | Sends WhatsApp reactivation to inactive client | External WhatsApp API |

### Multi-Appointment Disambiguation

A critical improvement over naive "cancel next appointment" logic:

```typescript
// cancel_appointment — if client has multiple upcoming appointments:
if (appointment_date) {
  // Target the specific appointment on that day
  target = appts.find(a => isSameDay(a.start_at, appointment_date))
} else if (appts.length > 1) {
  // Return the list — let the user choose
  return `María tiene varias citas:\n- Corte el martes 8 a las 10 am\n- Tinte el jueves 10 a las 3 pm\n¿Cuál deseas cancelar?`
} else {
  // Single appointment — proceed directly
  target = appts[0]
}
```

Same pattern applies to `reschedule_appointment` via the optional `old_date` parameter.

### Booking Safeguards

`book_appointment` enforces:
1. **Time required:** Rejects dates without a time component
2. **Anti-backdating:** Rejects dates more than 1 year in the past
3. **Conflict detection:** Queries overlapping `pending`/`confirmed` appointments before INSERT
4. **Client validation:** Fuzzy match — never invents a client
5. **Service validation:** Fuzzy match — never invents a service

### Client Registration Safeguards

`create_client` enforces:
1. **Duplicate detection:** Fuzzy matches existing clients; if found, informs user without creating duplicate
2. **Phone required:** Cannot register without phone number (needed for WhatsApp reminders)
3. **Email optional:** Can accept email but not required
4. **No duplicate registration:** Uses fuzzy similarity (≥0.45 threshold) to detect similar names and prevent duplicates

---

## 8. Fuzzy Name Matching

`lib/ai/fuzzy-match.ts` — Pure utility, zero dependencies. Resolves spoken names to database UUIDs.

### Algorithm

1. **Normalize:** Lowercase, accent removal (á→a, ñ→n, etc.), whitespace collapse
2. **Exact substring:** If target contains the spoken name → score 0.98
3. **Word-by-word Levenshtein:** Checks each word in the full name against the spoken name
4. **Global Levenshtein:** Full name vs spoken name as fallback
5. **Score = max(wordScore, globalScore)**

### Thresholds

| Threshold | Value | Effect |
|---|---|---|
| Match threshold | 0.45 | Tolerant — handles heavy voice distortion |
| Ambiguity gap | 0.15 | If top-2 scores differ by < 0.15 → ambiguous |

### Result Types

```typescript
type FuzzyResult<T> =
  | { status: 'found';     match: T }       // Clear winner
  | { status: 'ambiguous'; candidates: T[] } // LLM asks for clarification
  | { status: 'not_found' }                  // Nothing passes threshold
```

**Example:** "Alaiza" spoken → matches "Alaysa" (Levenshtein similarity ~0.71) → `found`
**Example:** "María" → matches "María López" and "María García" → `ambiguous`

---

## 9. Timezone Handling

Cronix serves users across all timezones (Venezuela UTC-4, Argentina UTC-3, France UTC+2, etc.). Every part of the pipeline is timezone-aware.

### Timezone Flow

```
Client sends timezone string: "America/Caracas"
         │
         ▼
[1] Prompt: formatUserNow("America/Caracas")
         → "sábado 4 de abril de 2026, 8:00 p. m." (user's local time)
         
[2] Prompt: getUtcOffset("America/Caracas")
         → "-04:00"
         
[3] System prompt includes:
    "HOY: sábado 4 de abril de 2026, 8:00 p. m. | Zona: America/Caracas (UTC-04:00)"
    "Genera fechas ISO con offset: 2026-04-05T09:00:00-04:00"
         │
         ▼
[4] LLM generates: date = "2026-04-05T09:00:00-04:00"
         │
         ▼
[5] parseISO("2026-04-05T09:00:00-04:00")
         → Date at 13:00:00 UTC (correct!)
         
[6] Stored in Supabase (timestamptz): "2026-04-05T13:00:00Z"
         │
         ▼
[7] Tool response: fmtUserDate("2026-04-05T13:00:00Z", "America/Caracas", "h:mm a")
         → "9:00 a.m." (correct local time shown to user)
```

### Implementation — No Extra Packages

All timezone logic uses native `Intl` API (built into Node.js):

```typescript
// lib/ai/prompts/luis.prompt.ts

function getUtcOffset(timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date())
  const raw = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT'
  // raw = "GMT-4" → returns "-04:00"
  const match = raw.match(/GMT([+-])(\d+)(?::(\d+))?/)
  if (!match) return '+00:00'
  return `${match[1]}${String(match[2]).padStart(2, '0')}:${String(match[3] ?? '0').padStart(2, '0')}`
}

// lib/ai/assistant-tools.ts

function toUserDate(isoString: string, timezone: string): Date {
  const utc = new Date(isoString)
  const utcMs = new Date(utc.toLocaleString('en-US', { timeZone: 'UTC' })).getTime()
  const tzMs  = new Date(utc.toLocaleString('en-US', { timeZone: timezone })).getTime()
  return new Date(utc.getTime() + (tzMs - utcMs))
}
```

### Timezone Examples

| User location | UTC offset | "9 am tomorrow" stored as | Luis says |
|---|---|---|---|
| Venezuela | UTC-4 | `2026-04-05T13:00:00Z` | "domingo 5 de abril a las 9:00 a.m." |
| Argentina | UTC-3 | `2026-04-05T12:00:00Z` | "domingo 5 de abril a las 9:00 a.m." |
| France (CEST) | UTC+2 | `2026-04-05T07:00:00Z` | "dimanche 5 avril à 9h00" |
| Colombia | UTC-5 | `2026-04-05T14:00:00Z` | "domingo 5 de abril a las 9:00 a.m." |

---

## 10. Long-term Memory (RAG + Vector Search)

### Problem

In-memory session history resets on every page reload. An owner who tells Luis "my Fridays close at 3 pm" would have to repeat it every session.

### Solution: Perpetual Vector Memory

```
User says something factual (> 25 chars, not a tool action)
        ↓
Sanitize (remove prompt injection attempts)
        ↓
embed-text() → 384-dim vector (GTE-small via Supabase AI runtime)
        ↓
INSERT ai_memories (user_id, business_id, content, embedding)
        ↓
Next conversation:
embed-text(query) → cosine similarity search (HNSW index)
        ↓
Top-3 matches (threshold 0.78) injected into system prompt
```

### Edge Function: embed-text

```typescript
// supabase/functions/embed-text/index.ts
const model = new Supabase.ai.Session('gte-small')
const embedding = await model.run(text, {
  mean_pool: true,   // Stable sentence-level vectors
  normalize: true,   // L2 normalization for cosine compatibility
})
// Returns: float32[384]
```

**Why GTE-small:**
- Zero cost — runs inside Supabase Edge Runtime
- No external API key
- Multilingual — handles Spanish natively
- 384 dimensions — fast HNSW search, small storage footprint

### Auto-Disable Circuit

The Edge Function is not always reliable. To prevent it from blocking every request:

```typescript
// lib/ai/memory-service.ts
private consecutiveFailures = 0
private disabledUntil = 0

// After 3 consecutive failures → disabled for 15 minutes
if (this.consecutiveFailures >= 3) {
  this.disabledUntil = Date.now() + 15 * 60 * 1000
}
// Each embedding call has a 1.5s timeout (Promise.race)
```

### Memory Storage Policy

```typescript
// Only store substantial, factual inputs — not ephemeral queries
if (sttRes.text.length > 25 && !actionPerformed) {
  memoryService.store(userId, businessId, sanitized, { type: 'user_fact' })
  // Non-blocking — no await
}
```

Quota: max 500 memories per user (FIFO eviction when exceeded).

### pgvector Search

```sql
SELECT content, 1 - (embedding <=> query_embedding) AS similarity
FROM ai_memories
WHERE user_id = p_user_id
  AND business_id = p_business_id
  AND 1 - (embedding <=> query_embedding) > 0.78
ORDER BY similarity DESC
LIMIT 3;
-- Index: HNSW with vector_cosine_ops
```

---

## 11. Text-to-Speech (TTS)

**Primary:** Deepgram Aura 2 (`aura-2-nestor-es`)

| Parameter | Value |
|---|---|
| Voice | Male, Spanish, Latin American baritone |
| Format | MP3 (returned as base64 data URL) |
| Endpoint | `https://api.deepgram.com/v1/speak?model=aura-2-nestor-es` |
| Typical latency | 1,500–3,500ms |

**Fallback:** Browser `SpeechSynthesis` API when Deepgram is unavailable:
```typescript
const utterance = new SpeechSynthesisUtterance(text)
utterance.lang = 'es-MX'
utterance.pitch = 0.7   // Forced baritone — preserves Luis's identity
utterance.rate = 0.95
// Prioritizes: Raul, Pablo, David, Jose (Spanish male voices)
```

The fallback maintains Luis's identity even in degraded mode.

---

## 12. Resilience Architecture

### Circuit Breaker

Three independent circuit breakers: `STT`, `LLM`, `TTS`.

```
CLOSED (healthy)
    │
    ├─ 5 real failures → OPEN (fail fast)
    │                        │
    │                        └─ 5 min cooldown
    │                                │
    └──────── HALF-OPEN (probe) ◄────┘
```

**Critical improvement:** Rate limit errors (HTTP 429) are **excluded** from the failure counter. A 429 is a temporary quota issue, not a service outage — counting it would incorrectly trip the breaker and block all requests for 5 minutes.

```typescript
// lib/ai/circuit-breaker.ts
if (errorStr.includes('rate_limit_exceeded')) {
  logger.warn('CIRCUIT-BREAKER', `${service} rate limited — skipping failure count`)
  return // Do NOT increment failure counter
}
```

### safeLLM — API Resilience Wrapper

```typescript
// lib/ai/resilience.ts
export async function safeLLM(
  messages, tools, apiKey,
  primaryModel = 'llama-3.1-8b-instant',
  fallbackModel = 'llama-3.3-70b-versatile'
): Promise<AIResponse<any>>
```

Flow: Try primary → if fails → log warning → try fallback → if both fail → return error.

### Graceful Audio Fallback on LLM Failure

Instead of returning a 500 error (silent failure for the user), Luis now synthesizes a friendly audio response:

```typescript
// lib/ai/assistant-service.ts
if (llmRes.error) {
  const isRateLimit = llmRes.error.includes('rate_limit')
  const fallbackText = isRateLimit
    ? 'Estoy con mucha demanda en este momento. Por favor, inténtalo de nuevo en unos minutos.'
    : 'Tuve un problema técnico al procesar tu solicitud. Por favor, inténtalo de nuevo.'
  const ttsRes = await this.tts.synthesize(fallbackText)
  return { text: fallbackText, audioUrl: ttsRes.audioUrl, ... }
}
```

The user hears a human explanation instead of experiencing silent failure.

### Rate Limiting

```typescript
// lib/api/rate-limit.ts
export const assistantRateLimiter = new MemoryRateLimiter(10, 60 * 1000) // 10 req/min
```

Sliding window, in-memory. Bounded cache (max 5,000 identifiers) to prevent memory exhaustion. Keyed on `user.id` (never IP — prevents spoofing).

**Production note:** For multi-instance deployments (Vercel serverless), migrate to Upstash Redis for global rate enforcement across instances.

### Exponential Backoff (STT)

```typescript
// lib/ai/resilience.ts
retryCount++
await sleep(INITIAL_DELAY * Math.pow(2, retryCount)) // 2s, 4s
```

---

## 13. Security

### Multi-Tenant Isolation

Every database query in every tool is bound by `business_id` extracted from the **authenticated JWT session** on the server. The client cannot forge a business ID.

```typescript
// app/api/assistant/voice/route.ts
const { data: dbUser } = await supabase
  .from('users')
  .select('business_id, business:businesses(name)')
  .eq('id', user.id)   // ← from verified JWT, never from client
  .single()
```

All Supabase tables have Row Level Security policies enforcing `business_id` and `user_id` isolation.

### Prompt Injection Defense

User inputs are sanitized before being stored as memories:

```typescript
const sanitized = sttRes.text
  .replace(/ignora?\s+(todas?\s+)?las?\s+instrucciones?/gi, '')
  .replace(/system\s*prompt/gi, '')
  .replace(/(eres|actúa|compórtate)\s+(como|ahora)/gi, '')
  .replace(/olvida\s+(todo|tus\s+reglas)/gi, '')
  .replace(/<[^>]+>/g, '')
  .trim()
```

### Prompt Param Sanitization

Business names and timezone strings injected into the system prompt are sanitized:

```typescript
function sanitizePromptParam(value: string): string {
  return value
    .replace(/[*#`_~\[\]{}|<>\\]/g, '')  // Strip markdown/structural chars
    .replace(/\n/g, ' ')                   // Prevent newline injection
    .slice(0, 100)                         // Hard length cap
    .trim()
}
```

### Deepgram API Key Protection

The Deepgram API key never reaches the browser. A dedicated endpoint (`/api/assistant/token`) generates short-lived, scoped tokens (TTL: 300s, scope: `usage:runtime`).

### Tool Execution Timeout

Each tool call is raced against a 10-second timeout to prevent hanging on slow DB or external API calls:

```typescript
const timeoutPromise = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error('Tool execution timeout (10s)')), 10_000)
)
const toolResult = await Promise.race([toolPromise, timeoutPromise])
```

---

## 14. Token Optimization

A key engineering focus given Groq's free tier limits.

### Reductions Applied

| Optimization | Before | After | Savings |
|---|---|---|---|
| System prompt | ~830 tokens | ~420 tokens | **410 tokens/req** |
| Tool descriptions | ~800 tokens | ~450 tokens | **350 tokens/req** |
| History window | 16 messages | 8 messages | **~400 tokens/req** |
| max_tokens | 1,024 | 256 | **768 tokens/req** |
| Tools in Pass 2 | All 16 tools | None | **~450 tokens/req** |
| **Total savings** | | | **~2,378 tokens/req (~60%)** |

### Model Routing Impact on TPD

| Scenario | Daily capacity (est. 1,800 tokens/req avg) |
|---|---|
| All requests on 70b (before) | ~55 requests/day |
| Model routing: ~60% on 8b | ~390 requests/day (8b) + ~55 writes (70b) |

---

## 15. UI/UX — The Floating Action Button

### State Machine

```
idle ──[click]──► listening ──[VAD stop]──► processing ──[audio ready]──► speaking
 ▲                                                                             │
 └──────────────────────────[audio ended / click]────────────────────────────┘
```

### VoiceVisualizer

5 animated bars driven by real-time microphone volume (Web Audio `AnalyserNode`):

```tsx
<motion.div
  animate={{
    height: isActive
      ? isSpeaking
        ? [8, 16, 8]                                          // Breathing animation
        : Math.max(4, volume * (1 + Math.sin(i*45) * 0.5) * 20) // Reactive to voice
      : 4                                                     // Idle (flat)
  }}
  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
  style={{ background: 'linear-gradient(to top, #3884FF, #A855F7, #EC4899)' }}
/>
```

`Math.sin(i * 45)` staggers bar heights for an organic wave shape.

### Drag & Persistence

- Fully draggable via Framer Motion `drag="y"`
- Position saved to `localStorage` — the owner parks it once, stays forever
- Spring physics: `{ stiffness: 300, damping: 30 }`

### Proactive Greeting

On first dashboard load per session, Luis greets proactively with a contextual summary:

```typescript
// Fires once per browser session (gated by sessionStorage)
setTimeout(async () => {
  const res = await fetch('/api/assistant/proactive')
  const { audioUrl } = await res.json()
  if (audioUrl) new Audio(audioUrl).play()
}, 2000)
```

---

## 16. Engineering Decisions & Trade-offs

### Decision 1: HTTP POST over WebSocket

**Alternative:** Maintain a persistent WebSocket for real-time streaming.

**Why HTTP POST:**
- WebSockets are fragile on Latin American 4G networks (the primary target market)
- Stateless requests survive connection drops, background tab switches, and mobile browser throttling
- No reconnection logic, no heartbeat, no token management complexity
- The 750–1,100ms STT latency overhead is acceptable for voice turn-based interaction

### Decision 2: Dual-Model Routing over Single Model

**Alternative:** Use `llama-3.3-70b-versatile` for all requests.

**Why routing:**
- The 70b free tier (100k TPD) was exhausted in ~35-40 requests/day
- The 8b model handles read queries (60% of traffic) perfectly well
- The 70b is reserved exclusively for write actions where tool-calling reliability matters most
- Result: ~7x more daily capacity

### Decision 3: GTE-small over OpenAI Embeddings

**Alternative:** OpenAI `text-embedding-3-small`.

**Why GTE-small:**
- Zero cost — runs inside Supabase Edge Runtime natively
- No additional API key
- Quality sufficient for conversational memory (cosine threshold 0.78)
- When the Edge Function is unreliable, the auto-disable circuit prevents it from degrading every request

### Decision 4: Fuzzy Matching over Exact Search

**Alternative:** Require LLM to provide exact client IDs.

**Why fuzzy matching:**
- Voice transcription introduces consistent distortion: "Alaysa" → "Alaiza", "María García" → "María"
- Levenshtein similarity at 0.45 threshold handles real-world transcription errors
- The `ambiguous` result type gracefully surfaces clarification to the user
- All matching is server-side — the LLM never needs to know UUIDs

### Decision 5: Fire-and-Forget Memory Storage

**Alternative:** `await memoryService.store(...)` for guaranteed writes.

**Why fire-and-forget:**
- Memory storage adds 200–500ms if awaited (embedding call + DB insert)
- Memory is a best-effort optimization, not a critical business operation
- The user hears the audio response immediately — no perceptible delay
- Failed writes are silent; the next interaction simply won't have that memory

### Decision 6: Per-Request Tool Schemas (no caching)

**Alternative:** Pre-compute tool schemas once.

**Current status:** Tool schemas are already computed once at registry initialization (`new ToolRegistry()` in module scope). The `getDefinitions()` call is O(n) array map over an in-memory Map — effectively free.

---

## 17. Performance Profile

| Metric | Value | Notes |
|---|---|---|
| STT latency | 750–1,100ms | Groq Whisper (whisper-large-v3-turbo) |
| LLM latency (8b) | 400–800ms | llama-3.1-8b-instant |
| LLM latency (70b) | 800–1,500ms | llama-3.3-70b-versatile |
| TTS latency | 1,500–4,000ms | Deepgram Aura 2 |
| Total pipeline (read) | ~2.5–4s | STT + 8b + TTS |
| Total pipeline (write) | ~3–6s | STT + 70b + tool + 70b + TTS |
| Memory retrieval | <80ms | HNSW pgvector index |
| Embedding (when up) | <1,500ms | Timeout-limited |
| Tool execution | <500ms typical | 10s hard timeout |
| Rate limit | 10 req/min/user | Sliding window |

---

## 18. File Reference

| File | Responsibility |
|---|---|
| [`app/api/assistant/voice/route.ts`](../../app/api/assistant/voice/route.ts) | Main voice endpoint — polymorphic input (audio/text), Zod validation, RLS, provider injection |
| [`app/api/assistant/token/route.ts`](../../app/api/assistant/token/route.ts) | Short-lived Deepgram token generation (TTL 300s, scope: usage:runtime) |
| [`lib/ai/assistant-service.ts`](../../lib/ai/assistant-service.ts) | Core orchestrator — STT, intent detection, RAG, LLM multi-pass, tool dispatch, memory sync, audio fallback |
| [`lib/ai/prompts/luis.prompt.ts`](../../lib/ai/prompts/luis.prompt.ts) | System prompt builder — timezone-aware, compact, injection-resistant |
| [`lib/ai/tool-registry.ts`](../../lib/ai/tool-registry.ts) | Tool registry — maps schemas to handlers, passes businessId + timezone |
| [`lib/ai/assistant-tools.ts`](../../lib/ai/assistant-tools.ts) | 16 business tools (READ + WRITE) — RLS-scoped, timezone-aware date formatting |
| [`lib/ai/fuzzy-match.ts`](../../lib/ai/fuzzy-match.ts) | Levenshtein fuzzy matcher — resolves spoken names to DB entities |
| [`lib/ai/memory-service.ts`](../../lib/ai/memory-service.ts) | Vector memory — embed, store, retrieve, auto-disable circuit |
| [`lib/ai/memory.ts`](../../lib/ai/memory.ts) | Short-term in-memory session store (last 8 messages per user) |
| [`lib/ai/resilience.ts`](../../lib/ai/resilience.ts) | `safeSTT`, `safeLLM`, `safeTTS`, `safeDeepgramTTS` — retry + fallback wrappers |
| [`lib/ai/circuit-breaker.ts`](../../lib/ai/circuit-breaker.ts) | AICircuitBreaker — CLOSED/OPEN/HALF-OPEN state machine per service (429-aware) |
| [`lib/ai/providers/types.ts`](../../lib/ai/providers/types.ts) | Provider interfaces: `ISttProvider`, `ILlmProvider`, `ITtsProvider`, `LlmTier` |
| [`lib/ai/providers/groq-provider.ts`](../../lib/ai/providers/groq-provider.ts) | Groq adapter — dual-tier model routing, implements STT + LLM interfaces |
| [`lib/ai/providers/deepgram-provider.ts`](../../lib/ai/providers/deepgram-provider.ts) | Deepgram adapter — implements ITtsProvider |
| [`lib/api/rate-limit.ts`](../../lib/api/rate-limit.ts) | Sliding window rate limiter (10 req/min, bounded 5k-entry cache) |
| [`components/dashboard/voice-assistant-fab.tsx`](../../components/dashboard/voice-assistant-fab.tsx) | Full FAB — VAD, VoiceVisualizer, FormData submission, state machine, drag/persist |
| [`supabase/functions/embed-text/index.ts`](../../supabase/functions/embed-text/index.ts) | Edge Function — GTE-small embeddings via Supabase AI runtime (384-dim) |

---

*Last updated: April 4, 2026 — Luis IA V5.1*
*Cronix AI Engineering — Built for Latin American service businesses*
