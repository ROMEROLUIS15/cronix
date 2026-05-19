# WhatsApp Agent — Arquitectura end-to-end

> Fusión de `WHATSAPP_AI_ARCHITECTURE.md` + `WhatsApp-AI-Architecture-Details.md`.
> Verificado contra `supabase/functions/process-whatsapp/`, `supabase/functions/whatsapp-webhook/`, `supabase/functions/whatsapp-service/` y `lib/ai/core/booking/BookingEngine.ts`.

## 1. Visión

Un solo número de WhatsApp Cloud (el de Cronix) atiende a todos los negocios. El enrutamiento al tenant correcto se hace por `#slug` en el primer mensaje o por sesión Redis en mensajes posteriores. Esto elimina la verificación empresarial Meta por negocio y el costo de hospedaje de un BSP por tenant.

## 2. Pipeline (verificado en `process-whatsapp/message-handler.ts`)

```
Meta Cloud API
   │ webhook POST
   ▼
whatsapp-webhook (HMAC x-hub-signature-256)
   │ QStash enqueue (Retry-After ladder)
   ▼
process-whatsapp (Deno Edge)
   │
   ├─ Layer 1: QStash signature verify
   ├─ Audio? → Deepgram Nova-2 STT (idioma=es, smart_format)
   ├─ Layer 2: rate-limit phone (10 msgs / 60s)
   ├─ Slug regex `#([a-z0-9-]{2,31})`
   ├─ sanitize anti prompt-injection
   ├─ Routing 3-tier: slug → sesión Redis → fallback landing
   ├─ Layer 3: business usage quota (50 msgs / 60s)
   ├─ Layer 4: token quota diaria (default 300000 tokens)
   ├─ getBusinessServices / getClientByPhone / getActiveAppointments /
   │   getConversationHistory(6) / getBookedSlots — en paralelo
   ├─ memoryEngine.recall(topK=5, threshold=0.78)        (ai_memories_v2)
   ├─ router.classify(text)                              (semantic router pgvector)
   ├─ tracer.start (ai_traces)
   ├─ ReAct loop con SMALL_MODEL (llama-3.1-8b-instant), MAX_STEPS=3:
   │     ├─ confirmation-gate.toolsAllowedThisTurn (2-turn gate)
   │     ├─ deduplication guard por fingerprint(tool+args)
   │     ├─ embedded <function> recovery → promote a tool_call
   │     ├─ executeToolCall vía BookingEngine.dispatch (Zod + UseCases)
   │     │     └─ onBeforeDispatch hook = constitutional reviewer
   │     ├─ output sanitizer (strip UUIDs, internal syntax, "_booking" leaks)
   │     └─ trace.recordToolCall(status, errorCode, hashedArgs)
   ├─ Success → renderBookingSuccessTemplate (SKIP large model)
   ├─ Fail conocido → respuesta determinista por errorCode
   ├─ memoryEngine.write (fire-and-forget, episodic ttl=180d)
   ├─ sendWhatsAppMessage (con retry exponencial)
   ├─ logInteraction (auditoría) + trace.finish
   └─ 503 + Retry-After si LlmRateLimitError o CircuitBreakerError
                                       ↑
                                       │
                                  QStash reintenta
```

## 3. Verificación de propiedad del WhatsApp del dueño

El dueño envía `VINCULAR-{slug}` desde su número personal al número Cronix. `verifyBusinessPhone(slug, sender)` graba el teléfono en `businesses.owner_phone` (o equivalente) tras verificar que el slug existe y no estaba ya vinculado. Detalle en `docs/architecture/adr/0004-whatsapp-business-verification.md`.

## 4. Defensas anti-abuso (6 capas)

| # | Mecanismo | Archivo | Estado |
|---|---|---|---|
| 1 | HMAC Meta + QStash signature | `whatsapp-webhook/index.ts`, `process-whatsapp/security.ts:verifyQStash` | activo |
| 2 | Rate-limit por teléfono (sliding window Postgres) | `process-whatsapp/guards.ts:checkMessageRateLimit` (RPC `fn_wa_check_rate_limit`) | 10/60s |
| 3 | Rate-limit agregado por negocio | `guards.ts:checkBusinessUsageLimit` | 50/60s |
| 4 | Token quota diaria | `guards.ts:checkTokenQuota` + `trackTokenUsage` | configurable por `wa_daily_token_limit` |
| 5 | Sanitización anti prompt-injection | `security.ts:sanitizeMessage` | activo |
| 6 | Booking rate-limit | dentro de `confirm_booking` (RPC) | 2/24h por sender |

## 5. Confirmation gate (anti-doble-booking conversacional)

`confirmation-gate.ts:toolsAllowedThisTurn(history, userText)` solo retorna `true` cuando:
1. La última respuesta del asistente termina en pregunta de confirmación (`¿Confirmo...?`).
2. El último mensaje del usuario es afirmativo según el router semántico (intent `affirmation`).

Cuando la puerta está cerrada, **el array de tools se pasa vacío al LLM** → desaparece la superficie de alucinación.

## 6. Recuperación de tool-calls fugadas

El 8B a veces emite `<function=confirm_booking>{...}</function>` como texto plano. `ai-agent.ts` detecta el patrón, valida que `fnName ∈ {confirm_booking, reschedule_booking, cancel_booking}` y que `argsRaw` sea JSON parseable, y lo promueve a `tool_calls[]` real — pero solo si la confirmation-gate estaba abierta.

## 7. Final-pass determinista (corta el segundo LLM call)

Cuando la última tool del loop tuvo éxito, se salta el LARGE_MODEL y se renderiza con `renderBookingSuccessTemplate` directamente. Esto cierra el loop `400 → circuit-breaker → 503` que ocurría cuando el 8B fallaba el segundo round.

Cuando la tool falló con error conocido (`SLOT_CONFLICT`, `BOOKING_RATE_LIMIT`, `INVALID_ARGS`, `UNAUTHORIZED`, `NOT_FOUND`), se devuelve un mensaje determinista — nunca un segundo LLM call.

## 8. Tabla de tools (BookingEngine `dispatch`)

| Tool name | Schema Zod | Reviewed | Bypass-allowed |
|---|---|---|---|
| `confirm_booking` | `ConfirmBookingSchema` | ✔ | ✗ (requiere gate abierto) |
| `cancel_booking` | `CancelBookingSchema` | ✔ | ✗ |
| `reschedule_booking` | `RescheduleBookingSchema` | ✔ | ✗ |
| `get_appointments_by_date` | `GetByDateSchema` | – | – |
| `get_available_slots` | `GetAvailableSlotsSchema` | – | – |
| `create_client` | `CreateClientSchema` | – | – |
| `search_clients` | `SearchClientsSchema` | – | – |

## 9. Costos y latencias observables

Las trazas `ai_traces` guardan `latencyMs`, `totalTokens`, `stepsCount`, `toolsCount`, `outcome`. El exporter diario `export-ai-traces` agrupa en buckets (`fast/normal/slow/critical`, `low/medium/high/extreme`) para entrenar modelos sin exponer PII.
