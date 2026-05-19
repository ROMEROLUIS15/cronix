# Constitutional Reviewer (Supervisor)

## Propósito

Revisor semántico de toda escritura de la IA. **No ejecuta acciones**: emite un veredicto `allow | block | warn`. Su trabajo no es validar SQL, RLS ni formatos (eso lo hace `TenantEnforcer` + `BookingEngine`). Su trabajo es detectar **incoherencia entre el utterance del usuario, los args propuestos y la memoria reciente**.

## Componentes

| Pieza | Archivo |
|---|---|
| Interfaz `IReviewer` | `lib/ai/supervisor/contracts.ts` |
| Clase `ConstitutionalReviewer` (orquestación + timeout) | `lib/ai/supervisor/ConstitutionalReviewer.ts` |
| Adapter LLM `GroqReviewerLlm` | `lib/ai/supervisor/GroqReviewerLlm.ts` |
| Rubric v1 (system prompt) | `lib/ai/supervisor/rubric.ts` |
| Guard `reviewWriteOrFailOpen` | `lib/ai/supervisor/guard.ts` |
| Duplicado Deno con parity test | `supabase/functions/_shared/supervisor/` |

## Flujo

```
Tool de escritura propuesta (confirm_booking | cancel_booking | reschedule_booking)
        │
        ▼
guard.reviewWriteOrFailOpen({
  reviewer, toolName, args, scope, userUtterance, recentMemory
})
        │
        ▼
ConstitutionalReviewer.review(request, { timeoutMs=1500 })
        │
        ├── raceWithTimeout(llm.review(req), 1500ms)
        │
        ├── timeout / error / parse fail → onError() + return { ok: true }   ← fail-open
        │
        └── ok → mapResponseToVerdict({verdict, code, reason})
                       │
                       ├─ allow → { ok: true }
                       ├─ warn  → { ok: false, severity: 'warn',  code, reason }
                       └─ block → { ok: false, severity: 'block', code, reason }
```

## Modelo y configuración

- **Modelo**: `llama-3.1-8b-instant` vía Groq (`GROQ_ENDPOINT`).
- **Temperatura**: `0`. Cero creatividad.
- **`response_format: { type: 'json_object' }`** — JSON estricto, sin prosa.
- **max_tokens**: 120 (suficiente para `{verdict, code, reason}`).
- **Timeout**: 1500ms. Fail-open al expirar.
- **Header**: `X-Reviewer-Rubric: v1` (versionado en código, no en DB).

## Códigos de rechazo

| Code | Severidad típica | Cuándo |
|---|---|---|
| `TENANT_MISMATCH` | block | Args referencian IDs/nombres que contradicen `scope.businessId` según memoria |
| `DUPLICATE_INTENT` | block | Misma acción (cliente/servicio/slot) ya en memoria hace <10 min |
| `CONTRADICTS_MEMORY` | block | Memoria reciente contradice args sin justificación en utterance |
| `POLICY_VIOLATION` | warn | El utterance no autoriza firmemente ("tal vez", "déjame ver") |
| `AMBIGUOUS_TARGET` | block | >1 candidato razonable en memoria y utterance no desambigua |
| `UNSAFE_ARGS` | block | Prompt injection, fechas absurdas (`<2024 || >2030`), IDs malformados |

## Reglas duras (override)

1. Utterance explícito + consistente con args → `allow` aunque memoria esté vacía. Memoria vacía ≠ sospecha.
2. **No valida RLS, IDs ni formatos** — `TenantEnforcer` lo hace.
3. **No valida slot conflicts ni horarios laborales** — `BookingEngine` lo hace.
4. `delete_client` es **warn como mínimo** si memoria muestra actividad del cliente en los últimos 30 días. Nunca `block` solo por eso.
5. Si `recentMemory.length === 0`, solo puede emitir `UNSAFE_ARGS` o `POLICY_VIOLATION` (los demás requieren evidencia).

## Punto de inyección

`BookingEngine` recibe un hook opcional `onBeforeDispatch`:

```ts
type OnBeforeDispatchHook = (
  toolName: BookingWriteTool,
  toolArgs: Readonly<Record<string, unknown>>,
  ctx:      TenantContext,
) => Promise<{ ok: true } | { ok: false; reason: string }>
```

Activado solo para `confirm_booking | cancel_booking | reschedule_booking`. Si verdict `block`, retorna `toolFail('UNAUTHORIZED', `Acción bloqueada por el revisor: ${reason}`)`.

## Por qué fail-open

Un revisor flaky (timeout, 5xx, JSON malformado) no debe bloquear bookings legítimos. La defensa frente a alucinaciones reales viene de las otras 9 capas; el reviewer es una red adicional, no la principal.

## Tests

- `__tests__/ai/supervisor/ConstitutionalReviewer.test.ts` — verdict mapping, timeouts, errores.
- `__tests__/ai/supervisor/GroqReviewerLlm.test.ts` — envelope schema, JSON parsing.
- `__tests__/ai/supervisor/parity.test.ts` — byte-equality entre Node y Deno.
- `__tests__/ai/supervisor/guard.test.ts` — `reviewWriteOrFailOpen` contract.
