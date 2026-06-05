# Voice Agent — Arquitectura end-to-end

> Verificado contra `supabase/functions/voice-worker/agent.ts`, `voice-pipeline.ts`, `capabilities/`, `core/repos/` y `_shared/`.
> Última revisión: 2026-06-04.

## 1. Visión

El Voice Agent es el asistente conversacional del dashboard del dueño del negocio. Habla a través de voz (STT → agente → TTS) y puede agendar, cancelar, reagendar, buscar clientes y consultar disponibilidad. A diferencia del WhatsApp Agent (que atiende clientes del negocio), este atiende al **operador** (el dueño o recepcionista).

## 2. Pipeline completo (`agent.ts` + `voice-pipeline.ts`)

```
Entrada del dueño (texto transcripto por STT externo)
   │
   ▼
voice-worker/index.ts → runAgent(ctx, input)
   │
   ├─ tracer.start({ businessId, channel: 'voice-worker', actorKind: 'user', actorKey: userId })
   │
   ├─ Constitutional guard — LAZY write-guard closure:
   │     ctx.runWriteGuard = async (toolName, args) => {
   │       recentMemory = await ensureMemory()   ← recall solo si se llama
   │       outcome = await reviewWriteOrFailOpen({ reviewer, toolName, args, ... })
   │       return outcome.allowed ? null : { success: false, result: reason }
   │     }
   │
   ├─ Fast path detection — detectFastPath({ text, today, timezone, history, lastRef, services })
   │     ├─ Itera CAPABILITIES en orden de prioridad (nextAppointment primero, availableSlots último)
   │     ├─ Cada cap.detectFastPath(input) retorna args | null
   │     └─ Primera coincidencia → { capability, args }
   │
   ├─ FAST PATH HIT:
   │     ├─ executeByName(capability.name, args, ctx)
   │     ├─ trace.recordToolCall(...)
   │     ├─ result.fallthroughToLLM? → continúa al LLM path (ver §4)
   │     └─ buildFastPathOutput() → return AgentOutput
   │           ├─ text = result.result (verbatim si bypassLLM)
   │           ├─ history = [...input.history, user, assistant].slice(-30)
   │           ├─ capability.isWrite && success → buildNotificationFromWrite()
   │           │     eventId = buildAppointmentEventId() ← determinístico, dedup por UNIQUE constraint
   │           └─ trace.finish(outcome)
   │
   └─ LLM PATH (no fast path, o fast path falló con fallthroughToLLM):
         ├─ provider = getProvider()       ← env LLM_PROVIDER: 'groq' | 'gemini' | 'gemini,groq'
         ├─ tools = toNeutralTools()       ← capability definitions → NeutralTool[]
         ├─ system = buildSystemPrompt(input)
         ├─ dateOverride = detectTemporalIntent(text, todayLocal)
         │     "hoy" | "mañana" | "pasado mañana" → DateOverride { date, reason }
         │
         └─ buildVoicePipeline().run({ provider, tools, system, dateOverride, ctx, input, trace })
               │
               └─ stepLlmLoop():  MAX_STEPS=3, temperature=0.1, maxOutputTokens=400
                     │
                     ├─ provider.chat({ system, messages, tools, temperature, maxOutputTokens })
                     │     FallbackChain: Gemini primary → Groq fallback (si LLM_PROVIDER='gemini,groq')
                     │
                     ├─ NO tool_calls → finalText = content.trim(); break
                     │
                     ├─ tool_calls presentes:
                     │   ├─ parse JSON args (inválido → inject error message al LLM)
                     │   ├─ applyDateOverride(tc, args, dateOverride)  ← sobreescribe date si tool ∈ DATE_TOOLS
                     │   ├─ fingerprint dedup Set<toolName::sortedArgs>
                     │   │     duplicado → inject DUPLICATE warning; continue
                     │   ├─ executeByName(tc.name, args, ctx)
                     │   │     └─ cap.execute(ctx, args)  → ver §3 Booking/Client/Cancel/Reschedule
                     │   ├─ trace.recordToolCall(...)
                     │   └─ BYPASS_CAPABILITIES: si única tool del turno y bypassLLM=true
                     │         → finalText = result.result; break (skip síntesis LLM)
                     │
                     └─ finalText vacío + actionPerformed → 'Listo.'
                        finalText vacío sin action → 'No te entendí bien, ¿puedes repetir?'
```

## 3. Sub-agentes: Booking, Client, Cancel, Reschedule

### Booking Agent (`capabilities/schedule/tool.ts:executeSchedule`)

```
executeSchedule(ctx, { service_name, client_name, date, time, register_new_client? })
   │
   ├─ Corpus override: extractSlotsFromCorpus(ctx.userTextCorpus) → recupera date/time que el LLM perdió entre turnos
   │
   ├─ Validation: firstMissing() → rechaza si falta client_name | service_name | date | time
   │
   ├─ Anti-hallucination corpus guards (si corpus disponible):
   │     nameMentionedInCorpus(corpus, service_name) → rechaza si el LLM inventó el servicio
   │     nameMentionedInCorpus(corpus, client_name)  → rechaza si el LLM inventó el cliente
   │     timeMentionedInCorpus(corpus)               → rechaza si el LLM inventó la hora
   │     dateMentionedInCorpus(corpus, todayLocal)   → rechaza si el LLM inventó la fecha
   │
   ├─ Client Agent: resolveClient(ctx, client_name)
   │     ├─ found + needsConfirmation → formatConfirmationPrompt() (confianza < WRITE_CONFIDENCE_THRESHOLD)
   │     ├─ ambiguous → lista candidatos
   │     ├─ not_found + register_new_client=true → INSERT client
   │     └─ not_found sin flag → pide confirmación de registro
   │
   ├─ Service: resolveService(ctx, service_name) → si no existe: lista catálogo disponible
   │
   ├─ Time: localToUTC(date, time, ctx.timezone) + buildEndISO(startISO, service.duration_min)
   │
   ├─ Conflict check: findConflicts(ctx, startISO, endISO) → rechaza si el slot está ocupado
   │
   ├─ Write-guard: ctx.runWriteGuard('book_appointment', { clientId, clientName, serviceId, serviceName, date, time })
   │     → ConstitutionalReviewer → fail-open si timeout/error
   │
   └─ INSERT appointments { business_id, client_id, service_id, start_at, end_at, status:'pending' }
         → return BookingEventData { appointmentId, clientName, serviceName, date, time, action:'created' }
```

### Cancel Agent (`capabilities/cancel/tool.ts:executeCancel`)

```
executeCancel(ctx, { client_name, appointment_id?, date?, time? })
   │
   ├─ Anaphoric path (appointment_id given desde lastRef):
   │     findAppointmentById(ctx, appointment_id) → lookup directo por ID
   │     supabase.from('clients').select('name').eq('id', apt.client_id)
   │
   ├─ Explicit path (solo client_name):
   │     resolveClient(ctx, client_name)
   │     ├─ ambiguous → lista candidatos
   │     ├─ not_found → { success: false, fallthroughToLLM: true }  ← LLM reintenta con contexto
   │     ├─ found + needsConfirmation → formatConfirmationPrompt()
   │     └─ found → findAppointmentByClientName(ctx, client, date?, time?)
   │
   ├─ resolveService → serviceName para el write-guard y notificación
   ├─ utcToLocalParts(apt.start_at, ctx.timezone) → localDate, localTime
   │
   ├─ Write-guard: ctx.runWriteGuard('cancel_appointment', { appointmentId, clientName, serviceName, date, time })
   │
   └─ UPDATE appointments SET status='cancelled' WHERE id=apt.id AND business_id=ctx.businessId
         → return BookingEventData { ..., action:'cancelled' }
```

### Reschedule Agent (`capabilities/reschedule/tool.ts:executeReschedule`)

```
executeReschedule(ctx, { client_name, appointment_id?, date?, time?, new_date?, new_time? })
   │
   ├─ Corpus override: extractSlotsFromCorpus(ctx.userTextCorpus) → recupera new_date/new_time
   │
   ├─ Validate: (!new_date && !new_time) → '¿Para qué fecha y hora la reagendo?'
   │
   ├─ Anaphoric path (appointment_id → lookup directo)
   ├─ Explicit path (resolveClient → findAppointmentByClientName → confidence check)
   │     not_found → { fallthroughToLLM: true }
   │
   ├─ resolveService → durationMin + serviceName
   │
   ├─ Partial update guard: finalDate = new_date ?? existingDate (solo una dirección cambia)
   │                         finalTime = new_time ?? existingTime
   │   utcToLocalParts(apt.start_at, ctx.timezone) → existingDate, existingTime
   │
   ├─ Conflict check: findConflicts(ctx, newStartISO, newEndISO, apt.id)  ← excluye la propia cita
   │
   ├─ Write-guard: ctx.runWriteGuard('reschedule_appointment', { appointmentId, clientName, serviceName,
   │               previousDate, previousTime, newDate, newTime })
   │
   └─ UPDATE appointments SET start_at=newStartISO, end_at=newEndISO WHERE id=apt.id AND business_id=...
         → return BookingEventData { ..., action:'rescheduled' }
```

### Client Agent (`core/repos/clients.ts:resolveClient`)

```
resolveClient(ctx, name)
   │
   ├─ getActiveClients(ctx) → SELECT id, name, phone FROM clients WHERE business_id=... AND deleted_at IS NULL
   ├─ fuzzyFind(clients, name)
   │     ├─ found (confidence ≥ threshold) → { status:'found', client, confidence, candidates }
   │     ├─ ambiguous (múltiples match similares) → { status:'ambiguous', candidates, confidence }
   │     └─ not_found → { status:'not_found' }
   │
   └─ needsConfirmation(r): r.confidence < WRITE_CONFIDENCE_THRESHOLD
         → formatConfirmationPrompt(r, query)
               ├─ sin hermanos: "Entendí 'X' como NombreReal. ¿Confirmas?"
               └─ con hermanos: "No estoy seguro... ¿Es NombreA, NombreB, NombreC?"
```

`getClientFirstNamesForBoost()` exporta primeros nombres para el keyword-boost de Deepgram STT — mejora reconocimiento de nombres propios del negocio.

## 4. Fast-path priority y fallthroughToLLM

El registro de capabilities tiene **orden explícito de prioridad** (`registry.ts`):

```
1. nextAppointmentCapability   ← "próxima cita" sin fecha → no debe caer en listAppointments
2. listAppointmentsCapability  ← "qué tengo mañana"
3. rescheduleCapability        ← "reagenda" — antes que schedule (mismo espacio de verbos)
4. cancelCapability            ← "cancela"
5. deleteClientCapability
6. scheduleCapability          ← "agenda"
7. lastVisitCapability         ← antes de searchClients: "última cita de X" no debe ir a search
8. searchClientsCapability
9. getServicesCapability
10. createClientCapability     ← sin fast-path (solo LLM)
11. availableSlotsCapability
```

`fallthroughToLLM: true` — cuando `cancel` o `reschedule` no encuentran al cliente en la DB (STT mishear), en lugar de fallar, devuelven este flag y `agent.ts` cae al LLM path, que tiene el listado completo de clientes en el system prompt.

## 5. Provider FallbackChain

```
LLM_PROVIDER env var:
  'groq'        → GroqProvider (solo)
  'gemini'      → GeminiProvider (solo)
  'gemini,groq' → FallbackChain: Gemini → fallo → Groq

FallbackChain.chat():
  ├─ provider[0].chat() → OK → return response
  ├─ provider[0].chat() → error → console.warn
  └─ provider[1].chat() → return response
```

No hay circuit breaker en Voice (a diferencia de WhatsApp). Los errores del provider se propagan al caller para que el Edge runtime los maneje.

## 6. bypassLLM (síntesis cortocircuitada)

`shouldBypassSynthesis(toolCalls, lastResultText)`:
- Condición: exactamente **1 tool call** en el turno + la capability tiene `bypassLLM=true` + `result.result !== null`
- Efecto: `finalText = lastResultText; break` — el loop LLM no continúa, no hay síntesis LLM de la respuesta
- Todas las capabilities actuales tienen `bypassLLM=true`: el texto de la tool ya es prosa legible

## 7. Observabilidad

Cada turno abre un `TraceHandle`:
- `tracer.start({ businessId, channel:'voice-worker', actorKind:'user', actorKey:userId })`
- `trace.recordLlmStep({ model, latencyMs, tokens, hadToolCalls })`
- `trace.recordToolCall({ tool, durationMs, status, argsFingerprint, errorCode })`
- `trace.finish({ outcome, finalTextSha })`

Outcomes: `success | failure | no_action`. El fast path emite `no_action` si la capability es read-only.

## 8. Diferencias clave vs WhatsApp Agent

| Aspecto | WhatsApp | Voice |
|---|---|---|
| Actor | Cliente del negocio | Dueño / operador |
| Confirmation gate | 2-turn gate (tools vacías hasta confirmar) | No existe (el dueño da órdenes directas) |
| Memory recall | Eager (siempre al inicio del turno) | Lazy (solo si hay write) |
| Semantic router | ✔ `router.classify()` en cada turno | ✗ No se usa |
| Tool recovery `<function>` | ✔ `recoverEmbeddedToolCall()` | ✗ No aplica (provider-agnostic) |
| Circuit breaker LLM | ✔ Postgres RPC `fn_wa_check_circuit_breaker` | ✗ No tiene |
| Key pooling | ✔ CSV de API keys Groq | ✗ Una key por provider |
| Final pass | 100% determinista (templates + errorCodes) | bypassLLM o síntesis LLM directa |
| Fast paths | ✗ No (solo LLM loop + `<function>` recovery) | ✔ 11 capabilities con fast-path detector |
