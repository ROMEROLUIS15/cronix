# TESTING.md — Cronix Test Guide

> Cobertura de producción real. No tests superficiales.
> Última actualización: 2026-05-03

---

## Índice

1. [Filosofía de Testing](#1-filosofía)
2. [Cómo Correr Tests](#2-cómo-correr-tests)
3. [Tipos de Tests](#3-tipos-de-tests)
4. [Cobertura Esperada](#4-cobertura-esperada)
5. [Escenarios Críticos](#5-escenarios-críticos)
6. [Mocking Strategy](#6-mocking-strategy)
7. [Fallos Encontrados y Fixes](#7-fallos-encontrados-y-fixes)

---

## 1. Filosofía

**Regla principal**: si un test puede pasar con lógica incorrecta, no es útil.

Cada test en este proyecto tiene una razón de existir:
- Verifica una invariante de seguridad, o
- Protege contra una regresión específica ya vista, o
- Documenta un comportamiento no obvio del sistema

Los tests "happy path" sin adversariales son documentación, no garantías.

---

## 2. Cómo Correr Tests

```bash
# Todos los tests (unit + integración)
npm test

# Watch mode (desarrollo)
npm run test:watch

# Con UI visual
npm run test:ui

# Con cobertura
npm run test:coverage

# Solo el AI core
npx vitest run lib/ai/core/__tests__/

# Solo tests de integración
npx vitest run lib/ai/adapters/__tests__/

# Test específico
npx vitest run lib/ai/core/__tests__/adversarial.test.ts

# E2E (requiere servidor corriendo)
npm run test:e2e
```

---

## 3. Tipos de Tests

### 3.1 Unit Tests — `lib/ai/core/__tests__/`

Tests de unidades individuales con mocks en la capa de repo.

| Archivo | Qué cubre | Tests |
|---------|-----------|-------|
| `BookingEngine.test.ts` | Todos los tools, flujos normales + DB errors | ~60 |
| `adversarial.test.ts` | Inputs inválidos, cross-tenant, degradación de infra | ~82 |
| `TenantEnforcer.test.ts` | Verificación de tenant, phantom type invariants | ~14 |
| `ClientResolver.test.ts` | Fuzzy match, byPhone, byId, cross-tenant scoping | ~18 |
| `ServiceResolver.test.ts` | 4 estrategias de match, ambigüedad, scoping | ~12 |
| `timezone.test.ts` | normalizeTime, localToUTC, addMinutesToISO | ~20 |
| `tool-schemas.test.ts` | Validación Zod de todos los schemas | ~40 |
| `fuzzy-match.test.ts` | Levenshtein, normalización, threshold | ~15 |

**Invariante: unit tests no tocan red, DB, ni Redis.**

### 3.2 Integration Tests — `lib/ai/adapters/__tests__/`

Tests del pipeline completo con repos mockeados al nivel de Supabase.

| Archivo | Qué cubre | Tests |
|---------|-----------|-------|
| `DashboardBookingAdapter.test.ts` | Adapter ↔ TenantEnforcer ↔ ExecResult | ~8 |
| `integration-flow.test.ts` | Pipeline end-to-end: adapter → engine → usecases → repos | ~15 |

**Estos tests son los más importantes para verificar que las capas componen correctamente.**

### 3.3 Repository Tests — `lib/repositories/__tests__/`

Tests de los repositorios de Supabase con cliente mockeado.

| Archivo | Qué cubre |
|---------|-----------|
| `appointments.repo.test.ts` | CRUD básico + updateStatus scoping |
| `SupabaseAppointmentRepository.test.ts` | updateStatus con business_id |
| `SupabaseClientRepository.test.ts` | findActiveForAI scoping |
| `SupabaseServiceRepository.test.ts` | getActive scoping |
| `SupabaseFinanceRepository.test.ts` | idempotency_key en transacciones |

### 3.4 Domain / UseCase Tests — `__tests__/domain/`

Tests de los use cases con repositorios mockeados.

```
__tests__/domain/use-cases/
  CancelAppointmentUseCase.test.ts
```

### 3.5 E2E Tests — `tests/e2e/`

Tests de Playwright que simulan el navegador real. Requieren:
1. Servidor corriendo: `npm run dev`
2. DB de test: `npm run e2e:setup`
3. Correr: `npm run test:e2e`

---

## 4. Cobertura Esperada

```
Módulo                          | Objetivo | Estado
--------------------------------|----------|-------
lib/ai/core/booking/            |   >90%   |  ✓
lib/ai/core/security/           |  100%    |  ✓
lib/ai/core/contracts/          |   >85%   |  ✓
lib/ai/core/utils/              |   >90%   |  ✓
lib/ai/adapters/dashboard/      |   >85%   |  ✓
lib/repositories/               |   >70%   |  ✓
lib/domain/use-cases/           |   >75%   |  ✓
```

Thresholds configurados en `vitest.config.ts`:
- Lines: 70%
- Functions: 70%
- Branches: 65%
- Statements: 70%

---

## 5. Escenarios Críticos

### 5.1 Seguridad Multitenant (MUST NEVER FAIL)

```
TEST: TenantEnforcer con businessId incorrecto → throws UNAUTHORIZED
TEST: BookingEngine.cancelAppointment llama getForEdit(appointmentId, ctx.businessId)
TEST: BookingEngine.createAppointment llama findActiveForAI(ctx.businessId)
TEST: DashboardBookingAdapter.execute verifica tenant ANTES de despachar
TEST: updateStatus recibe businessId como tercer argumento
```

**Si cualquiera de estos falla en CI, el pipeline se bloquea.**

### 5.2 "Never Throws" Contract

Todos los métodos públicos del sistema deben retornar un tipo de resultado, nunca lanzar.

```
TEST: BookingEngine.dispatch() con repo que lanza → retorna ToolResult
TEST: DashboardBookingAdapter.execute() con TenantEnforcer que lanza → retorna ExecResult
TEST: cancelAppointment con DB down → retorna DB_ERROR
```

### 5.3 Degradación de Infraestructura

```
TEST: Redis (cache) caído → booking se completa (cache.invalidate falla silenciosamente)
TEST: findConflicts retorna error → booking falla (no crea cita sin verificar)
TEST: DB down en todos los repos → todos los tools retornan ToolResult con mensaje
```

### 5.4 Inputs Adversariales del LLM

```
TEST: time = "25:99"       → INVALID_ARGS
TEST: time = "3 PM"        → INVALID_ARGS (schema requiere HH:mm)
TEST: date = "2026-13-01"  → INVALID_ARGS
TEST: client_name = null   → INVALID_ARGS
TEST: args = null           → INVALID_ARGS
TEST: args = [1, 2, 3]     → INVALID_ARGS
TEST: unknown tool name    → INVALID_ARGS
```

---

## 6. Mocking Strategy

### Principio: mock en la frontera, no en el interior

```
✓ Mockear: IClientRepository, IServiceRepository, IAppointmentRepository
✓ Mockear: TenantEnforcer.verify() (evita llamadas a Supabase admin)
✓ Mockear: cache (evita dependencia de Redis en unit tests)
✓ Mockear: logger (evita output en tests)

✗ No mockear: BookingEngine (en integration tests)
✗ No mockear: Zod schemas
✗ No mockear: timezone utilities
✗ No mockear: fuzzy-match
```

### Fixtures reutilizables

Cada archivo de test define su propio `makeRepos()` que retorna mocks tipados.
Los fixtures son inmutables por test usando `beforeEach` + `vi.clearAllMocks()`.

### Mock de Supabase admin (TenantEnforcer)

```ts
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table) => ({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      single: mockSingle,
    })),
  })),
}))
```

---

## 7. Fallos Encontrados y Fixes

### Bug #1: Ausencia de observabilidad en DashboardBookingAdapter

**Encontrado**: El adapter no tenía ningún log. Si una request fallaba silenciosamente (e.g., TenantEnforcer rechazaba), no había traza en producción.

**Fix aplicado**: Se agregó `logger.info/warn` al inicio y al final de `execute()`:
- `ADAPTER / Tool request received` — con `toolName`, `businessId`, `userId`
- `ADAPTER / Tool succeeded` — con `durationMs`
- `ADAPTER / Tool failed` — con `errorCode`, `durationMs`
- `ADAPTER / Tenant verification failed` — con `error`, `durationMs`

**Archivo**: `lib/ai/adapters/dashboard/DashboardBookingAdapter.ts`

### Bug #2: `findConflicts` error podría crear citas sin verificar disponibilidad

**Encontrado**: En `CreateAppointmentUseCase`, si `findConflicts` retorna error (Redis down, timeout), el use case retorna `fail()`. Correcto. Pero no había test explícito verificando que `create` NO se llama en ese caso.

**Status**: No era un bug de producción (el UseCase ya manejaba esto correctamente), pero faltaba el test de regresión.

**Test agregado**: `C6: findConflicts error → booking fails safely (no partial write)` en `adversarial.test.ts`.

### Bug #3: Inputs inesperados de LLM no testeados

**Encontrado**: No había tests para `dispatch(ctx, tool, null)`, `dispatch(ctx, tool, [])`, o `dispatch(ctx, tool, "string")`. En producción el LLM podría enviar cualquier cosa.

**Fix**: Se agregaron tests A7 en `adversarial.test.ts` que cubren `null`, `undefined`, `array`, y `string` como rawArgs.

### Bug #4: updateStatus sin businessId en el assert de ownership

**Encontrado** (en análisis): La llamada a `updateStatus(appointmentId, 'cancelled', businessId)` requería que el tercer parámetro (`businessId`) fuera siempre el del contexto. No había test de integración que verificara esto end-to-end.

**Test agregado**: `INT-15: updateStatus is called with correct businessId` en `integration-flow.test.ts`.

---

## Estado Final

```
Test Files:  82 passed
Tests:       1276 passed
Duration:    ~31s
```

Todos los tests corren sin red, sin DB real, sin Redis.
El pipeline de CI puede ejecutar la suite completa en frío.
