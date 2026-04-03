# 🎙️ Luis IA — Integration Guide

Comprehensive guide to integrate and configure the **Executive Voice Assistant "Luis"** in a new Cronix environment.

---

## Requirements

| Service | Purpose | URL |
|---|---|---|
| **Groq** | LLM (Llama) + STT (Whisper) | https://console.groq.com |
| **Deepgram** | TTS (Text-to-Speech) | https://console.deepgram.com |
| **Supabase** | Database + Auth + RLS | https://supabase.com |

---

## 1. Environment Variables

Add the following variables to your `.env.local`:

```bash
# LLM and STT — Groq (a single key for both)
LLM_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx

# TTS — Deepgram Aura 2
DEEPGRAM_AURA_API_KEY=your-deepgram-key
```

> **Note:** The variables `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID` have been **deprecated** and are no longer required. Deepgram Aura 2 is the only supported TTS provider.

---

## 2. Voice Model (TTS)

| Parameter | Value |
|---|---|
| Provider | Deepgram Aura 2 |
| Model | `aura-2-nestor-es` |
| Language | Spanish (Latin American / Spain compatible) |
| Latency | < 800ms typical |
| Fallback | Browser `SpeechSynthesis` API (free) |

### 🛡️ Resilience and Fallback (Native Voice)
Luis is shielded against infrastructure failures. If **Deepgram** fails (due to insufficient balance, network error, API limit, or Circuit Breaker skip), the system acts as follows:
1. **Detection**: The backend (`resilience.ts`) detects the error and returns `useNativeFallback: true`.
2. **Activation**: The frontend (`voice-assistant-fab.tsx`) automatically activates the browser's voice API (`speechSynthesis`).
3. **Consistency**: A Spanish male voice (e.g., "Raul", "Pablo", or "Jose") is forced with a pitch adjusted to maintain Luis's identity.
**Result**: The system NEVER stops talking, ensuring the business owner always receives a response.

To change the voice model, edit:
```
app/api/assistant/voice/route.ts     → line with 'aura-2-nestor-es'
app/api/assistant/proactive/route.ts → line with 'aura-2-nestor-es'
```

---

## 3. Reasoning Model (LLM)

| Parameter | Value |
|---|---|
| Provider | Groq |
| Model | `llama-3.3-8b` (speed) |
| Calls | Function Calling (Tool Dispatching) |

To change the model, edit `lib/ai/providers/groq-provider.ts`.

---

## 4. Voice Transcription (STT)

| Parameter | Value |
|---|---|
| Provider | Groq Whisper |
| Model | `whisper-large-v3` |
| Language | `es` (Forced Spanish) |
| Latency | < 1 second for 5s commands |

---

## 5. Full Pipeline

```
[User's Browser]
  MediaRecorder API → WebM/Opus
  Intl.DateTimeFormat → timezone (e.g. "America/Bogota")
        ↓ FormData
[POST /api/assistant/voice]
  Rate Limiting → Max req/min per user
  Business Isolation → business_id via Supabase Auth + RLS
  STT → Groq Whisper (audio → text)
  LLM → Groq Llama 3 (text + tools → action)
  TTS → Deepgram Aura 2 (response → audio)
        ↓ JSON
[Client]
  Plays audio + updates calendar (cronix:refresh-data event)
```

---

## 6. Available Tools

Registered in `lib/ai/tool-registry.ts`:

| Tool | Type | Description |
|---|---|---|
| `get_today_summary` | READ | Current day's income and appointments |
| `get_upcoming_gaps` | READ | Free slots in the agenda |
| `get_client_debt` | READ | Pending debt of a specific client |
| `get_services` | READ | Business service catalog |
| `cancel_appointment` | WRITE | Cancels a client's next appointment |
| `book_appointment` | WRITE | Schedules a new appointment (requires 4 points) |
| `register_payment` | WRITE | Records a transaction |

To add a new tool:
1. Implement in `lib/ai/assistant-tools.ts`
2. Register in `lib/ai/tool-registry.ts`
3. Document in this guide and in `DASHBOARD_ASSISTANT_TECHNICAL_OVERVIEW.md`

---

## 7. 4-Point Validation (Bookings)

Luis **cannot** execute `book_appointment` if any of these data points are missing:

1. ✅ **Client** — name resolved via Fuzzy Matching (Levenshtein)
2. ✅ **Service** — verified with `get_services` (does not invent services)
3. ✅ **Date** — explicit or relative ("tomorrow", "Monday")
4. ✅ **Time** — explicit and mandatory

---

## 8. Timezone (Multi-country)

The user's timezone is automatically detected on the client:

```typescript
// voice-assistant-fab.tsx
formData.append('timezone', Intl.DateTimeFormat().resolvedOptions().timeZone)
// Result: "America/Bogota", "Europe/Madrid", "America/Mexico_City", etc.
```

This timezone reaches the prompt system:
```
route.ts → assistantService.processVoiceRequest(..., timezone)
         → getSystemPrompt(undefined, businessName, userTimezone)
         → "The user operates in the ${userTimezone} timezone"
```

---

## 9. Real-Time Synchronization (Master Touch)

When Luis executes a successful write action, the server dispatches:

```typescript
// Emitted on the client after successful response with actionPerformed=true
window.dispatchEvent(new CustomEvent('cronix:refresh-data'))
```

The Dashboard listens for this event and refreshes the calendar automatically without a page reload.

---

## 10. Multi-Tenant Security

- Each tool call includes a `businessId` obtained from the authenticated session.
- PostgreSQL RLS with `get_my_business_id()` isolates data at the database level.
- The health check at `/api/health` verifies the presence of `DEEPGRAM_AURA_API_KEY`.
- Per-user rate limiting on `/api/assistant/voice`.

---

## Key Files

| File | Role |
|---|---|
| `app/api/assistant/voice/route.ts` | Main voice endpoint (STT + LLM + TTS) |
| `app/api/assistant/proactive/route.ts` | Proactive greeting upon dashboard load |
| `lib/ai/assistant-service.ts` | Full pipeline orchestrator |
| `lib/ai/assistant-prompt-helper.ts` | Prompt system with dynamic timezone |
| `lib/ai/assistant-tools.ts` | Tool implementation |
| `lib/ai/tool-registry.ts` | Tool registration and execution |
| `lib/ai/providers/deepgram-provider.ts` | TTS adapter (Deepgram Aura 2) |
| `lib/ai/providers/groq-provider.ts` | LLM + STT adapter (Groq) |
| `components/dashboard/voice-assistant-fab.tsx` | Assistant UI (capture and playback) |

---

*Documentation generated by Antigravity V3 — Cronix AI Team. Version: Luis IA v6.5*
