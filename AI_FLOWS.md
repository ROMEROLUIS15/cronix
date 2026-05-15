# AI_FLOWS.md — Flujos del Sistema de IA

> Documentación técnica de los flujos de ejecución del BookingEngine y los adapters.
> Última actualización: 2026-05-03

---

## Índice

1. [Arquitectura General](#1-arquitectura-general)
2. [Flujo Dashboard (Owner)](#2-flujo-dashboard-owner)
3. [Flujo WhatsApp (Cliente externo)](#3-flujo-whatsapp-cliente-externo)
4. [Core: BookingEngine](#4-core-bookingengine)
5. [Fast-Path vs LLM](#5-fast-path-vs-llm)
6. [Estado Conversacional](#6-estado-conversacional)
7. [Aislamiento Multitenant](#7-aislamiento-multitenant)
8. [Manejo de Errores](#8-manejo-de-errores)

---

## 1. Arquitectura General

```
                          ┌─────────────────────────────────────────┐
                          │             CHANNELS                    │
                          │                                         │
    Owner (voz) ──────────► DashboardBookingAdapter (Node.js)       │
                          │         ↓                               │
    Cliente (WhatsApp) ───► WhatsApp Adapter (Deno Edge Function)   │
                          └────────────────┬────────────────────────┘
                                           │
                                           ▼
                          ┌─────────────────────────────────────────┐
                          │           SECURITY LAYER                │
                          │                                         │
                          │   TenantEnforcer.verify()               │
                          │   ├── DB query: users.business_id       │
                          │   └── throws UNAUTHORIZED if mismatch  │
                          │                                         │
                          │   Returns: TenantContext (phantom type) │
                          └────────────────┬────────────────────────┘
                                           │
                                           ▼
                          ┌─────────────────────────────────────────┐
                          │           BOOKING ENGINE                │
                          │     lib/ai/core/booking/                │
                          │                                         │
                          │   dispatch(ctx, toolName, rawArgs)      │
                          │   ├── Zod validate(rawArgs)             │
                          │   ├── ClientResolver.resolve()          │
                          │   ├── ServiceResolver.resolve()         │
                          │   ├── localToUTC(date, time, tz)        │
                          │   ├── UseCase.execute()                 │
                          │   └── cache.invalidate()                │
                          │                                         │
                          │   Returns: ToolResult<T> (never throws) │
                          └────────────────┬────────────────────────┘
                                           │
                                           ▼
                          ┌─────────────────────────────────────────┐
                          │           REPOSITORIES                  │
                          │   lib/repositories/                     │
                          │                                         │
                          │   IAppointmentQueryRepository           │
                          │   IAppointmentCommandRepository         │
                          │   IClientRepository                     │
                          │   IServiceRepository                    │
                          │                                         │
                          │   All queries: .eq('business_id', biz)  │
                          └────────────────┬────────────────────────┘
                                           │
                                           ▼
                          ┌─────────────────────────────────────────┐
                          │        SUPABASE (RLS + Admin)           │
                          │   + Redis (cache/conversational state)  │
                          └─────────────────────────────────────────┘
```

---

## 2. Flujo Dashboard (Owner)

El dueño del negocio usa el asistente de voz en el dashboard.

```
1. Usuario habla → Deepgram STT → texto transcrito
2. POST /api/assistant/voice/worker
   ├── getSession() → { userId, businessId, timezone }
   ├── OrchestratorFactory.create(supabase, agent, repos)
   └── orchestrator.process(input)

3. DecisionEngine.analyze(input, state)
   ├── Caso A (FAST-PATH): detecta intento claro + datos completos
   │   └── ExecutionEngine.executeImmediate(intent, args)
   │       └── DashboardBookingAdapter.execute(...)
   └── Caso B (LLM): intención ambigua o datos incompletos
       └── LlmBridge.callWithTools(messages, toolDefs)
           └── ExecutionEngine.handleToolCall(toolName, args)
               └── DashboardBookingAdapter.execute(...)

4. DashboardBookingAdapter.execute(params)
   ├── logger.info('ADAPTER', 'Tool request received', { toolName, businessId })
   ├── TenantEnforcer.verify(businessId, userId, timezone)
   │   ├── admin.from('users').eq('id', userId).single()
   │   └── throws UNAUTHORIZED si business_id no coincide
   ├── BookingEngine.dispatch(ctx, toolName, rawArgs)
   │   ├── Zod validate
   │   ├── ClientResolver / ServiceResolver
   │   ├── localToUTC(date, time, ctx.timezone)
   │   └── UseCase.execute({ businessId: ctx.businessId, ... })
   └── logger.info('ADAPTER', 'Tool succeeded', { durationMs })

5. ExecResult → StateManager.update(state, result)
6. Respuesta TTS → Deepgram Aura-2 → audio al usuario
```

### Ejemplo Real: "Agéndame a Juan Pérez mañana a las 3"

```
Input:  "Agéndame a Juan Pérez mañana a las 3"
                ↓
DecisionEngine: detecta booking intent + cliente + "mañana" + "3"
Fast-path D check: ¿tiene service_id? NO → ruta LLM
                ↓
LLM tool call: confirm_booking({
  service_id:  "manicura",   ← LLM infiere del contexto
  date:        "2026-05-04", ← "mañana" normalizado
  time:        "15:00",      ← "3" → "3 PM" → "15:00"
  client_name: "Juan Pérez"
})
                ↓
BookingEngine:
  1. Zod: time "15:00" ✓, date "2026-05-04" ✓
  2. ClientResolver.byName("Juan Pérez")
     → fuzzyFind → score 0.98 → found { id, name: "Juan Pérez" }
  3. ServiceResolver.resolve("manicura")
     → substring match → found { id, name: "Manicura", duration_min: 45 }
  4. localToUTC("2026-05-04", "15:00", "America/Bogota")
     → "2026-05-04T20:00:00.000Z"
  5. CreateAppointmentUseCase.execute({ businessId, clientId, ... })
     → findConflicts → [] → create → { id: "apt-xyz" }
  6. cache.invalidate(businessId, 'appointments')

Result: "Listo. Agendé a Juan Pérez para Manicura el lunes 4 de mayo a las 3:00 p. m."
```

---

## 3. Flujo WhatsApp (Cliente externo)

El cliente envía un mensaje de WhatsApp al número del negocio.

```
1. WhatsApp → Meta webhook → POST /api/webhooks/whatsapp
   ├── HMAC signature verification (sha256)
   └── Encola en QStash → process-whatsapp Edge Function

2. process-whatsapp/index.ts
   ├── context-fetcher: carga business, services, appointments del día
   ├── TenantEnforcer.verifyWebhook(businessId, timezone)
   │   └── verifica que el negocio existe en DB
   ├── confirmation-gate: verifica si el cliente ya confirmó
   ├── ai-agent: llamada a Groq LLM con historial de Redis
   └── tool-executor: ejecuta tool call

3. State Management (Redis)
   ├── Key: `wa:state:{businessId}:{phone}`
   ├── TTL: 24h
   └── Contiene: historial de mensajes + estado conversacional

4. Diferencias con Dashboard:
   ├── Identidad: phone number (no userId)
   ├── Confirmación: always required (gate multi-turn)
   ├── Auto-create client: sí, por teléfono
   └── TenantEnforcer: verifyWebhook() (no verify())
```

---

## 4. Core: BookingEngine

El BookingEngine es la única fuente de verdad para operaciones de citas.

### Tools disponibles

| Tool | Operación | Schema Zod |
|------|-----------|-----------|
| `confirm_booking` | Crear cita | `ConfirmBookingSchema` |
| `cancel_booking` | Cancelar cita | `CancelBookingSchema` |
| `reschedule_booking` | Reagendar cita | `RescheduleBookingSchema` |
| `get_appointments_by_date` | Listar citas | `GetByDateSchema` |
| `get_available_slots` | Ver disponibilidad | `GetAvailableSlotsSchema` |
| `create_client` | Registrar cliente | `CreateClientSchema` |
| `search_clients` | Buscar cliente | `SearchClientsSchema` |

### Invariantes (NUNCA se violan)

1. **Nunca lanza**: `dispatch()` tiene try/catch global — cualquier excepción se convierte en `toolFail('DB_ERROR', ...)`
2. **Valida antes de operar**: Zod schema se parsea ANTES de cualquier query a DB
3. **Timezone en la capa correcta**: `localToUTC()` se llama una sola vez, justo antes de escribir
4. **Scoping por businessId**: toda query usa `ctx.businessId` del TenantContext, nunca del payload
5. **Invalida cache en writes**: `cache.invalidate(ctx.businessId, 'appointments')` después de cada escritura exitosa

### ClientResolver — Estrategia

```
resolve(ctx, { clientId?, clientName? })
  ├── byId(clientId)     → getById(clientId, ctx.businessId)
  └── byName(clientName) → findActiveForAI(ctx.businessId)
                           → fuzzyFind(clients, name)
                              ├── score ≥ 0.45: candidatos
                              ├── gap ≥ 0.15:   found
                              └── gap < 0.15:   ambiguous
```

### ServiceResolver — 4 Estrategias

```
resolve(ctx, serviceIdOrName)
  ├── Strategy 1: UUID exacto → s.id === serviceIdOrName
  ├── Strategy 2: Nombre exacto → normalize(s.name) === normalize(input)
  ├── Strategy 3: Fuzzy match → similarity ≥ 0.45
  └── Strategy 4: Substring → name.includes(input) || input.includes(name)
```

---

## 5. Fast-Path vs LLM

El DecisionEngine decide si la solicitud puede resolverse sin llamar al LLM.

### Fast-Paths (cero tokens LLM)

| Path | Condición | Acción |
|------|-----------|--------|
| A | Confirmación ("sí") en estado `awaiting_confirmation` | Ejecutar draft |
| B | Rechazo ("no") en estado `awaiting_confirmation` | Cancelar draft |
| C | Consulta simple de citas ("¿qué tengo hoy?") | `get_appointments_by_date` |
| D | Booking con todos los datos + `client_name` | `confirm_booking` directo |
| E | Cancelar con appointment_id explícito | `cancel_booking` directo |

### Cuándo va al LLM

- Intención ambigua ("quiero algo mañana")
- Datos incompletos que requieren preguntas
- Flujo multi-turn que no coincide con ningún fast-path
- Cualquier estado `reason_with_llm` del DecisionEngine

### Validación de Fast-Path D

Para activar el fast-path de booking directo, el sistema verifica:
1. Intención detectada = `confirm_booking`
2. `draft.service_id` presente
3. `draft.date` en formato YYYY-MM-DD válido
4. `draft.time` en formato HH:mm válido
5. **`draft.client_name` presente** ← fix crítico aplicado

Sin `client_name`, la request va al LLM para que pregunte el nombre.

---

## 6. Estado Conversacional

### Dashboard (Redis + Next.js)

```typescript
// Key pattern: `ai:session:{businessId}:{userId}`
// TTL: 30 minutos de inactividad
interface ConversationState {
  flow:        'idle' | 'awaiting_confirmation' | 'collecting_info'
  draft:       Partial<ConfirmBookingInput>
  turnCount:   number
  maxTurns:    number  // límite para evitar bucles infinitos
  lastIntent:  string | null
  lastAction:  string | null
}
```

### WhatsApp (Redis en Supabase Edge)

```typescript
// Key pattern: `wa:state:{businessId}:{phoneNumber}`
// TTL: 24h (conversación del día)
// Almacena: historial completo de mensajes LLM + confirmation state
```

### Circuit Breaker

```
AICircuitBreaker controla llamadas al LLM:
  CLOSED → OPEN  : 5 fallos consecutivos
  OPEN   → HALF  : después del cooldown (configurable)
  HALF   → CLOSED: 1 éxito
  HALF   → OPEN  : 1 fallo

Rate limit errors (429) NO cuentan como fallo.
```

---

## 7. Aislamiento Multitenant

### Capa 1: TenantContext (Phantom Type)

```typescript
// Este type NO puede construirse manualmente
type TenantContext = {
  readonly businessId: string
  readonly userId:     string
  readonly timezone:   string
  readonly [__tenantBrand]: true  // phantom — existe solo en TypeScript
}

// ÚNICO path válido:
const ctx = await TenantEnforcer.verify(businessId, userId, timezone)
// o:
const ctx = await TenantEnforcer.verifyWebhook(businessId, timezone)
```

### Capa 2: BookingEngine acepta TenantContext

```typescript
// El compilador rechaza esto:
bookingEngine.dispatch(
  { businessId: 'attack', userId: 'x', timezone: 'UTC' }, // ❌ NO es TenantContext
  ...
)

// Solo esto compila:
const ctx = await TenantEnforcer.verify(...)  // retorna TenantContext
bookingEngine.dispatch(ctx, ...)  // ✓
```

### Capa 3: Repos filtran por business_id

```typescript
// TODAS las queries incluyen:
.eq('business_id', businessId)  // businessId viene de ctx.businessId

// updateStatus tiene ownership assert explícito:
if (apt.business_id !== businessId) {
  throw new Error(`Ownership mismatch: ...`)
}
```

### Capa 4: RLS de Supabase

Todas las tablas tienen Row Level Security habilitado. El admin client se usa SOLO en TenantEnforcer para la verificación inicial. Las operaciones regulares usan el client del usuario (RLS activo).

### Resultado: 4 barreras independientes

Un atacante necesitaría bypassear TODAS para comprometer datos de otro tenant:
1. TypeScript phantom type (compile-time)
2. TenantEnforcer.verify() (runtime, DB check)
3. Repository queries con business_id (application layer)
4. Supabase RLS (database layer)

---

## 8. Manejo de Errores

### Jerarquía de tipos de error

```typescript
type ToolErrorCode =
  | 'SLOT_CONFLICT'        // horario ocupado — sugerir otro slot
  | 'CLIENT_NOT_FOUND'     // cliente no existe — preguntar nombre
  | 'CLIENT_AMBIGUOUS'     // múltiples clientes similares — pedir aclaración
  | 'SERVICE_NOT_FOUND'    // servicio no existe — mostrar lista
  | 'APPOINTMENT_NOT_FOUND'// cita no existe o no pertenece al negocio
  | 'UNAUTHORIZED'         // cross-tenant o sesión inválida
  | 'INVALID_ARGS'         // input del LLM malformado
  | 'DB_ERROR'             // error de infraestructura — retry
  | 'BOOKING_RATE_LIMIT'   // throttle — esperar
  | 'PLAN_LIMIT_REACHED'   // límite del plan SaaS
```

### Flujo de error al usuario

```
ToolFailure → serializeForLlm(result) → LLM mensaje → TTS → Usuario

El LLM recibe el mensaje de error y genera una respuesta natural.
El código de error (SLOT_CONFLICT, etc.) permite al adapter decidir
si enviar notificación, mostrar sugerencias, etc.
```

### Nunca lanza — contrato público

```
BookingEngine.dispatch()       → siempre retorna ToolResult
DashboardBookingAdapter.execute() → siempre retorna ExecResult
Repositories.any()             → siempre retorna Result<T>

Excepciones internas son capturadas y convertidas a tipos de retorno.
El caller NUNCA necesita try/catch al usar estos componentes.
```
