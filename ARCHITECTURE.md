# Cronix — Arquitectura del Sistema

> Última actualización: 2026-04-18.

Este documento describe la arquitectura técnica de Cronix tras la refactorización a un modelo **Domain-Driven Repository** con **AI Orchestration Hardening**.

## 1. Capas del Sistema

Cronix sigue una arquitectura de diseño limpio separada en capas:

### Capa de Presentación (UI)
- **Tecnología**: Next.js 15 (App Router).
- **Responsabilidad**: Renderizar la interfaz, manejar el estado local de la UI y capturar entradas del usuario.
- **Acceso a Datos**: NUNCA llama a Supabase directamente. Usa el factory `getRepos(supabase)` o Server Actions.

### Capa de Aplicación / Dominio
- **Contratos (Interfaces)**: Ubicados en `lib/domain/repositories/`. Definen QUÉ operaciones se pueden hacer, no cómo.
- **Manejo de Errores**: Patrón `Result<T>`: `{ data: T | null, error: string | null }`. Elimina `try/catch` dispersos en la UI.

### Capa de Infraestructura
- **Implementación**: `lib/repositories/` — Repositorios Supabase concretos.
- **Aislamiento**: Cada repositorio asegura que todas las consultas incluyan `business_id` (Multi-tenancy).

---

## 2. Flujo de Datos de la IA (Web Assistant)

El **AI Assistant** del dashboard utiliza una arquitectura de confianza cero con guardrails en tiempo de ejecución:

```
POST /api/assistant/voice
       │
       ▼
route.ts → [Validation: reject empty/noise input]
       │
       ▼
DecisionEngine.analyze(input, state)
  ├── [Guard] Services guard (empty services → reject)
  ├── [Normalize] extractEntities() → resolved date/time injected into prompt
  ├── Fast path: reject / execute_immediately
  └── LLM path: reason_with_llm + system prompt + RBAC tool defs
       │
       ▼
ExecutionEngine.execute(Decision) — ReAct loop (max 5 steps)
  ├── [Guard] Confirmation interception (write tool → awaiting_confirmation for external/employee)
  ├── [Guard] UUID state priority (draft locks service_id, client_id, appointment_id)
  ├── [Guard] Availability claim guard (LLM cannot claim slots without calling read tool)
  ├── [Guard] Write-action claim guard (LLM cannot claim booking without calling write tool)
  └── RealToolExecutor → UseCase → IRepository → Supabase
         └── returns { data: BookingEventData } — structured, no string parsing
       │
       ▼
emitBookingEvent() → NotificationService
  ├── DB (notifications, UNIQUE event_id — idempotent)
  ├── Supabase Realtime → UI
  └── WhatsApp owner alert
```

### Utilitarios de IA
- **`lib/ai/utils/date-normalize.ts`**: Normalización determinista de fechas/horas. Sin LLM. Cubierto por 26 tests unitarios.
- **`lib/ai/orchestrator/decision-engine.ts`**: Exporta `buildConfirmationSummary()` para resumen estructurado pre-acción.

---

## 3. Pipeline de Notificaciones (Unificado)

Desde 2026-04-18, existe un **único pipeline** para todas las notificaciones de booking:

| Origen | Mecanismo |
|--------|-----------|
| Web (Dashboard AI) | `emitBookingEvent()` → `NotificationService` |
| WhatsApp agent | `emitBookingEvent()` → `NotificationService` |

**Eliminado**: sistema paralelo legacy (`createInternalNotification` + `sendWhatsAppMessage` directo en `process-whatsapp/notifications.ts`).

**Idempotencia garantizada**: `UNIQUE(event_id)` en tabla `notifications`. Reintentos de QStash o errores de red no generan duplicados.

---

## 4. Monitoreo y Hardening

- **Observabilidad**:
  - **Sentry**: Rastreo de excepciones críticas en producción.
  - **Axiom**: Logs estructurados para auditoría y depuración de alto volumen.
- **Seguridad**:
  - **RLS (Row Level Security)**: Políticas optimizadas en Supabase — aislamiento total entre negocios.
  - **Guardrails de IA**: 4 guards en tiempo de ejecución en `ExecutionEngine` previenen alucinaciones del LLM.
- **Calidad**:
  - **Vitest**: Suite de pruebas unitarias e integración (orquestador de IA, repositorios, casos de uso).
  - **Playwright**: Suite de pruebas E2E para flujos críticos de usuario.

---

## 5. Estructura de Módulos de IA

```
lib/ai/
├── orchestrator/
│   ├── ai-orchestrator.ts          # Facade pública
│   ├── decision-engine.ts          # analyze() → Decision + normalización + guards
│   ├── execution-engine.ts         # ReAct loop + 4 guardrails de hardening
│   ├── strategy.ts                 # RBAC: InternalStrategy / ExternalStrategy
│   ├── LlmBridge.ts               # Adapter → GroqProvider
│   ├── RedisStateManager.ts        # Persistencia de estado
│   └── tool-adapter/
│       └── RealToolExecutor.ts     # 7 tools → UseCases (salida estructurada)
└── utils/
    └── date-normalize.ts           # Normalización determinista fecha/hora (sin LLM)
```

---

*Cronix — Vibe + Solidez + Seguridad + Escalabilidad*
