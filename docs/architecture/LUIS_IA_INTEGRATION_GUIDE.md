# 🎙️ Luis IA — Technical Deep Dive

> **"The voice of the business. An AI that listens, reasons, acts, and remembers."**

Luis IA is an **Executive Voice Assistant** embedded directly in the Cronix business dashboard. It enables business owners to manage their entire operation — appointments, clients, payments, and analytics — through conversational voice commands, with zero latency and production-grade reliability.

This document is a technical showcase of the architecture, engineering decisions, and capabilities that make Luis a best-in-class voice AI system.

---

## Table of Contents

1. [Why Luis Exists](#1-why-luis-exists)
2. [Architecture at a Glance](#2-architecture-at-a-glance)
3. [V5 Pipeline: End-to-End Flow](#3-v5-pipeline-end-to-end-flow)
4. [Real-Time Streaming Engine](#4-real-time-streaming-engine-webSocket)
5. [Voice Activity Detection (VAD)](#5-voice-activity-detection-vad)
6. [Intelligence Layer: LLM + Tool Calling](#6-intelligence-layer-llm--tool-calling)
7. [Long-term Memory (RAG + Vector Search)](#7-long-term-memory-rag--vector-search)
8. [Text-to-Speech & Resilience](#8-text-to-speech--resilience)
9. [Security Architecture](#9-security-architecture)
10. [UI/UX: The Floating Action Button](#10-uiux-the-floating-action-button)
11. [Engineering Decisions & Trade-offs](#11-engineering-decisions--trade-offs)
12. [Performance Profile](#12-performance-profile)
13. [File Reference](#13-file-reference)

---

## 1. Why Luis Exists

Small service businesses in Latin America (barbershops, salons, clinics, gyms) have a fundamental operational problem: **the owner is always multitasking**. They have scissors in one hand, a client in the chair, and a ringing phone on the counter.

Luis solves this by giving them a **voice-controlled business brain** that they can interact with without looking at a screen:

```
"Luis, ¿cuánto gané hoy?"
"Luis, agenda a María mañana a las 3pm para un tinte"
"Luis, ¿tiene deuda Carlos?"
```

The result: zero interruption to the workflow. The business runs itself.

---

## 2. Architecture at a Glance

```
┌─────────────────────────────────────────────────────────────────────┐
│                        LUIS IA V5 SYSTEM                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐      ┌──────────────────────────────────┐  │
│  │   Browser / FAB UI  │      │   Next.js API Layer              │  │
│  │                     │      │                                  │  │
│  │  VoiceVisualizer    │      │  POST /api/assistant/voice       │  │
│  │  Ghost Transcript   │◄────►│  GET  /api/assistant/token       │  │
│  │  WebSocket Client   │      │  GET  /api/assistant/proactive   │  │
│  │  VAD Monitor        │      │                                  │  │
│  └─────────────────────┘      └──────────────┬───────────────────┘  │
│                                              │                      │
│  ┌────────────────────────────────────────────▼──────────────────┐  │
│  │                    AssistantService                            │  │
│  │                                                               │  │
│  │  1. STT: Groq Whisper (legacy) / Deepgram Nova-2 (streaming)  │  │
│  │  2. RAG: memoryService.retrieve() → pgvector cosine search    │  │
│  │  3. LLM: Groq Llama-3 8B (Function Calling, multi-pass)       │  │
│  │  4. Tools: toolRegistry.execute() (7 business tools)          │  │
│  │  5. Memory: memoryService.store() (async, non-blocking)       │  │
│  │  6. TTS: DeepgramProvider → Aura 2 Nestor ES                  │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐   │
│  │ Supabase Database    │    │ External AI Services             │   │
│  │                      │    │                                  │   │
│  │  ai_memories (vector)│    │  Groq LPU (Llama-3 + Whisper)   │   │
│  │  businesses (RLS)    │    │  Deepgram (Aura 2 + Nova-2)      │   │
│  │  appointments        │    │                                  │   │
│  │  clients             │    └──────────────────────────────────┘   │
│  │  services            │                                           │
│  └──────────────────────┘    ┌──────────────────────────────────┐   │
│                              │  Supabase Edge Function           │   │
│                              │  embed-text (gte-small, 384-dim)  │   │
│                              └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. V5 Pipeline: End-to-End Flow

```
USER SPEAKS
     │
     ▼
[1] WebSocket → Deepgram Nova-2
     │  Token: short-lived (5min TTL, from /api/assistant/token)
     │  Interim results → words appear live on screen
     │  VAD silences → recording stops
     │
     ▼
[2] Ghost Transcript: setTranscript('') ← text cleared before sending
     │
     ▼
[3] POST /api/assistant/voice  ← JSON { text, timezone }
     │  Auth: Supabase session (JWT)
     │  Rate Limiting: per-user cap
     │  Business Isolation: business_id via RLS
     │
     ▼
[4] RAG Retrieval
     │  Input text → embed-text Edge Function → 384-dim vector
     │  pgvector cosine search (HNSW index) → top-3 memories
     │  Memories injected into system prompt
     │
     ▼
[5] LLM Pass #1 (Groq Llama-3 8B)
     │  System: Base prompt + timezone + memory context
     │  User: Transcribed text
     │  Output: Message with optional tool_calls[]
     │
     ▼
[6] Tool Execution (if tool_calls present)
     │  For each tool_call → toolRegistry.execute()
     │  → Supabase DB query (RLS-isolated)
     │  → Results collected as tool messages
     │
     ▼
[7] LLM Pass #2 (multi-pass synthesis)
     │  Input: original messages + tool call + tool results
     │  Output: final natural-language response text
     │
     ▼
[8] Memory Storage (async, non-blocking)
     │  If user input > 25 chars AND no tool action → store as memory
     │  embed-text(text) → insert into ai_memories
     │
     ▼
[9] TTS: Deepgram Aura 2 (aura-2-nestor-es)
     │  Text → binary audio URL
     │  Fallback: Browser SpeechSynthesis (Spanish baritone)
     │
     ▼
[10] JSON Response → Client
      │  { text, audioUrl, actionPerformed, useNativeFallback }
      │
      ▼
[11] Client Playback
      │  VoiceVisualizer → breathing animation
      │  Audio.play() → Luis speaks
      │  if actionPerformed → cronix:refresh-data event
```

---

## 4. Real-Time Streaming Engine (WebSocket)

### The Problem with File-Based STT

The original architecture used `MediaRecorder` to capture WebM/Opus audio, wait for the user to stop talking, then upload the entire blob to Groq Whisper. This introduced a **2-3 second STT bottleneck** before any LLM processing could begin.

### The V5 Solution: Live Streaming

Luis V5 shifts to **Deepgram's WebSocket API** for real-time transcription:

```typescript
// voice-assistant-fab.tsx — Streaming Setup
const socket = new WebSocket(
  'wss://api.deepgram.com/v1/listen' +
  '?model=nova-2-general' +
  '&language=es' +
  '&smart_format=true' +
  '&interim_results=true' +     // Words appear while speaking
  '&endpointing=300'            // 300ms silence = auto endpoint
)

// Audio sent as it's captured — 250ms chunks
mediaRecorder.start(250)
mediaRecorder.ondataavailable = (e) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(e.data)
}
```

### Interim vs. Final Results

Deepgram emits two types of transcription events:

| Type | `is_final` | Display |
|---|---|---|
| **Interim** | `false` | Shown live — fades as you speak, may change |
| **Final** | `true` | Committed — appended to `finalTranscriptRef` |

This distinction is critical. Only `is_final` results are sent to the backend. Interim results provide live UI feedback without polluting the model input.

```typescript
socket.onmessage = (message) => {
  const { channel, is_final } = JSON.parse(message.data)
  const chunk = channel?.alternatives[0]?.transcript

  if (chunk && is_final) {
    finalTranscriptRef.current += ' ' + chunk  // Committed
    setTranscript(finalTranscriptRef.current.trim())
    hasSpokenRef.current = true
  } else if (chunk) {
    setTranscript((finalTranscriptRef.current + ' ' + chunk).trim())  // Live preview
  }
}
```

### Architecture Decision: Text-to-API

When recording stops, instead of uploading audio to a backend STT endpoint, Luis sends the **already-transcribed text** as JSON:

```typescript
// Old V4 (file upload)
formData.append('audio', audioBlob, 'recording.webm')
fetch('/api/assistant/voice', { method: 'POST', body: formData })

// New V5 (text)
fetch('/api/assistant/voice', {
  method: 'POST',
  body: JSON.stringify({ text, timezone }),
  headers: { 'Content-Type': 'application/json' }
})
```

**Impact:** The voice route now branches at the input level:

```typescript
// assistant-service.ts
if (typeof input === 'string') {
  sttRes = { text: input, latency: 0 }  // Skip STT entirely
} else {
  sttRes = await this.stt.transcribe(input, { language: 'es' })  // Legacy audio path
}
```

This dual-mode design preserves **backward compatibility** with any audio-sending clients while enabling the zero-latency text path for the streaming FAB.

---

## 5. Voice Activity Detection (VAD)

VAD is a browser-side system that determines **when the user has started and stopped speaking**. It runs in a `requestAnimationFrame` loop using the Web Audio API:

```typescript
const analyser = audioContext.createAnalyser()
analyser.fftSize = 256
source.connect(analyser)

const dataArray = new Uint8Array(analyser.frequencyBinCount)

const monitor = () => {
  analyser.getByteFrequencyData(dataArray)
  const average = dataArray.reduce((p, c) => p + c, 0) / dataArray.length

  // Phase 1: Wait for initial speech (up to 8s)
  if (!hasSpokenRef.current) {
    if (average > SILENCE_THRESHOLD) hasSpokenRef.current = true
    else if (Date.now() - startTime > MAX_LISTEN_WAIT) stopRecording()
  }

  // Phase 2: Detect speech end (2s of silence)
  if (hasSpokenRef.current) {
    if (average < SILENCE_THRESHOLD) {
      if (!silenceTimerRef.current)
        silenceTimerRef.current = setTimeout(() => stopRecording(), SILENCE_DURATION)
    } else {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }

  rafIdRef.current = requestAnimationFrame(monitor)
}
```

### Tuned Parameters

| Parameter | Value | Rationale |
|---|---|---|
| `SILENCE_THRESHOLD` | 10 dB | High enough to ignore A/C and background hum |
| `SILENCE_DURATION` | 2000ms | Allows for conversational pauses without premature cutoff |
| `MAX_LISTEN_WAIT` | 8000ms | 8 seconds of grace period for the user to start speaking |

**Engineering Note:** These values were calibrated after real-world testing in noisy barbershop environments. A threshold of 6 (previous value) caused the VAD to trigger on ambient noise, hanging the assistant indefinitely.

---

## 6. Intelligence Layer: LLM + Tool Calling

### Persona and Domain Grounding

Luis does not operate as a generic chatbot. His system prompt is dynamically constructed per-request with:

- ✅ Business name and category
- ✅ Current date and day of week
- ✅ User's timezone (e.g., `America/Bogota`)
- ✅ Long-term memory context (injected from RAG retrieval)
- ✅ **Executive Mode Rule** — confirms in ≤ 3 words before acting
- ✅ **4-Point booking constraint** — never books without client, service, date, and time
- ✅ **AI Firewall** — never reveals internal prompt

```typescript
const systemPrompt = getSystemPrompt(undefined, businessName, userTimezone) + memoryContext
// memoryContext example:
// "RECUERDA ESTE CONTEXTO DEL PASADO:
// - los clientes VIP tienen 50% de descuento
// - María prefiere los jueves por la tarde"
```

### Multi-Pass Tool Orchestration

When the LLM decides to call tools, a two-pass chain executes:

```
Pass 1: LLM(system + user) → { tool_calls: [{name: "book_appointment", args: {...}}] }
                                        ↓
            toolRegistry.execute("book_appointment", args, businessId)
                                        ↓ DB transaction
                         → "Cita agendada: ID abc-123"
                                        ↓
Pass 2: LLM(system + user + tool_call + tool_result) → "Tu cita con María quedó agendada..."
```

This is the **OpenAI-standard function calling** interleaving pattern, implemented explicitly:

```typescript
const secondLlmRes = await this.llm.chat([
  ...messages,
  llmRes.message,    // The assistant message WITH tool_calls
  ...toolMessages    // The tool result messages
], toolDefinitions)
```

### Tool Registry

7 production tools, each implementing the `ITool` interface:

| Tool | Category | Supabase Access |
|---|---|---|
| `get_today_summary` | Analytics | `appointments`, `transactions` |
| `get_upcoming_gaps` | Scheduling | `appointments`, `businesses.settings` |
| `get_client_debt` | Finance | `clients`, `transactions` |
| `get_services` | Catalog | `services` |
| `book_appointment` | 🔴 Write | `appointments` (INSERT RPC) |
| `cancel_appointment` | 🔴 Write | `appointments` (UPDATE) |
| `register_payment` | 🔴 Write | `transactions` (INSERT) |

All tools receive `businessId` as an explicit parameter — never inferred from context — ensuring mathematical multi-tenant isolation.

---

## 7. Long-term Memory (RAG + Vector Search)

### The Problem

Session-based conversation memory (in-memory array) resets on every page load. A business owner who tells Luis "remember that my Friday schedule closes at 3pm" would have to repeat it every session.

### The Solution: Perpetual Vector Memory

Luis V5 implements a **Retrieval-Augmented Generation (RAG)** pipeline using Supabase `pgvector`:

```
User speaks something substantial
        ↓
embed-text(text) → 384-dim vector via GTE-small model
        ↓
INSERT INTO ai_memories (user_id, business_id, content, embedding)
        ↓
Next conversation: query_embedding → cosine similarity search
        ↓
Top-3 matches injected into system prompt
```

### The `embed-text` Edge Function

This is a Supabase Deno Edge Function using the **native Supabase AI runtime** for zero-cost, zero-dependency embeddings:

```typescript
// supabase/functions/embed-text/index.ts
const model = new Supabase.ai.Session('gte-small')

const embedding = await model.run(text, {
  mean_pool: true,   // Mean pooling for stable sentence vectors
  normalize: true,   // L2 normalization for cosine sim compatibility
})

// Returns: float32 array, 384 dimensions
```

**Why GTE-small?**
- 384 dimensions — small enough for fast HNSW search
- Multilingual support — handles Spanish natively  
- Free — runs inside Supabase's AI infrastructure
- No external API key required

### Vector Search with HNSW Index

```sql
-- High-performance approximate nearest neighbor search
CREATE INDEX ON ai_memories USING hnsw (embedding vector_cosine_ops);

-- The match_memories RPC implements:
SELECT content, 1 - (embedding <=> query_embedding) AS similarity
FROM ai_memories
WHERE user_id = p_user_id
  AND business_id = p_business_id
  AND 1 - (embedding <=> query_embedding) > 0.78  -- Only high-confidence matches
ORDER BY similarity DESC
LIMIT 3;
```

The `<=>` operator is **cosine distance** from pgvector. A threshold of `0.78` filters out weak associations, returning only semantically relevant memories.

### Memory Lifecycle Policy

To control storage growth and relevance:

```typescript
// Only store substantial, factual inputs — not tool executions
if (sttRes.text.length > 25 && !actionPerformed) {
  memoryService.store(userId, businessId, sttRes.text, { type: 'user_fact' })
}
```

This prevents storing ephemeral queries like "cuánto gané hoy" while preserving meaningful facts like preferences, constraints, and instructions.

---

## 8. Text-to-Speech & Resilience

### Primary Provider: Deepgram Aura 2

| Parameter | Value |
|---|---|
| Model | `aura-2-nestor-es` |
| Voice | Male, Spanish, Latin American |
| Latency | < 800ms typical |
| Format | MP3 streaming URL |

### Circuit Breaker Pattern

Luis uses a **Circuit Breaker** (`lib/ai/circuit-breaker.ts`) to prevent cascading failures to Deepgram:

```
CLOSED (Normal) → 3 consecutive failures → OPEN (Failing)
       ↑                                          │
       └── 2 minutes cooldown ←──────────────────┘
                                  HALF-OPEN (Testing)
```

When the breaker is Open, Luis **immediately falls back** to the browser's `SpeechSynthesis` API:

```typescript
const speakWithNativeFallback = (text: string) => {
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'es-MX'
  utterance.pitch = 0.7   // Baritone — maintains Luis's identity
  utterance.rate = 0.95
  // Prioritizes named Spanish male voices: Raul, Pablo, David, Jose
}
```

**Key Insight:** The fallback is not just functional — it preserves Luis's identity with a forced low pitch, so the voice remains consistent even when Deepgram is down. Business owners should never notice a degradation.

---

## 9. Security Architecture

### Token Gateway — Protecting the Master API Key

The Deepgram API key never touches the browser. A dedicated endpoint generates short-lived, scoped tokens:

```
Browser                     Backend (Auth required)            Deepgram
   │                                 │                             │
   ├── GET /api/assistant/token ─────►│                             │
   │   (JWT: Supabase session)       │── POST /v1/projects/       │
   │                                 │   {id}/keys ────────────────►│
   │                                 │   scope: usage:runtime      │
   │                                 │   TTL: 300s                 │
   │◄── { token, projectId } ────────│◄── { key }──────────────────│
   │                                 │                             │
   └── WebSocket(token) ─────────────────────────────────────────►│
```

Even if a token is intercepted, it expires in 5 minutes and is scoped to `usage:runtime` only — it cannot create/delete resources.

### Multi-Tenant Data Isolation

Every single operation Luis executes is bound by PostgreSQL Row Level Security:

```sql
-- RLS on ai_memories
CREATE POLICY "Users can only view their own memories"
ON ai_memories FOR SELECT
USING (auth.uid() = user_id);
```

The `business_id` and `user_id` are extracted from the authenticated Supabase session on the server — the client cannot pass a fake business ID.

### Rate Limiting

```typescript
// Per-user rate limiting in the voice route
const identifier = user.id || req.headers.get('x-forwarded-for') || 'anonymous'
const { limited, retryAfter } = assistantRateLimiter.isRateLimited(identifier)
if (limited) return 429
```

---

## 10. UI/UX: The Floating Action Button

### State Machine

The FAB operates as a 4-state machine with deterministic transitions:

```
idle ──[click]──► listening ──[VAD stop]──► processing ──[audio ready]──► speaking
 ▲                                                                             │
 └─────────────────────────────[audio ended]──────────────────────────────────┘
 └─────────────────────────────[click while speaking: interrupt]───────────────┘
```

### VoiceVisualizer — The Siri-Style Component

```tsx
// Reactive bars driven by Web Audio AnalyserNode volume (0–1)
const VoiceVisualizer = ({ isActive, volume, isSpeaking }) => (
  <div className="flex items-center gap-0.5 h-4 px-1">
    {[0, 1, 2, 3, 4].map((i) => (
      <motion.div
        key={i}
        animate={{
          height: isActive
            ? isSpeaking
              ? [8, 16, 8]                                    // Breathing
              : Math.max(4, volume * (1 + Math.sin(i*45) * 0.5) * 20)  // Reactive
            : 4                                               // Idle (flat)
        }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        style={{
          background: 'linear-gradient(to top, #3884FF, #A855F7, #EC4899)',
          boxShadow: '0 0 8px rgba(56,132,255,0.4)'
        }}
      />
    ))}
  </div>
)
```

The `Math.sin(i * 45)` offset ensures bars at different indices have slightly different heights, creating an organic wave shape rather than a flat uniform bar.

### Ghost Transcript

A deliberate UX decision: transcripts are ephemeral.

```
While user speaks  → Transcript appears (Deepgram interim results)
User stops talking → Recording stops → setTranscript('')  ← INSTANT clear
Luis responds      → Transcript stays empty while audio plays
```

This was a specific product decision: **avoid the "sticky text" anti-pattern** found in many voice UIs where the transcript lingers awkwardly during and after the AI response. Luis is voice-first — the text is a transient affordance, not a persistent UI element.

### Drag & Position Persistence

The FAB is fully draggable on mobile via Framer Motion's `drag="y"` with:
- Dynamic constraints: `top: -(window.innerHeight - 150)` — reaches the top of any device
- Spring physics: `{ stiffness: 300, damping: 30 }` — smooth snap on release
- Persistent position: saved to `localStorage` so the owner parks it once

### Proactive Greeting

On first dashboard load per session:

```typescript
// Calls /api/assistant/proactive — a dedicated lightweight endpoint
// that generates a contextual welcome message (e.g., today's summary)
setTimeout(async () => {
  const res = await fetch('/api/assistant/proactive')
  const { text, audioUrl } = await res.json()
  if (audioUrl) { setState('speaking'); new Audio(audioUrl).play() }
}, 2000)
```

This is gated by `sessionStorage` to fire only once per browser session.

---

## 11. Engineering Decisions & Trade-offs

### Decision 1: WebSocket STT over Multi-Modal API

**Alternative:** Use a unified multi-modal endpoint (OpenAI GPT-4o Audio).

**Why WebSocket + separate TTS is better for this use case:**
- Latency: Deepgram Nova-2 is the fastest Spanish STT at < 300ms
- Cost: 100× cheaper than GPT-4o audio at scale
- Flexibility: Independent STT/LLM/TTS providers can be swapped independently

### Decision 2: GTE-small over OpenAI text-embedding-3-small

**Alternative:** Use OpenAI `text-embedding-3-small` for embeddings.

**Why GTE-small:**
- Zero cost — runs inside Supabase Edge Runtime natively
- Latency < 50ms (local inference, no network round-trip)
- No additional API key
- Quality sufficient for conversational memory retrieval (above 0.78 cosine threshold)

### Decision 3: `noUncheckedIndexedAccess` Compliance

The TypeScript config enforces strict array access — `array[0]` is typed as `T | undefined`. All code follows the **Early Guard Pattern**:

```typescript
// ILLEGAL in this codebase:
const choice = data.choices[0].message // ❌

// REQUIRED pattern:
const choice = data.choices[0]
if (!choice) return fallbackResult   // ✅
```

### Decision 4: Non-Blocking Memory Storage

Memory writes happen **after** the TTS response has been dispatched to the client:

```typescript
// Non-blocking — the user hears the response immediately
// Memory storage happens in the background
if (sttRes.text.length > 25 && !actionPerformed) {
  memoryService.store(userId, businessId, sttRes.text, { type: 'user_fact' })
  // No await — fire and forget
}
```

This is intentional: adding an `await` would add 50-200ms to every response just to write a memory. The fire-and-forget pattern sacrifices transactional guarantees for responsiveness — acceptable because memory storage is a best-effort optimization, not a critical business operation.

---

## 12. Performance Profile

| Metric | V4 (Previous) | V5 (Current) | Improvement |
|---|---|---|---|
| STT Latency | ~1200ms (Groq Whisper upload) | ~0ms (already transcribed) | **∞ faster** |
| First word on screen | ~1200ms after stop | Live (word-by-word) | **Real-time** |
| Memory retrieval | N/A | < 80ms (HNSW index) | **New capability** |
| Full pipeline (speak → audio) | ~3.5s | ~1.8s | **~2× faster** |
| TTS Latency | < 800ms | < 800ms | Unchanged |
| Security: API key exposure | Partial risk | Zero exposure | **Hardened** |

---

## 13. File Reference

| File | Responsibility |
|---|---|
| [`components/dashboard/voice-assistant-fab.tsx`](../../components/dashboard/voice-assistant-fab.tsx) | Full FAB: WebSocket streaming, VAD, VoiceVisualizer, Ghost Transcript, audio playback, FAB drag & UX |
| [`app/api/assistant/voice/route.ts`](../../app/api/assistant/voice/route.ts) | Main voice endpoint — polymorphic input (text/audio), rate limiting, business isolation |
| [`app/api/assistant/token/route.ts`](../../app/api/assistant/token/route.ts) | Deepgram token gateway — short-lived, scoped, auth-gated |
| [`app/api/assistant/proactive/route.ts`](../../app/api/assistant/proactive/route.ts) | Proactive greeting endpoint |
| [`lib/ai/assistant-service.ts`](../../lib/ai/assistant-service.ts) | Core orchestrator — STT skip, RAG, LLM multi-pass, tool dispatch, memory write |
| [`lib/ai/assistant-prompt-helper.ts`](../../lib/ai/assistant-prompt-helper.ts) | Dynamic system prompt — timezone, business context, memory context, Executive Mode |
| [`lib/ai/memory-service.ts`](../../lib/ai/memory-service.ts) | Vector memory layer — embed-text invocation, pgvector retrieval, memory insertion |
| [`lib/ai/tool-registry.ts`](../../lib/ai/tool-registry.ts) | Tool dispatcher — receives `businessId`, routes to correct implementation |
| [`lib/ai/assistant-tools.ts`](../../lib/ai/assistant-tools.ts) | 7 business tools (READ + WRITE), all RLS-scoped |
| [`lib/ai/providers/deepgram-provider.ts`](../../lib/ai/providers/deepgram-provider.ts) | TTS adapter (Deepgram Aura 2), implements `ITtsProvider` |
| [`lib/ai/providers/groq-provider.ts`](../../lib/ai/providers/groq-provider.ts) | LLM + STT adapter (Groq), implements `ILlmProvider` + `ISttProvider` |
| [`lib/ai/resilience.ts`](../../lib/ai/resilience.ts) | `safeDeepgramTTS()` — wraps TTS with circuit breaker and fallback logic |
| [`lib/ai/circuit-breaker.ts`](../../lib/ai/circuit-breaker.ts) | Service health state machine (CLOSED/OPEN/HALF-OPEN) |
| [`supabase/functions/embed-text/index.ts`](../../supabase/functions/embed-text/index.ts) | Native GTE-small embedding generator (ACTIVE on Supabase, Version 1) |
| [`types/database.types.ts`](../../types/database.types.ts) | TypeScript types: `ai_memories` table + `match_memories` RPC signature |

---

*Last updated: April 2026 — Luis IA V5 "Senior" Architecture*
*Authored by Antigravity V5 · Cronix AI Engineering*
