# 🤖 Dashboard Executive Assistant ("Luis") — Technical Overview v6.5

Beyond the WhatsApp customer-facing bot, Cronix includes a specialized **Executive Voice Assistant** (codenamed **"Luis"**) designed strictly for business owners to manage operations hands-free directly from the PWA dashboard.

---

## 🏗️ AI Interaction Model: Tool Dispatching

Unlike the WhatsApp agent which uses "Action Tags" in natural language, "Luis" uses **OpenAI-compatible Function Calling (Tools)** via the Groq API. This allows for a more deterministic and structured interaction with the database.

### Core Capabilities (Tools)
The assistant is equipped with the following toolset (see `lib/ai/assistant-tools.ts`):

| Tool Name | Type | Description |
|---|---|---|
| `get_today_summary` | **READ** | Calculates total income and appointment status for the current day. |
| `get_upcoming_gaps` | **READ** | Identifies free time slots in the business agenda. |
| `get_client_debt` | **READ** | Checks for unpaid services linked to a specific client. |
| `get_services` | **READ** | Lists all active services with name, price, and duration for the business. |
| `cancel_appointment`| **WRITE**| Cancels the next upcoming appointment for a client. |
| `book_appointment`  | **WRITE**| Schedules a new service. Requires 4-point validation: Client, Service, Date & Time. |
| `register_payment`  | **WRITE**| Records a transaction (Cash, Card, Transfer, QR). |

---

## 🔍 Fuzzy Matching Engine (Levenshtein)

A critical challenge for voice assistants is resolving spoken names (which often contain transcription errors) to unique database UUIDs. "Luis" uses a custom **Levenshtein Distance** algorithm (see `lib/ai/fuzzy-match.ts`) with zero external dependencies.

### The Resolution Pipeline:
1.  **Normalization:** Strips accents, collapses whitespace, and converts to lowercase.
2.  **Similarity Scoring:** Calculates the edit distance between the transcript and the entity names (clients/services).
3.  **Thresholding:** Filters matches with a similarity score below **0.45**.
4.  **Disambiguation:**
    *   **Single Winner:** Gap of >0.15 between the top matches → Auto-resolve.
    *   **Ambiguous:** Multiple close matches → Assistant asks: *"I found several people named 'Maria'. Do you mean Maria Garcia or Maria Lopez?"*

---

## 🎤 Voice Pipeline (STT & TTS) — v6.5

"Luis" implements a full-duplex voice interface optimized for mobile browsers:

### 1. Speech-to-Text (STT)
- **Capture:** `MediaRecorder` API (WebM/Opus) on the client.
- **Inference:** **Groq Whisper** (`whisper-large-v3`) processed via a Next.js API route.
- **Latency:** <1s for typical 5-second commands.

### 2. Decision Engine
- **Model:** `llama-3.3-8b` (optimized for speed over reasoning depth).
- **Execution:** Server-side tools execute queries/mutations using the authenticated user's `business_id`.

### 3. Text-to-Speech (TTS)
- **Primary Path:** **Deepgram Aura 2** (`aura-2-nestor-es`) — ultra-low latency, natural Spanish male voice with consistent brand identity.
- **Fallback Path:** Browser `SpeechSynthesis` API for zero-cost execution in case of API unavailability.

> **Note:** ElevenLabs has been fully replaced by Deepgram Aura 2 as of v6.5. Deepgram provides lower latency and a more natural Spanish voice for Latin American markets.

---

## 🌍 Multi-Country Timezone Support (v6.5)

Luis is globally timezone-aware. The user's local timezone is detected automatically on the client via:

```javascript
Intl.DateTimeFormat().resolvedOptions().timeZone // e.g., "America/Bogota", "Europe/Madrid"
```

This value is passed through the request pipeline (`FormData → route.ts → AssistantService → getSystemPrompt`) and injected into Luis's system prompt, ensuring that when a user in Mexico City says "10 AM", the appointment is recorded as 10 AM in `America/Mexico_City`, not UTC.

---

## 🛡️ Security & Multi-Tenancy

Every tool execution in `assistant-tools.ts` is explicitly scoped to the `business_id` derived from the user's active session. The system uses a PostgreSQL function `get_my_business_id()` enforced via **Row Level Security (RLS)**, making it mathematically impossible for Luis to access data from another business — even if the AI hallucinates a UUID.

**4-Point Booking Validation:** Luis is prohibited from calling `book_appointment` without all four confirmed:
1. Client name
2. Service name (verified via `get_services`)
3. Exact date
4. Exact time

---
*Documentation updated by Antigravity V3 - Cronix AI Team — v6.5 Geolocation & Deepgram Aura 2 Release.*
