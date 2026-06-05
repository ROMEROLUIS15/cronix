# Sistema de IA — Cronix

> Fusión de `AI_FLOWS.md` + `AI_MASTER_GUIDE.md` + `ANTI_HALLUCINATION_PATTERNS.md`.
> Verificado contra `lib/ai/`, `supabase/functions/voice-worker/`, `supabase/functions/process-whatsapp/` y `supabase/functions/_shared/`.
> Última revisión: 2026-06-04.
>
> Docs relacionados: [`WHATSAPP_AGENT.md`](WHATSAPP_AGENT.md) · [`VOICE_AGENT.md`](VOICE_AGENT.md) · [`internals/SUPERVISOR.md`](internals/SUPERVISOR.md) · [`internals/VOICE_CAPABILITY_REGISTRY.md`](internals/VOICE_CAPABILITY_REGISTRY.md)

## 1. Topología

Dos canales agentes, un núcleo de dominio compartido:

```
Owner (voz)  ──► voice-worker   (Deno Edge)
Cliente (WA) ──► process-whatsapp (Deno Edge)
                          │
                          ▼
                  ConstitutionalReviewer (Groq 8B)
                  + MemoryEngine (pgvector + gte-small)
                  + SemanticRouter (gte-small + cosine)
                  + Tracer (ai_traces)
```

## 2. Modelos en producción (cero costo o casi cero)

| Capa | Modelo | Por qué |
|---|---|---|
| LLM principal voz | Groq `llama-3.3-70b-versatile` | Tier gratuito Groq + tool-calling robusto |
| Fallback voz | Groq `llama-3.1-8b-instant` | Misma cuota, otro modelo del mismo proveedor |
| Cadena alterna | Gemini `gemini-2.0-flash` (vía endpoint OpenAI-compat) | Activable por `LLM_PROVIDER` env var (`gemini`, `gemini,groq`) |
| ReAct decisor WA | Groq `llama-3.1-8b-instant` | Latencia y costo bajos para loops de 3 pasos |
| Síntesis WA | — (eliminado) | El final-pass es 100% determinista: template en success, errorCode map en failure, `loopText` del 8B en conversacional. `LARGE_MODEL` está definido en `groq-client.ts` pero **no se llama** desde `ai-agent.ts`. |
| Supervisor | Groq `llama-3.1-8b-instant` @ T=0 + `response_format json_object` | JSON determinista, fail-open |
| Embeddings | `gte-small` (384 dim) vía `Supabase.ai.Session` (Edge Function `embed-text`) | Local al edge, sin costo de API externa |
| STT | Deepgram Nova-2 (`language=es`, keywords-boost con nombres reales) | Free tier amplio + sesgo a nombres propios del negocio |
| TTS | Deepgram Aura-2 voz `aura-2-nestor-es` | Latencia <500ms, voz masculina ES neutral |

## 3. Las 10 capas anti-alucinación

1. **Corpus mention guards** — antes de cualquier escritura, cada slot (servicio/cliente/fecha/hora) debe rastrearse a algo que el usuario dijo este turno (`nameMentionedInCorpus`/`timeMentionedInCorpus`/`dateMentionedInCorpus`). Si el modelo inventó un nombre o servicio, la capability se niega (`voice-worker/capabilities/schedule/tool.ts`).
2. **Fast-paths totales sin LLM** — `voice-worker/capabilities/_shared/registry.ts`. 9 capabilities con detector + tool + (opcional) bypass de síntesis.
3. **Date guard determinista** — si el usuario dijo "hoy / mañana / pasado mañana", la fecha se sobrescribe antes de ejecutar el tool. `detectTemporalIntent()` se llama en `voice-worker/agent.ts` y el override se aplica en `voice-pipeline.ts:applyDateOverride()` por cada `DATE_TOOLS` call.
4. **Frame-cutoff corpus** — corta el historial en el último turno asistencial **terminal** (éxito `Listo.…`, error definitivo `No encontré…`, etc.) para que tokens de intentos viejos no contaminen los guards, sin truncar la recolección multi-turno (`voice-worker/core/conversation/frame.ts`).
5. **Per-turn fingerprint dedup** — `Set<toolName::sortedArgsJSON>`. Si el modelo repite la misma llamada, se rechaza con un mensaje al modelo y se rompe el loop.
6. **Response bypass (`bypassLLM`)** — la prosa de la tool se devuelve tal cual. Documentado como patrón `return_direct=True` de LangChain.
7. **Confirmation gate 2-turn (WA)** — el array de tools llega vacío al LLM hasta que el cliente afirma una pregunta de confirmación.
8. **Embedded `<function>` recovery (WA)** — texto fugado `<function=name>{...}</function>` se promueve a `tool_calls[]` real con validación estricta.
9. **Router semántico** — 9 intents con embeddings precalculados, threshold 0.78. Sirve para enriquecer prompts y para la afirmación del gate.
10. **Constitutional reviewer (semántico)** — Groq 8B emite veredicto `allow|block|warn` con códigos `TENANT_MISMATCH`, `DUPLICATE_INTENT`, `CONTRADICTS_MEMORY`, `POLICY_VIOLATION`, `AMBIGUOUS_TARGET`, `UNSAFE_ARGS`. Fail-open con timeout 1500ms.

## 4. Booking — 2 canales IA + dashboard manual

No hay engine de booking compartido (ver ADR-0006). El booking por IA ocurre en **dos canales Deno**; el dashboard agenda **manualmente** (sin IA). Lo único compartido es la BD (RPCs + constraints):

```
WhatsApp (_shared/booking-adapter.ts)
    normaliza args → RPC fn_book_appointment_wa / fn_reschedule_appointment_wa
        (conflict-check + cliente por teléfono dentro del RPC)

Voz (voice-worker/capabilities/{schedule,cancel,reschedule}/)
    corpus guards → resolución de cliente (ambigüedad) → conflict-check
        → write guard → INSERT

Dashboard UI (sin IA)
    forms → server actions → lib/domain/use-cases/* → repos
```

El write guard constitucional (`runWriteGuard`) corre **antes** del INSERT/UPDATE en WhatsApp y voz. El dashboard manual no pasa por IA, así que no aplica.

## 5. Memoria episódica

- Tabla `ai_memories_v2`: `business_id, actor_kind ∈ {user, client_phone}, actor_key, kind, content, embedding vector(384), metadata jsonb, expires_at`.
- RPC `match_ai_memories_v2(business_id, actor_kind, actor_key, query_embedding, match_threshold, match_count)` aplica filtro tenant **antes** del vector scan.
- **WhatsApp**: recall es **eager** — `memoryEngine.recall()` se ejecuta en paralelo con `router.classify()` al inicio de `runAgentLoop()`, siempre, antes de saber si habrá una tool de escritura.
- **Voice**: recall es **lazy** — envuelto en `ensureMemory()` closure dentro de `ctx.runWriteGuard`. Solo se llama cuando una capability invoca el write-guard; si el turno es solo lectura, el recall no ocurre.
- En ambos canales la memoria vacía (`recentMemory: []`) no es sospecha — solo limita los códigos de bloqueo del supervisor (`TENANT_MISMATCH`, `DUPLICATE_INTENT`, etc. requieren evidencia en memoria).
- Escritura: fire-and-forget tras success (`MemoryEngine.write`, TTL 180 días por defecto).

## 6. Observabilidad — `ai_traces`

Cada turno abre un `TraceHandle`:

```ts
trace = tracer.start(
  { businessId, channel, actorKind, actorKey },
  shortHash(userText),
  { memory_hits, intent, intent_confidence },
)
// ... durante el loop:
trace.recordLlmStep({ model, latencyMs, tokens, hadToolCalls })
trace.recordToolCall({ tool, durationMs, status, argsFingerprint, errorCode })
// al final:
await trace.finish({ outcome, errorCode, finalTextSha })
```

`PgTraceSink` persiste un row por turno. Outcomes: `success | failure | error | rate_limited | no_action`.

## 7. Pipeline de training data — `ai_training_exports`

Cron diario 03:00 UTC → `export-ai-traces` Edge Function:

1. Por cada `business_id`, samplea hasta 500 trazas del último día con RPC `ai_traces_sample_window`.
2. Transforma a `TrainingSample`:
   - `latencyMs` → bucket `fast (<800) | normal (<2000) | slow (<5000) | critical`.
   - `totalTokens` → bucket `low (<200) | medium (<800) | high (<2000) | extreme`.
   - `outcome`, `errorCode`, `toolSequence`, `intent`, `stepsCount`, `toolsCount`, `channel`.
3. Inserta una fila en `ai_training_exports` con `schema_version`.

**Cero PII**: la transformación nunca toca textos del usuario ni IDs personales. Solo señales estructurales.

`lib/ai/training/TrainingExporter.ts` y `supabase/functions/_shared/training/TrainingExporter.ts` están duplicados byte-by-byte y tienen un parity test (`__tests__/ai/training/`).

## 8. Router semántico — `lib/ai/router/intents.ts`

9 intents: `book_appointment`, `cancel_appointment`, `reschedule_appointment`, `check_availability`, `pricing_inquiry`, `list_appointments`, `greeting`, `affirmation`, `negation`.

Pipeline:
1. `seed-intent-embeddings.ts` corre offline (`npm run seed:intents`) y escribe el JSON precalculado a `lib/ai/router/intent-embeddings.generated.json` y a `supabase/functions/_shared/router/intent-embeddings.generated.json`.
2. Runtime: `SemanticRouter.classify(text)` llama al embedder, calcula cosine vs cada prototipo, retorna `{intent, confidence, matched}` o `null` si todos < threshold (0.78).
3. El `gte-small` retorna embeddings ya L2-normalizados → cosine = dot product (cheap).

## 9. Parity entre Node y Deno (`supabase/functions/_shared/`)

Las Edge Functions Deno no pueden importar módulos Node (`@supabase/ssr`, `next/server`). Para reutilizar la lógica de IA, se duplica byte-by-byte bajo `_shared/` (suffix `.ts` requerido por Deno):

| Node (lib/ai/) | Deno (_shared/) | Parity test |
|---|---|---|
| `memory/` | `memory/` | `__tests__/ai/memory/parity.test.ts` |
| `router/` | `router/` | `__tests__/ai/router/parity.test.ts` |
| `supervisor/` | `supervisor/` | `__tests__/ai/supervisor/parity.test.ts` |
| `training/` | `training/` | `__tests__/ai/training/parity.test.ts` |
| `observability/` | `observability/` | `__tests__/ai/observability/parity.test.ts` |

Si la copia drifta, los tests fallan y el push se bloquea.

## 10. Provider FallbackChain

`voice-worker/providers/registry.ts` resuelve `LLM_PROVIDER` env:
- `groq` → solo Groq
- `gemini` → solo Gemini
- `gemini,groq` → cadena con fallback: Gemini falla → log warn → Groq toma el turno.

Cualquier provider nuevo se añade implementando `ILLMProvider` y registrándolo en `PROVIDER_FACTORY`. `agent.ts` no se toca.

## 11. Resilience (Node-side)

- `circuit-breaker.ts` cuenta fallos consecutivos. Tras N, abre el circuito y rechaza por X ms.
- `resilience.ts` envuelve `safeLLM` y `safeTTS` con timeouts, single-retry y reportería a Sentry.
- `process-whatsapp/guards.ts:checkCircuitBreaker` aplica lo mismo en Deno.

## 12. Costo operativo del sistema de IA

- Groq + Gemini: tier gratuito cubre el volumen actual de pruebas y los primeros tenants.
- Deepgram Nova-2/Aura-2: free tier con créditos rotativos; el `keywords` boost no añade costo.
- `gte-small`: corre dentro de Supabase Edge — no se paga API externa.
- Postgres / Redis / QStash: planes free de Supabase y Upstash sostienen el MVP.

Total real: USD $0/mes mientras el tráfico siga bajo los free tiers.
