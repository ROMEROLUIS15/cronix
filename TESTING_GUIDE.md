# 🧪 CRONIX Testing Guide & Audit

**Fecha**: 2026-04-19  
**Estado**: ✅ BUENA COBERTURA PERO CON GAPS CRÍTICOS  
**Total Tests**: 71 archivos · ~750 test cases

---

## 📊 RESUMEN EJECUTIVO

| Aspecto | Estado | Detalle |
|---|---|---|
| **Unit Tests** | ✅ EXCELENTE | 45+ tests con mocks claros, arquitectura de builders |
| **Integration Tests** | ⚠️ PARCIAL | 1 suite real (ai-booking), falta cobertura de repos |
| **API Route Tests** | ❌ CRÍTICO | voice, passkey, admin routes SIN tests |
| **E2E Tests** | ✅ BUENO | 6 suites Playwright, smoke tests presentes |
| **Cobertura General** | ⚠️ 65% | Lógica de dominio cubierta, rutas sin protección |

---

## 1️⃣ ESTADO ACTUAL DE TESTS

### ✅ QUÉ ESTÁ BIEN HECHO

#### 1.1 Tests de Dominio (Domain Layer)
```
__tests__/domain/use-cases/
├── CreateAppointmentUseCase.test.ts    ⭐⭐⭐⭐⭐ (7 casos)
├── CancelAppointmentUseCase.test.ts    ⭐⭐⭐⭐
├── GetAppointmentsByDateUseCase.test.ts ⭐⭐⭐⭐
├── GetAvailableSlotsUseCase.test.ts    ⭐⭐⭐⭐⭐ (edge cases)
├── RescheduleAppointmentUseCase.test.ts ⭐⭐⭐⭐
├── CreateClientUseCase.test.ts         ⭐⭐⭐⭐
├── GetClientsUseCase.test.ts           ⭐⭐⭐⭐
└── RegisterPaymentUseCase.test.ts      ⭐⭐⭐⭐
```

**Calidad**: 9/10
- ✅ Test builders bien definidos (makeQueryRepo, makeCommandRepo)
- ✅ Mocks limpios usando `vi.fn()`
- ✅ Assertions específicas (no solo truthy/falsy)
- ✅ Edge cases cubiertos (conflictos, errores de DB, datos nulos)
- ✅ Sigue patrón AAA (Arrange → Act → Assert)
- ✅ Nombres descriptivos de tests

**Ejemplo**:
```typescript
// CreateAppointmentUseCase.test.ts:36-45
it('returns appointment id and status on success', async () => {
  const uc = new CreateAppointmentUseCase(makeQueryRepo(), makeCommandRepo())
  const result = await uc.execute({ businessId: 'biz-1', ... })
  
  expect(result.error).toBeNull()
  expect(result.data?.id).toBe('appt-uuid')
  expect(result.data?.status).toBe('pending')
})
```

#### 1.2 Tests de Repositorio (Infrastructure Layer)
```
lib/repositories/__tests__/
├── SupabaseAppointmentRepository.test.ts   ✅
├── SupabaseUserRepository.test.ts          ✅
├── SupabaseClientRepository.test.ts        ✅
├── SupabaseFinanceRepository.test.ts       ✅
├── SupabaseServiceRepository.test.ts       ✅
├── SupabaseBusinessRepository.test.ts      ✅
├── SupabaseNotificationRepository.test.ts  ✅
└── SupabaseReminderRepository.test.ts      ✅
```

**Calidad**: 7/10
- ✅ Todos tienen mocks de Supabase
- ✅ Cubren happy path y error cases
- ❌ **PROBLEMA**: Algunos tests usa `console.error` en assertions (anti-pattern)
- ❌ **PROBLEMA**: No hay mocks de integración real (solo function mocks)

**Ejemplo de PROBLEMA**:
```typescript
// SupabaseAppointmentRepository.test.ts:47-50
it('returns ok when successfully updated', async () => {
  mockSupabase.from.mockReturnValue(mockSupabaseResponse(null, null))
  const result = await repository.updateStatus('apt_1', 'confirmed', 'biz_1')
  
  if (isFail(result)) {
    console.error('Test failed with error:', result.error)  // ❌ ANTI-PATRÓN
  }
  expect(isOk(result)).toBe(true)
})
```

**Debería ser**:
```typescript
it('returns ok when successfully updated', async () => {
  const result = await repository.updateStatus('apt_1', 'confirmed', 'biz_1')
  
  expect(result).not.toHaveProperty('error') // O mejor:
  expect(isOk(result)).toBe(true)
})
```

#### 1.3 Tests de AI/Orchestrator
```
__tests__/ai/orchestrator/
├── ai-orchestrator.test.ts          ⭐⭐⭐⭐ (8 casos)
├── decision-engine.test.ts          ⭐⭐⭐⭐⭐ (15+ casos)
├── decision-engine-hardening.test.ts ⭐⭐⭐⭐⭐ (edge cases)
├── execution-engine.test.ts         ⭐⭐⭐⭐
└── real-tool-executor.test.ts       ⭐⭐⭐⭐
```

**Calidad**: 8/10
- ✅ Coverage completo de decision paths
- ✅ Rejection, immediate, y LLM paths probados
- ✅ Multi-turn conversation testing
- ✅ Edge cases: max turns, state transitions
- ❌ Falta test de integración END-TO-END (orquestador → DB)

#### 1.4 Tests de Validaciones & Schemas
```
__tests__/validations/
├── appointment.schema.test.ts   ✅ (5 casos)
├── auth.schema.test.ts          ✅ (4 casos)
├── client.schema.test.ts        ✅ (3 casos)
├── finance.schema.test.ts       ✅ (2 casos)
├── service.schema.test.ts       ✅ (2 casos)
└── settings.schema.test.ts      ✅ (3 casos)
```

**Calidad**: 8/10
- ✅ Cubren happy path y validaciones
- ✅ Usan Zod correctamente
- ✅ Prueban transformaciones de datos

#### 1.5 Tests de E2E (Playwright)
```
tests/e2e/
├── smoke.spec.ts                 ✅ (navegación básica)
├── appointment-booking.spec.ts   ✅ (flow completo)
├── calendar-visual.spec.ts       ✅ (UI visual)
├── client-management.spec.ts     ✅ (CRUD clientes)
├── dashboard-navigation.spec.ts  ✅ (rutas)
└── tenant-branding.spec.ts       ✅ (multi-tenant)
```

**Calidad**: 7/10
- ✅ Coverage de journeys principales
- ✅ Visual regression checks
- ✅ Multi-browser support (si está configurado)
- ⚠️ Falta paralelización (tests secuenciales)

#### 1.6 Tests de Integración
```
tests/integration/
└── ai-booking.test.ts   ⭐⭐⭐⭐⭐ (3 casos, DB REAL)
```

**Calidad**: 9/10
- ✅ Usa Supabase service-role real
- ✅ Setup/teardown correcto (beforeAll/afterEach)
- ✅ Limpieza de datos
- ✅ Valida persistencia REAL
- ✅ Detección de conflictos

---

### ❌ QUÉ ESTÁ FALTANDO

#### 2.1 **CRÍTICO: API Routes sin tests**

```
app/api/
├── assistant/
│   ├── voice/route.ts        ❌ CRÍTICO — 182 líneas, SIN TEST
│   ├── proactive/route.ts    ❌ SIN TEST
│   ├── token/route.ts        ❌ SIN TEST
│   └── tts/route.ts          ❌ SIN TEST
├── admin/
│   └── users/[id]/status/route.ts  ❌ SIN TEST
├── passkey/
│   ├── authenticate/options/route.ts   ❌ SIN TEST
│   ├── authenticate/verify/route.ts    ❌ SIN TEST
│   ├── register/options/route.ts       ❌ SIN TEST
│   └── register/verify/route.ts        ❌ SIN TEST
└── health/route.ts           ✅ TIENE TEST
```

**Impacto**: La ruta `/api/assistant/voice` es el corazón del sistema — sin tests unitarios/de integración, no hay garantía de que funcione.

#### 2.2 **FALTA: Tests de Integración de Repositorios**

Hoy solo hay `ai-booking.test.ts`. Faltan:
```
tests/integration/
├── appointment-repository.test.ts      ❌ findConflicts, reschedule
├── client-repository.test.ts           ❌ CRUD real
├── finance-repository.test.ts          ❌ registerPayment, getRevenue
├── notification-repository.test.ts     ❌ send, markRead
└── reminder-repository.test.ts         ❌ upsert, cancelByAppointment
```

#### 2.3 **FALTA: Tests de Boundary/Security**

```
❌ CSRF token validation
❌ Rate limiting (Redis)
❌ Token quota checking
❌ Deduplication (request-id)
❌ Role-based authorization (RBAC)
❌ Multi-tenant isolation (RLS at API level)
```

#### 2.4 **FALTA: Tests de Acción/Server Actions**

```
lib/actions/ o app/actions/
└── Casi todos los archivos SIN integración tests
   ├── auth.ts               ⚠️ Tiene tests unitarios
   ├── forgot-password.ts    ⚠️ Tiene tests unitarios
   ├── csrf-action.ts        ⚠️ Tiene tests unitarios
   ├── reset-password.ts     ⚠️ Tiene tests unitarios
   └── Otros: SIN tests o solo mocks
```

---

## 2️⃣ CONFIGURACIÓN ACTUAL DE TESTS

### Test Setup

```bash
# Package.json scripts
"test": "vitest run"                              # Unit/Integration
"test:watch": "vitest"                           # Watch mode
"test:ui": "vitest --ui"                         # UI dashboard
"test:coverage": "vitest run --coverage"         # Coverage report
"test:integration": "vitest run --config vitest.integration.config.ts"  # Integration
"test:e2e": "playwright test"                    # Playwright
"test:e2e:smoke": "playwright test --project=smoke"  # Smoke only
```

### Test Environments

**vitest.config.ts**:
```typescript
environment: 'jsdom'          // Unit tests — DOM available
exclude: [
  '**/tests/e2e/**',          // Playwright (separate)
  '**/*.spec.ts',             // .spec.ts = Playwright
  '**/tests/integration/**',  // Integration (separate config)
  '__tests__/components/**',  // Component tests (separate)
]
```

**vitest.integration.config.ts**:
```typescript
environment: 'node'           // Real Node.js (no DOM)
include: ['tests/integration/**/*.test.ts']
testTimeout: 30_000           // 30s for DB queries
```

### Test Runners

- **Vitest**: Unit + Integration
- **Playwright**: E2E browser tests
- **Coverage**: Via vitest --coverage

---

## 3️⃣ CÓMO DEBERÍA SER: ESTRUCTURA DE TESTS IDEAL

### Pirámide de Tests (Ideal)

```
            🔺 E2E (10%)
           /   \
          / E2E Tests
         /___________\
        
        🔻 Integration (20%)
       /               \
      / Real DB Tests  /
     /_________________/
    
    🔼 Unit (70%)
   /               \
  / Mocks, Builders /
 /___________________\

```

**Nuestro Estado Actual**:
```
        🔺 E2E (15%) ✅
       /   \
      / 6 suites
     /___________\
    
    🔻 Integration (8%) ❌ BAJO
   /               \
  / 1 suite real   /
 /_________________/

🔼 Unit (77%) ⚠️ ALTO
/               \
/ 45+ tests    /
/___________________\
```

**Problema**: Demasiados unit tests, muy pocos integration tests reales.

### Estructura Recomendada para Tests

```
Proyecto/
├── app/
│   ├── api/
│   │   ├── assistant/
│   │   │   ├── voice/
│   │   │   │   ├── route.ts
│   │   │   │   └── __tests__/
│   │   │   │       ├── voice.integration.test.ts    (⬅️ FALTA)
│   │   │   │       └── voice.unit.test.ts           (⬅️ FALTA)
│   │   │   └── ...
│   │   └── passkey/
│   │       ├── register/
│   │       │   └── __tests__/
│   │       │       └── register.integration.test.ts (⬅️ FALTA)
│   │       └── ...
│   └── ...
│
├── lib/
│   ├── domain/
│   │   ├── use-cases/
│   │   │   ├── CreateAppointmentUseCase.ts
│   │   │   └── __tests__/
│   │   │       └── CreateAppointmentUseCase.test.ts ✅
│   │   └── ...
│   ├── repositories/
│   │   ├── SupabaseAppointmentRepository.ts
│   │   └── __tests__/
│   │       └── SupabaseAppointmentRepository.test.ts ✅
│   └── ...
│
├── __tests__/ (tests de nivel proyecto)
│   ├── ai/
│   ├── domain/
│   ├── validations/
│   └── ...
│
└── tests/
    ├── integration/   (⬅️ EXTENDER AQUÍ)
    │   ├── ai-booking.test.ts ✅
    │   ├── repositories.test.ts (⬅️ FALTA)
    │   └── api-routes.test.ts (⬅️ FALTA)
    └── e2e/
        ├── appointment-booking.spec.ts ✅
        └── ...
```

---

## 4️⃣ EVALUACIÓN DE CALIDAD POR CATEGORÍA

### Unit Tests (Domain & Use Cases)

```
CRITERIOS                                   ESTADO
─────────────────────────────────────────────────────
Nombres descriptivos                        ✅ EXCELENTE
Patrón AAA (Arrange-Act-Assert)             ✅ EXCELENTE
Test builders (factories)                   ✅ EXCELENTE
Mocks limpios (vi.fn())                    ✅ EXCELENTE
Edge cases cubiertos                        ✅ EXCELENTE
Sin console.log/console.error en tests      ❌ MALO (algunos repos)
Assertions específicas (no solo .toBe)      ✅ BUENO
Cobertura de ramas (branches)               ⚠️ DESCONOCIDA (sin reporte)
─────────────────────────────────────────────────────
CALIFICACIÓN: 8.5/10
```

### Integration Tests

```
CRITERIOS                                   ESTADO
─────────────────────────────────────────────────────
Tests con DB real                           ⚠️ 1/8 repos
Limpieza de datos (afterEach)               ✅ BUENA (ai-booking.ts)
Env guards (skip si no hay credenciales)    ✅ BUENO
Timeout configurado (30s)                   ✅ CORRECTO
Cobertura de error cases                    ❌ SOLO happy path
─────────────────────────────────────────────────────
CALIFICACIÓN: 5/10
```

### API Route Tests

```
CRITERIOS                                   ESTADO
─────────────────────────────────────────────────────
Rutas con tests                             ❌ 2/11 (18%)
Mocking de dependencias                     ⚠️ N/A (sin tests)
Rate limiting tested                        ❌ NO
Auth/Token validation tested                ❌ NO
Error handling tested                       ❌ NO
─────────────────────────────────────────────────────
CALIFICACIÓN: 1/10
```

### E2E Tests

```
CRITERIOS                                   ESTADO
─────────────────────────────────────────────────────
Happy path cubierto                         ✅ SÍ
Error scenarios                             ⚠️ ALGUNOS
Visual regression                           ✅ SÍ
Performance metrics                         ❌ NO
Smoke tests                                 ✅ SÍ (definidas)
─────────────────────────────────────────────────────
CALIFICACIÓN: 7/10
```

---

## 5️⃣ CÓMO IMPLEMENTAR TESTS CORRECTAMENTE EN CRONIX

### 5.1 Tests Unitarios (Domain Layer)

**CORRECTO** ✅:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { CreateAppointmentUseCase } from '@/lib/domain/use-cases/CreateAppointmentUseCase'

// 1️⃣ Test builders
function makeQueryRepo(overrides = {}): IAppointmentQueryRepository {
  return {
    findConflicts: vi.fn().mockResolvedValue({ data: [], error: null }),
    ...overrides,
  } as any
}

// 2️⃣ Tests con AAA
describe('CreateAppointmentUseCase', () => {
  it('should create appointment when no conflicts', async () => {
    // Arrange
    const queryRepo = makeQueryRepo()
    const commandRepo = makeCommandRepo()
    const useCase = new CreateAppointmentUseCase(queryRepo, commandRepo)
    
    // Act
    const result = await useCase.execute({
      businessId: 'biz-1',
      clientId: 'cli-1',
      serviceIds: ['svc-1'],
      startAt: '2026-04-18T10:00:00Z',
      endAt: '2026-04-18T10:30:00Z',
    })
    
    // Assert
    expect(result.error).toBeNull()
    expect(result.data?.id).toBeDefined()
    expect(commandRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ business_id: 'biz-1' })
    )
  })
})
```

**INCORRECTO** ❌:
```typescript
// ❌ Sin mocks, calls reales
const useCase = new CreateAppointmentUseCase(realRepo)

// ❌ Nombres genéricos
it('test1', async () => { ... })

// ❌ Assertions débiles
expect(result).toBeTruthy()

// ❌ Anti-patrón: console en tests
if (error) console.log('Error:', error)
```

### 5.2 Tests de Integración (Database Real)

**CORRECTO** ✅:
```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const hasDB = !!process.env.SUPABASE_URL
const describeIntegration = hasDB ? describe : describe.skip

describeIntegration('AppointmentRepository Integration', () => {
  let supabase: any
  const createdIds: string[] = []
  
  // Setup: Load real client
  beforeAll(async () => {
    supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  })
  
  // Cleanup: Always delete test data
  afterEach(async () => {
    if (createdIds.length === 0) return
    await supabase.from('appointments').delete().in('id', createdIds)
    createdIds.length = 0
  })
  
  // Test: Create and verify
  it('should persist appointment to database', async () => {
    const { getRepos } = await import('@/lib/repositories')
    const repos = getRepos(supabase)
    
    const result = await repos.appointments.create({
      business_id: 'test-biz',
      client_id: 'test-cli',
      service_ids: ['test-svc'],
      start_at: new Date().toISOString(),
      end_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'pending',
    })
    
    expect(result.error).toBeNull()
    expect(result.data?.id).toBeDefined()
    createdIds.push(result.data!.id)
    
    // Verify in DB (not just return value)
    const { data: stored } = await supabase
      .from('appointments')
      .select('*')
      .eq('id', result.data!.id)
      .single()
    
    expect(stored?.status).toBe('pending')
  })
})
```

**INCORRECTO** ❌:
```typescript
// ❌ No limpia datos
it('test', async () => {
  await repos.appointments.create({ ... })
  // ❌ No hay cleanup — datos acumulan en BD
})

// ❌ Solo verifica retorno, no DB
expect(result.data?.id).toBeDefined() // Not enough!

// ❌ Sin env guards
const supabase = createClient(...) // Falla en CI
```

### 5.3 Tests de API Routes

**CORRECTO** ✅:
```typescript
// __tests__/api/assistant/voice.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/assistant/voice/route'
import { NextRequest } from 'next/server'

describe('POST /api/assistant/voice', () => {
  let mockSupabase: any
  let mockRequest: Partial<NextRequest>
  
  beforeEach(() => {
    mockSupabase = createMockSupabase()
    mockRequest = {
      headers: new Headers({
        'content-type': 'application/json',
        'x-request-id': 'req-1',
      }),
      json: vi.fn().mockResolvedValue({
        text: 'Agendar corte de cabello',
        timezone: 'America/Bogota',
        history: [],
      }),
    }
  })
  
  it('should process voice request and return response', async () => {
    // Mock dependencies
    vi.mock('@/lib/supabase/server', () => ({
      createAdminClient: () => mockSupabase,
    }))
    
    // Call handler
    const response = await POST(
      mockRequest as NextRequest,
      {} as any,
      mockSupabase,
      { id: 'user-1', role: 'owner' }
    )
    
    // Assert
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.text).toBeDefined()
  })
  
  it('should reject when rate limit exceeded', async () => {
    // Mock rate limiter to reject
    vi.mock('@/lib/rate-limit/redis-rate-limiter', () => ({
      redisRateLimit: vi.fn().mockResolvedValue({ allowed: false, retryAfter: 30 }),
    }))
    
    const response = await POST(mockRequest as NextRequest, {}, mockSupabase, mockUser)
    
    expect(response.status).toBe(429)
  })
  
  it('should reject invalid payload by Zod shield', async () => {
    mockRequest.json = vi.fn().mockResolvedValue({
      text: 'x'.repeat(2001), // Exceeds max length
      timezone: 'invalid-tz',
    })
    
    const response = await POST(mockRequest as NextRequest, {}, mockSupabase, mockUser)
    
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('invalid')
  })
})
```

---

## 6️⃣ PLAN DE IMPLEMENTACIÓN

### Fase 1: Fixing Existing Tests (Inmediato)

**Tarea 1.1**: Remover `console.error` de repository tests
```bash
Files:
  - lib/repositories/__tests__/SupabaseAppointmentRepository.test.ts:48
  - lib/repositories/__tests__/SupabaseAppointmentRepository.test.ts:79
  - ... (buscar todos)

Action: Replace console.error with proper assertions
Time: 30 min
```

**Tarea 1.2**: Expandir suite de integración `ai-booking.test.ts`
```bash
Add:
  - Test para conflict detection (T2 está incompleto)
  - Test para multiple services
  - Test para timezone handling

Time: 1-2 hours
```

### Fase 2: Critical API Routes Testing (1-2 días)

**Tarea 2.1**: Test para `/api/assistant/voice` (⭐ CRÍTICO)
```bash
Tests to add:
  1. Happy path: text input → response
  2. Audio input: Blob → transcribe → response
  3. Rate limiting: 429 when exceeded
  4. Token quota: 429 when exceeded
  5. Zod shield: 400 for invalid payload
  6. Missing auth: 401
  7. No business: 403
  8. Deduplication: 409 for duplicate request-id

Time: 4-6 hours
Location: __tests__/api/assistant/voice.test.ts (NEW)
Priority: ⭐⭐⭐ CRÍTICO
```

**Tarea 2.2**: Test para `/api/passkey/*` routes
```bash
Tests to add:
  - register/options: Challenge generation
  - register/verify: Credential creation
  - authenticate/options: Challenge + allowCredentials
  - authenticate/verify: Signature verification

Time: 3-4 hours
Location: __tests__/api/passkey/ (NEW)
```

**Tarea 2.3**: Test para `/api/admin/users/*/status`
```bash
Tests to add:
  - Authorization check (admin only)
  - Status update validation
  - Invalid status rejection

Time: 1-2 hours
Location: __tests__/api/admin/ (NEW)
```

### Fase 3: Integration Tests for Data Layer (3-4 días)

**Tarea 3.1**: Repository integration tests
```bash
Add files:
  - tests/integration/repositories-appointments.test.ts
  - tests/integration/repositories-clients.test.ts
  - tests/integration/repositories-finances.test.ts
  - tests/integration/repositories-notifications.test.ts
  - tests/integration/repositories-reminders.test.ts

Each: 3-5 test cases covering CRUD, error cases, data integrity

Time: 8-10 hours
Priority: ⭐⭐⭐ NECESARIO
```

**Tarea 3.2**: End-to-end AI workflow
```bash
Add test:
  - tests/integration/ai-workflow-e2e.test.ts
  
Flow:
  1. Input: User text with context
  2. Process: Orchestrator decides → executes
  3. Verify: Data persisted in DB (not mocked)
  4. Cleanup: Delete created appointments

Time: 4-6 hours
```

### Fase 4: Security & Boundary Testing (1-2 días)

**Tarea 4.1**: CSRF, Rate Limiting, RLS
```bash
__tests__/security/
  ├── csrf.integration.test.ts
  ├── rate-limit.integration.test.ts
  └── rls.integration.test.ts

Time: 4-6 hours
```

### Timeline Recomendado

```
Semana 1 (Inmediato):
  Day 1: Fase 1 (fixing) + Tarea 2.1 (voice route)
  Day 2: Tarea 2.2 + 2.3 (passkey, admin)
  Day 3: Tarea 3.1 (repositories)

Semana 2:
  Day 1: Tarea 3.2 (E2E workflow)
  Day 2: Tarea 4.1 (security)
  Day 3: Coverage reporting + cleanup

Total: ~60 horas en 10 días
```

---

## 7️⃣ CÓMO EJECUTAR TESTS

### Unit Tests
```bash
# Run all unit tests
npm run test

# Watch mode (re-run on file change)
npm run test:watch

# UI dashboard
npm run test:ui

# With coverage report
npm run test:coverage
```

### Integration Tests
```bash
# Requires SUPABASE_* env vars in .env.local
npm run test:integration
```

### E2E Tests
```bash
# Run all Playwright tests
npm run test:e2e

# Smoke tests only
npm run test:e2e:smoke

# Watch mode
npx playwright test --watch
```

### Full Test Suite
```bash
# All tests (unit + integration + e2e)
npm run test && npm run test:integration && npm run test:e2e
```

---

## 8️⃣ CHECKLIST PARA CÓDIGO NUEVO

Antes de crear un PR, verifica:

### Para Unit Tests
- [ ] Cada use-case tiene test builder (makeQueryRepo, makeCommandRepo)
- [ ] Naming: test describe should start with class name
- [ ] Mocks: usa `vi.fn()`, no mocks manuales complejos
- [ ] Assertions: específicas (`expect(x).toBe(y)` no `expect(x).toBeTruthy()`)
- [ ] Edge cases: error paths, null handling, boundary conditions
- [ ] NO console.log/console.error en test code
- [ ] Estructura: Arrange → Act → Assert

### Para Integration Tests
- [ ] Datos creados se limpian en `afterEach`
- [ ] Env guards: `describe.skip` si no hay credenciales
- [ ] Timeout: 30_000ms para DB queries
- [ ] Verifica BD real, no solo return values
- [ ] Nombres de test: describe qué se verifica

### Para API Route Tests
- [ ] Mocking de dependencias (Supabase, providers, rate limiters)
- [ ] Happy path + error cases
- [ ] Authorization tested
- [ ] Validation (Zod) tested
- [ ] Rate limiting tested
- [ ] Error responses (400, 401, 403, 429, 500)

### Para E2E Tests
- [ ] Navigates happy path
- [ ] Waits for network (not just selectors)
- [ ] Verifies DB state if possible
- [ ] Cleans up test data
- [ ] Cross-browser if relevant

---

## 9️⃣ ESTÁNDARES DE CALIDAD

### Coverage Goals

| Layer | Target | Current |
|---|---|---|
| Domain (use-cases) | 90% | ~85% ⚠️ |
| Repositories | 80% | ~60% ❌ |
| API Routes | 80% | ~10% ❌ |
| Services | 70% | ~40% ⚠️ |
| **Overall** | **75%** | **~50%** ❌ |

### Code Quality Rules

1. **No `any` in tests** — use proper typing with test builders
2. **No mocks in production code** — mocks only in test files
3. **Naming must be descriptive** — `testHappyPath` not `test1`
4. **Assertions must be specific** — `expect(x).toBe(y)` not `expect(x).toBeTruthy()`
5. **Database tests must clean up** — use `afterEach(() => deleteTestData())`
6. **CI must pass** — tests run on every push (via pre-push hook)

---

## 🔟 PRÓXIMOS PASOS

**INMEDIATO (Hoy)**:
1. [ ] Leer este documento
2. [ ] Ejecutar `npm run test` — verifica que pasen todos
3. [ ] Ejecutar `npm run test:coverage` — revisa qué falta

**ESTA SEMANA**:
1. [ ] Crear `__tests__/api/assistant/voice.test.ts` (⭐ crítico)
2. [ ] Remover `console.error` de repository tests
3. [ ] Expandir `tests/integration/ai-booking.test.ts`

**PRÓXIMAS 2 SEMANAS**:
1. [ ] Tests para passkey & admin routes
2. [ ] Integration tests para cada repository
3. [ ] Coverage report en CI

---

## Contacto & Referencias

- **Testing Framework**: [Vitest Docs](https://vitest.dev)
- **E2E Testing**: [Playwright Docs](https://playwright.dev)
- **Mocking**: [Vitest `vi` module](https://vitest.dev/api/vi.html)
- **Supabase Testing**: [Supabase JS Docs](https://supabase.com/docs/reference/javascript)

---

**Última actualización**: 2026-04-19  
**Próxima revisión**: Luego de implementar tests de voice API
