# WhatsApp Agent — Arquitectura end-to-end

> Verificado contra `supabase/functions/process-whatsapp/`, `supabase/functions/whatsapp-webhook/`, `supabase/functions/whatsapp-service/` y `supabase/functions/_shared/booking-adapter.ts`.
> Última revisión: 2026-06-04.

## 1. Visión

Un solo número de WhatsApp Cloud (el de Cronix) atiende a todos los negocios. El enrutamiento al tenant correcto se hace por `#slug` en el primer mensaje o por sesión Redis en mensajes posteriores. Esto elimina la verificación empresarial Meta por negocio y el costo de hospedaje de un BSP por tenant.

## 2. Pipeline completo (`message-handler.ts` + `message-pipeline.ts`)

```
Meta Cloud API
   │ webhook POST
   ▼
whatsapp-webhook/index.ts
   │ HMAC x-hub-signature-256 → enqueue a QStash
   ▼
process-whatsapp/index.ts → handleMessage()
   │
   ├─ [Guard 0] QStash signature verify              security.ts:verifyQStash
   │
   ├─ Audio? → downloadMediaBuffer() → transcribeAudio()
   │     ├─ Deepgram Nova-2 STT (es, smart_format)
   │     ├─ 429 → LlmRateLimitError → retryLater(60s) → QStash reintenta
   │     └─ CircuitBreakerError → retryLater(30s)
   │
   ├─ VINCULAR-{slug} intercept → verifyBusinessPhone()
   │
   ├─ [Guard 1] checkMessageRateLimit(sender)         10 msgs / 60s
   ├─ Slug regex #([a-z0-9][a-z0-9-]{1,30})
   ├─ sanitizeMessage()                               anti prompt-injection
   ├─ slug-only message → welcome + upsertSession()
   │
   ├─ 3-tier tenant routing:
   │     1. slug → getBusinessBySlug() + upsertSession()
   │     2. getSessionBusiness(sender)
   │     3. fallback → landing message + return
   │
   ├─ [Guard 2] checkBusinessUsageLimit(business)    50 msgs / 60s
   ├─ [Guard 3] checkTokenQuota(business)            300k tokens/día (configurable)
   │
   └─ buildWhatsAppPipeline().run({ sender, customerName, text, business })
         │
         ├─ Step 1 — stepFetchContext()
         │     ├─ getBusinessServices(business.id)              ┐
         │     ├─ getClientByPhone(business.id, sender)         ┘ paralelo
         │     ├─ getActiveAppointments(business.id, client.id) ┐
         │     ├─ getConversationHistory(business.id, sender, 6)│ paralelo
         │     └─ getBookedSlots(business.id, timezone)         ┘
         │
         ├─ Step 2 — stepRunAgent() → runAgentLoop()
         │     ├─ memoryEngine.recall(topK=5, threshold=0.78)   ┐ paralelo
         │     ├─ router.classify(text)                         ┘
         │     ├─ buildWriteGuard()  (lazy constitutional closure)
         │     ├─ tracer.start()
         │     ├─ buildMinimalSystemPrompt(context, customerName, recalled, intent)
         │     │
         │     └─ ReAct Loop — SMALL_MODEL (llama-3.1-8b-instant), MAX_STEPS=3
         │           ├─ toolsAllowedThisTurn(history, userText)   ← confirmation-gate
         │           │     TRUE  → activeTools = BOOKING_TOOLS
         │           │     FALSE → activeTools = []  (sin esquemas → sin alucinación)
         │           │
         │           ├─ callLlm(SMALL_MODEL, messages, activeTools)
         │           │     ├─ checkCircuitBreaker('GROQ_LLM')
         │           │     ├─ Key pooling: itera LLM_API_KEY CSV; 429 → siguiente key
         │           │     └─ Sin keys disponibles → LlmRateLimitError → 503 → QStash
         │           │
         │           ├─ NO tool_calls → loopText = content; break
         │           │
         │           ├─ tool_calls presentes:
         │           │   ├─ recoverEmbeddedToolCall()            ← <function> leak recovery
         │           │   │     recovered → promover a tool_calls[] (solo si gate abierta)
         │           │   │     invalid   → loopText = FALLBACK; break
         │           │   │
         │           │   ├─ trackDedupCall(fingerprint)          ← dedup mismo tool+args
         │           │   │     duplicado → inyectar DUPLICATE_CALL error; continue
         │           │   │
         │           │   └─ executeToolCall(toolCall, context, sender, customerName, writeGuard)
         │           │         ├─ confirm_booking → checkBookingRateLimit(sender)  5/24h
         │           │         ├─ writeGuard(toolName, args)   ← constitutional reviewer
         │           │         │     block → return UNAUTHORIZED error
         │           │         ├─ WhatsAppBookingAdapter.execute() → RPC Postgres
         │           │         └─ emitCreatedEvent / emitRescheduledEvent / emitCancelledEvent
         │           │               + sendClientBookingConfirmation (fire-and-forget)
         │           │
         │           └─ messages.push(tool result) → siguiente step del loop
         │
         │     Final pass — selectFinalResponse() [NO hay segundo LLM call]:
         │     ├─ Tool success  → renderBookingSuccessTemplate()
         │     ├─ Tool failure  → mensaje determinista por errorCode (ver §7)
         │     ├─ loopText vacío → clarification fallback genérico
         │     └─ loopText presente → respuesta directa del 8B
         │
         │     Post-loop:
         │     ├─ sanitizeOutput()  (strip UUIDs, <function>, internal syntax)
         │     ├─ containsInternalSyntax? → buildDeterministicIntentResponse() o FALLBACK
         │     ├─ memoryEngine.write()  (fire-and-forget, episodic, ttl=180d)
         │     └─ trace.finish(outcome)
         │
         ├─ Step 3 — stepSendResponse() → sendWhatsAppMessage(sender, text)
         └─ Step 4 — stepLogInteraction() → logInteraction() + audit trail
```

## 3. Verificación de propiedad del WhatsApp del dueño

El dueño envía `VINCULAR-{slug}` desde su número personal al número Cronix. `verifyBusinessPhone(slug, sender)` graba el teléfono en `businesses.owner_phone` tras verificar que el slug existe y no estaba ya vinculado. Detalle en `docs/architecture/adr/0004-whatsapp-business-verification.md`.

## 4. Defensas anti-abuso (6 capas)

| # | Mecanismo | Archivo | Límite |
|---|---|---|---|
| 1 | HMAC Meta + QStash signature | `whatsapp-webhook/index.ts`, `security.ts:verifyQStash` | activo |
| 2 | Rate-limit por teléfono (sliding window Postgres) | `guards.ts:checkMessageRateLimit` → RPC `fn_wa_check_rate_limit` | 10 / 60s |
| 3 | Rate-limit agregado por negocio | `guards.ts:checkBusinessUsageLimit` → RPC `fn_wa_check_business_limit` | 50 / 60s |
| 4 | Token quota diaria | `guards.ts:checkTokenQuota` + `trackTokenUsage` | configurable vía `wa_daily_token_limit` (default 300k) |
| 5 | Sanitización anti prompt-injection | `security.ts:sanitizeMessage` | activo |
| 6 | Booking rate-limit | `guards.ts:checkBookingRateLimit` → RPC `fn_wa_check_booking_limit` | **5 bookings / 24h** por sender |

> Todas las guards fallan **open** en error de DB para no bloquear usuarios legítimos.

## 5. Confirmation gate (anti-doble-booking conversacional)

`confirmation-gate.ts:toolsAllowedThisTurn(history, userText)` retorna `true` solo cuando se cumplen **ambas** condiciones:

1. La última respuesta del asistente en `history` coincide con `CONFIRMATION_QUESTION_RE`:
   ```
   /¿\s*(Confirmo|Reagendo|Procedo|Te\s+(?:confirmo|agendo|reagendo)|Confirma[rs]?\s+(?:que\s+...))/i
   ```
2. El texto del usuario actual pasa `AFFIRMATIVE_RE` (≤60 chars, no negado por `NEGATIVE_RE`):
   ```
   sí / dale / ok / vale / confirmo / listo / correcto / exacto / ajá / de acuerdo / agenda / reagenda / cancela…
   ```

Cuando la puerta está **cerrada**: `activeTools = []` — el LLM nunca recibe los esquemas de tools, eliminando toda superficie de alucinación de argumentos.

Cuando la puerta está **abierta**: `activeTools = BOOKING_TOOLS`, `tool_choice = 'auto'`.

## 6. Recuperación de tool-calls fugadas (`tool-recovery.ts`)

El 8B a veces emite el tool call como texto plano en lugar de JSON estructurado:

```
<function=confirm_booking>{"service_id":"...","date":"...","time":"..."}</function>
```

`recoverEmbeddedToolCall(content)` parsea dos variantes de sintaxis. Retorna:

| Status | Condición | Acción del caller |
|---|---|---|
| `null` | No hay `<function>` | Continúa normalmente |
| `recovered` | fnName ∈ whitelist + JSON válido | Promueve a `tool_calls[]` real (solo si gate abierta) |
| `invalid` | fnName desconocido o JSON malformado | `loopText = FALLBACK; break` |

La promoción solo ocurre si la confirmation-gate estaba abierta — evita ejecutar exactamente las alucinaciones que la gate bloquea.

## 7. Final-pass determinista (`final-response.ts`)

`selectFinalResponse()` implementa un árbol de decisión de 4 ramas. **No hay segunda llamada LLM** en ninguna rama:

| Condición | Respuesta |
|---|---|
| `actionPerformed && lastToolParsed.success === true` | `renderBookingSuccessTemplate()` → plantilla determinista según tool |
| `actionPerformed && success === false` + `SLOT_CONFLICT` | "⚠️ Ese horario ya está ocupado. ¿Te gustaría intentar con otra fecha u hora disponible?" |
| ídem + `BOOKING_RATE_LIMIT` | "⚠️ Has alcanzado el límite de citas nuevas por hoy…" |
| ídem + `INVALID_ARGS` | "⚠️ Hubo un problema con los datos de la cita…" |
| ídem + `UNAUTHORIZED` / `NOT_FOUND` | "⚠️ No encontré esa cita en tu historial…" |
| ídem + cualquier otro error | "⚠️ No pude procesar tu solicitud en este momento…" |
| `!actionPerformed && !loopText` | "¿Podrías indicarme con más detalle qué te gustaría hacer?" |
| `!actionPerformed && loopText` | `loopText` (respuesta directa del 8B sin modificar) |

Post-selector, `sanitizeOutput()` elimina UUIDs sueltos, `<function>` leaked, y variantes de nombres de tools. Si `containsInternalSyntax()` retorna true, se cae al `buildDeterministicIntentResponse()` (DB-driven, intenta deducir cancel/reschedule intent del utterance + citas activas) o al `INTERNAL_SYNTAX_FALLBACK`.

### Datos que alimentan la plantilla de éxito (contrato productor → consumidor)

`renderBookingSuccessTemplate()` lee `service_name` + `date`/`time` (o `new_date`/`new_time` en reschedule). Esos campos **no** los produce el LLM: vienen del `WhatsAppBookingAdapter`, que retorna `serviceName`/`date`/`time` (normalizados) en su resultado de éxito. `tool-executor.ts` los mapea a snake_case vía `success-data.ts:buildSuccessTemplateData()` antes de serializar el resultado del tool.

> Si este mapeo falta, la plantilla renderiza en blanco (`Tu cita para ** quedó agendada`). El test `__tests__/success-data.test.ts` fija el contrato end-to-end (adapter → mapeo → `selectFinalResponse`) para que no vuelva a romperse — `final-response.test.ts` por sí solo no lo cubría porque fabricaba el input ideal.

## 8. Circuit breaker + Key pooling (`groq-client.ts`)

### Circuit breaker (Postgres)

| Parámetro | Valor |
|---|---|
| RPC | `fn_wa_check_circuit_breaker` |
| Umbral de apertura | 3 fallos consecutivos (`p_threshold: 3`) |
| Reset | 2 minutos (`p_reset_mins: 2`) |
| Fail-open | sí — error de DB deja el circuito cerrado |
| Servicios rastreados | `GROQ_LLM`, `DEEPGRAM_STT` |

Cuando el circuito está OPEN: `callLlm()` lanza `CircuitBreakerError` → `handleMessage()` devuelve 503 + `Retry-After: 30` → QStash reintenta.

### LLM Key pooling

`LLM_API_KEY` acepta una lista CSV de keys de Groq. En cada llamada:
1. Se intenta la primera key disponible.
2. Si responde 429 → se intenta la siguiente key inmediatamente.
3. Si todas las keys responden 429 → `LlmRateLimitError(retryAfterSecs)` → 503 → QStash.
4. Si una key responde 5xx → se intenta la siguiente; si es la última, `reportServiceFailure('GROQ_LLM')`.

Parámetros LLM por modo:

| Modo | `temperature` | `max_tokens` | `parallel_tool_calls` |
|---|---|---|---|
| Con tools (loop) | 0.0 | 512 | false |
| Sin tools (texto) | 0.2 | 500 | — |

## 9. Tabla de tools (`tool-executor.ts`)

3 tools de escritura, todas detrás del confirmation-gate y del write-guard constitucional:

| Tool | Args requeridos | Rate-limit extra | Write-guard |
|---|---|---|---|
| `confirm_booking` | `service_id`, `date`, `time` | ✔ `checkBookingRateLimit` (5/24h) | ✔ `book_appointment` |
| `reschedule_booking` | `appointment_id`, `new_date`, `new_time` | — | ✔ `reschedule_appointment` |
| `cancel_booking` | `appointment_id` | — | ✔ `cancel_appointment` |

Tras éxito de cada tool, `tool-executor.ts` dispara en fire-and-forget:
- `emitCreatedEvent` / `emitRescheduledEvent` / `emitCancelledEvent` (notificación al dueño)
- `sendClientBookingConfirmation` (WhatsApp al cliente)

## 10. Costos y latencias observables

Las trazas `ai_traces` registran por turno: `latencyMs`, `totalTokens`, `stepsCount`, `toolsCount`, `outcome`. El exporter diario `export-ai-traces` agrupan en buckets (`fast/normal/slow/critical`, `low/medium/high/extreme`) para entrenar modelos sin exponer PII.

Outcomes posibles: `success | failure | error | rate_limited | no_action`.
