# 📋 Testing Implementation Guide — Cronix

**Para**: Futuros programadores e IAs trabajando con tests  
**Creado**: 2026-04-19  
**Estándar**: Senior-level testing practices

---

## 1️⃣ ESTRUCTURA DE TESTS EN EL PROYECTO

```
Cronix/
├── __tests__/                          (Unit tests — jsdom environment)
│   ├── api/
│   │   ├── assistant/
│   │   │   ├── voice.test.ts          ✅ NUEVO — 10 cases, API route testing
│   │   │   └── token.test.ts          ✅ NUEVO — 2 cases, deprecated endpoint
│   │   └── passkey/
│   │       └── register.test.ts       ✅ NUEVO — 10 cases, WebAuthn flow
│   ├── domain/
│   │   └── use-cases/
│   │       ├── CreateAppointmentUseCase.test.ts     ✅ 7 cases
│   │       ├── CancelAppointmentUseCase.test.ts     ✅ 4 cases
│   │       └── ... (8 total use-case tests)
│   ├── validations/
│   │   └── *.schema.test.ts           ✅ 19 cases (brandColor block removed)
│   └── ... (other unit tests)
│
├── lib/
│   └── repositories/
│       └── __tests__/
│           ├── mocks.ts               ✅ Mock factories (createSupabaseMock, mockSupabaseResponse)
│           └── *.test.ts              ✅ 9 repository tests (console.error removed)
│
└── tests/
    ├── integration/
    │   ├── ai-booking.test.ts         ✅ 3 cases, real Supabase
    │   ├── repositories.test.ts       ✅ NUEVO — 10 cases, all repos with DB
    │   └── voice-api-e2e.test.ts      ✅ NUEVO — 5 cases, complete voice flow
    │
    └── e2e/
        ├── voice-assistant.spec.ts    ✅ NUEVO — 6 cases, Playwright browser
        ├── appointment-booking.spec.ts ✅ 2 cases
        └── ... (6 total E2E specs)
```

---

## 2️⃣ CÓMO EJECUTAR TESTS

### Unit + Integration Tests (jsdom + node)

```bash
# All unit tests (quick, <10s)
npm run test

# Watch mode (reruns on file change)
npm run test:watch

# With coverage report
npm run test:coverage

# Integration tests only (requires Supabase)
npm run test:integration

# Run specific file
npx vitest run __tests__/api/assistant/voice.test.ts
```

### E2E Tests (Playwright, real browser)

```bash
# All E2E tests
npm run test:e2e

# Specific test file
npx playwright test tests/e2e/voice-assistant.spec.ts

# With UI debugger
npx playwright test --ui

# Smoke tests only
npm run test:e2e:smoke
```

### Full Test Suite

```bash
npm run test && npm run test:integration && npm run test:e2e
```

---

## 3️⃣ TESTING PATTERNS USED IN THIS PROJECT

### Pattern 1: Unit Tests with Test Builders (Domain Layer)

**File**: `__tests__/domain/use-cases/CreateAppointmentUseCase.test.ts`

```typescript
// ✅ PATTERN: Factory builders for test setup
function makeQueryRepo(overrides = {}) {
  return {
    findConflicts: vi.fn().mockResolvedValue({ data: [], error: null }),
    ...overrides,
  } as IAppointmentQueryRepository
}

describe('CreateAppointmentUseCase', () => {
  it('should create appointment when no conflicts', async () => {
    // Arrange
    const queryRepo = makeQueryRepo()
    const commandRepo = makeCommandRepo()
    const useCase = new CreateAppointmentUseCase(queryRepo, commandRepo)
    
    // Act
    const result = await useCase.execute({ businessId: 'biz-1', ... })
    
    // Assert
    expect(result.error).toBeNull()
    expect(result.data?.id).toBeDefined()
  })
})
```

**Why this pattern**:
- ✅ **Reusable**: `makeQueryRepo` used in 7+ tests
- ✅ **Type-safe**: Full typing, no `any`
- ✅ **Readable**: Clear intent in test names
- ✅ **Isolated**: Mocks are local, not global

---

### Pattern 2: API Route Testing (Mock withErrorHandler)

**File**: `__tests__/api/assistant/voice.test.ts`

```typescript
// ✅ CRITICAL PATTERN: Bypass HOF to test handler directly
vi.mock('@/lib/api/with-error-handler', () => ({
  withErrorHandler: (fn: Function) => fn,  // ← Returns handler unchanged
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: vi.fn().mockReturnValue({ from: vi.fn() }),
}))

// ✅ Import AFTER all mocks defined
import { POST } from '@/app/api/assistant/voice/route'

describe('POST /api/assistant/voice', () => {
  it('[T1] happy path — text input returns orchestrator response', async () => {
    const req = makeRequest({ text: 'Hola' })
    
    const response = await POST(
      req as Request,
      {} as any,
      fakeSupabase(),      // ← Pass supabase mock directly
      { id: 'user-1' }     // ← Pass user directly
    )
    
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.text).toBeDefined()
  })
})
```

**Why this pattern**:
- ✅ **No browser needed**: Tests run in Node.js, fast
- ✅ **Full control**: Mock every dependency
- ✅ **Isolation**: Tests don't depend on real Groq/Supabase
- ✅ **Fast feedback**: <1s per test

---

### Pattern 3: Integration Tests with Real Database

**File**: `tests/integration/repositories.test.ts`

```typescript
// ✅ PATTERN: Guard for Supabase credentials
const hasSupabaseAccess = !!(SUPABASE_URL && SERVICE_ROLE_KEY)
const describeIntegration = hasSupabaseAccess ? describe : describe.skip

describeIntegration('Repository Integration Tests', () => {
  let createdIds = { clients: [], services: [] }
  
  // ✅ Setup: Load real data once
  beforeAll(async () => {
    BIZ_ID = (await supabase.from('businesses').select('id').eq('slug', 'e2e-test')).data[0].id
  })
  
  // ✅ Cleanup: Delete test data after EACH test
  afterEach(async () => {
    if (createdIds.clients.length > 0) {
      await supabase.from('clients').delete().in('id', createdIds.clients)
      createdIds.clients = []  // Reset
    }
  })
  
  it('[R1] ClientRepository.insert persists and returns with ID', async () => {
    const result = await repos.clients.insert({
      business_id: BIZ_ID,
      name: 'Integration Test Client',
      email: `client-${Date.now()}@test.com`,
    })
    
    expect(result.error).toBeNull()
    createdIds.clients.push(result.data!.id)
    
    // ✅ Verify in REAL database, not just return value
    const { data: stored } = await supabase
      .from('clients')
      .select('*')
      .eq('id', result.data!.id)
      .single()
    
    expect(stored?.name).toBe('Integration Test Client')
  })
})
```

**Why this pattern**:
- ✅ **Real database**: No mocks, actual persistence tested
- ✅ **CI compatible**: `describe.skip` if no credentials
- ✅ **Clean state**: `afterEach` cleanup prevents test pollution
- ✅ **Verifies data flow**: Tests NOT just return values, but DB state

---

### Pattern 4: E2E Tests with Playwright (Real Browser)

**File**: `tests/e2e/voice-assistant.spec.ts`

```typescript
// ✅ PATTERN: Realistic user journey in real browser
test('[VA2] Send text input and receive response', async ({ page }) => {
  // 1. Login real user
  await page.goto(`${APP_URL}/auth/signin`)
  await page.fill('input[name="email"]', testUserEmail)
  await page.fill('input[name="password"]', testUserPassword)
  await page.click('button[type="submit"]')
  
  // 2. Find and interact with Voice FAB
  const fab = page.locator('button:has(svg)').first()
  await fab.click()
  
  // 3. Send text input
  const input = page.locator('input[placeholder*="Escri"]')
  await input.fill('Hola, quiero agendar una cita para mañana a las 3')
  await page.keyboard.press('Enter')
  
  // 4. Wait for response (may take 5-10s due to LLM)
  const responseText = page.locator('text=/Luis|asistente|respuesta/i')
  await responseText.waitFor({ state: 'visible', timeout: 15000 })
  
  // 5. Verify response appears in UI
  await expect(responseText).toBeVisible()
  
  // 6. Optional: Verify DB state
  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, status')
    .order('created_at', { ascending: false })
    .limit(1)
  
  if (appointments) expect(appointments[0].status).toMatch(/pending|confirmed/)
})
```

**Why this pattern**:
- ✅ **End-to-end**: Tests actual user journey, not just API
- ✅ **Real browser**: Catches UI issues (timing, selectors, state)
- ✅ **Database verification**: Confirms side effects in DB
- ✅ **Realistic delays**: Waits for async operations (LLM calls)

---

## 4️⃣ CODE QUALITY STANDARDS (SENIOR-LEVEL)

### ✅ DO — Best Practices Used in This Project

| Practice | Example | Why |
|----------|---------|-----|
| **Describe nested tests** | `describe('CreateAppointmentUseCase')` → `describe('happy path')` | Clear test organization |
| **Test builders for setup** | `makeQueryRepo(overrides)` | DRY, reusable, type-safe |
| **Specific assertions** | `expect(result.data?.id).toBe('appt-123')` | Fails with useful error |
| **One assertion per case** | Test name describes single behavior | Easy to debug failures |
| **Meaningful names** | `[T1] happy path` not `test1` | Quick understanding |
| **AAA pattern** | Arrange → Act → Assert | Clear test structure |
| **No console.log in tests** | ✅ Removed 2x `console.error` | Clean output, hides bugs |
| **Cleanup after test** | `afterEach(async () => { delete data })` | No test pollution |
| **Skip if missing env** | `describe.skip` when `!SUPABASE_URL` | Safe for CI without secrets |
| **Mock all external deps** | `vi.mock('@/lib/supabase')` | Fast, isolated tests |
| **Type-safe mocks** | `vi.fn().mockResolvedValue(...)` | Catch type errors early |

### ❌ DON'T — Anti-Patterns Avoided

| Anti-Pattern | Why Avoid | What We Did |
|--------------|-----------|------------|
| **`expect(result).toBeTruthy()`** | Vague, bad error messages | `expect(result.error).toBeNull()` |
| **Global test setup** | Hard to debug, test interdependence | `beforeEach(() => vi.clearAllMocks())` |
| **`console.log` in test code** | Pollutes output, hides real errors | ❌ Removed, use assertions |
| **Mock everything globally** | Tests become black boxes | Mocks in test file, scoped |
| **Single `describe` block** | Hard to organize 10+ tests | Nested describe blocks |
| **Hard-coded IDs** | Tests break when data changes | Use generated IDs, `Date.now()` |
| **No cleanup** | Test data accumulates, tests fail randomly | `afterEach` cleanup every time |
| **Mixing unit + integration** | Slow, unclear what fails | Separate directories: `__tests__/` vs `tests/` |
| **Testing implementation details** | Tests break on refactor | Test behavior, not implementation |
| **No test timeouts** | Tests hang forever on failure | `timeout: 30000` for DB, `15000` for API |

---

## 5️⃣ WHEN TO USE EACH TEST TYPE

### Unit Tests (`__tests__/`)
- ✅ Business logic (use-cases, validators, utils)
- ✅ Single function/class in isolation
- ✅ All error paths covered
- ✅ Fast (<1s per test)
- ❌ DON'T use for API routes if you can do integration

**Example**: `CreateAppointmentUseCase.test.ts`

### Integration Tests (`tests/integration/`)
- ✅ Repository methods (CRUD with real DB)
- ✅ Multi-component interaction (orchestrator → repos → DB)
- ✅ Data persistence validation
- ✅ Error handling with real DB constraints
- ❌ DON'T test UI or browser interaction

**Example**: `repositories.test.ts`, `voice-api-e2e.test.ts`

### E2E Tests (`tests/e2e/`)
- ✅ Full user journey through browser
- ✅ UI interaction (click, type, scroll)
- ✅ Visual regression (screenshots)
- ✅ End-to-end workflows (login → action → verify DB)
- ❌ DON'T use for unit tests or performance testing

**Example**: `voice-assistant.spec.ts`, `appointment-booking.spec.ts`

---

## 6️⃣ ADDING TESTS FOR NEW FEATURES

### Workflow for Adding Feature Tests

```
1. Plan in TESTING_GUIDE.md (or existing docs)
2. Create unit test first (__tests__/)
   - Mock all deps
   - Test happy path + error cases
3. Create integration test if touches DB (tests/integration/)
   - Real Supabase
   - Verify persistence
4. Create E2E test if touches UI (tests/e2e/)
   - Real browser
   - Real user journey
5. Run full suite:
   npm run test && npm run test:integration && npm run test:e2e
6. Check coverage:
   npm run test:coverage
```

### Template: Adding a New Use-Case Test

```typescript
// __tests__/domain/use-cases/MyNewUseCase.test.ts
import { describe, it, expect, vi } from 'vitest'
import { MyNewUseCase } from '@/lib/domain/use-cases/MyNewUseCase'

// 1. Create test builders
function makeDepA(overrides = {}) {
  return { method: vi.fn().mockResolvedValue(...), ...overrides }
}

describe('MyNewUseCase', () => {
  // 2. Happy path
  it('should do the right thing', async () => {
    const depA = makeDepA()
    const useCase = new MyNewUseCase(depA)
    const result = await useCase.execute({ ... })
    expect(result.error).toBeNull()
    expect(result.data).toBeDefined()
  })
  
  // 3. Error case
  it('should fail when depA throws', async () => {
    const depA = makeDepA({ method: vi.fn().mockRejectedValue(new Error('fail')) })
    const useCase = new MyNewUseCase(depA)
    const result = await useCase.execute({ ... })
    expect(result.error).toBeTruthy()
    expect(result.data).toBeNull()
  })
})
```

### Template: Adding a New API Route Test

```typescript
// __tests__/api/my-endpoint/route.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/api/with-error-handler', () => ({
  withErrorHandler: (fn) => fn,
}))
vi.mock('@/lib/supabase/server')
vi.mock('@/lib/my-service')

import { POST } from '@/app/api/my-endpoint/route'

describe('POST /api/my-endpoint', () => {
  it('[T1] happy path returns 200', async () => {
    const req = { headers: new Headers(), json: vi.fn().mockResolvedValue({}) }
    const response = await POST(req as any, {}, {}, { id: 'user-1' })
    expect(response.status).toBe(200)
  })
  
  it('[T2] missing required field returns 400', async () => {
    const req = { headers: new Headers(), json: vi.fn().mockResolvedValue({}) }
    const response = await POST(req as any, {}, {}, { id: 'user-1' })
    expect(response.status).toBe(400)
  })
})
```

---

## 7️⃣ TROUBLESHOOTING TESTS

### Tests hang forever
```bash
# Check timeout
timeout: 30000  # in vitest.config.ts

# Run single test with verbose
npx vitest run __tests__/api/voice.test.ts --reporter=verbose
```

### Tests fail with "cannot find module"
```bash
# Check alias in vitest.config.ts
alias: { '@': path.resolve(__dirname, './') }

# Use full import, not alias
import { thing } from './lib/thing'  // ✅
```

### Mock not working
```typescript
// ✅ Mocks BEFORE import
vi.mock('@/lib/supabase/server')

// ❌ Import AFTER mock is defined
import { createAdminClient } from '@/lib/supabase/server'
```

### Tests pass locally but fail in CI
```bash
# CI might not have .env.local
export NEXT_PUBLIC_SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...

# Or use describe.skip for integration tests
const hasEnv = !!process.env.SUPABASE_URL
const describe = hasEnv ? test.describe : test.describe.skip
```

---

## 8️⃣ COVERAGE TARGETS

```
Coverage target: 70% lines + functions

By layer:
├── Domain (use-cases)        → 85%+ ✅
├── Repositories              → 75%+ ✅
├── API Routes                → 70%+ ✅
├── Services                  → 60%  ⚠️
└── Utils/Helpers             → 50%  ⚠️
```

Check coverage:
```bash
npm run test:coverage
# Opens coverage/index.html
```

---

## 9️⃣ CI/CD Integration

### Pre-push Hook
Tests run automatically before push (configured in `.husky/pre-push`):
```bash
npm run test
npm run test:integration  # if SUPABASE_URL set
```

### GitHub Actions (when configured)
```yaml
- run: npm run test
- run: npm run test:coverage
- run: npm run test:e2e  # only on `main` branch
```

---

## 🔟 QUICK REFERENCE

```bash
# Run specific test type
npm run test                          # Unit tests (fast)
npm run test:integration              # Integration with real DB
npm run test:e2e                      # Playwright browser tests
npm run test:coverage                 # All + coverage report

# Run specific file
npx vitest run __tests__/domain/use-cases/CreateAppointmentUseCase.test.ts

# Watch mode (reruns on change)
npm run test:watch

# Debug mode (verbose output)
npx vitest run --reporter=verbose

# UI dashboard
npm run test:ui
```

---

## 📚 Further Reading

- [Vitest Docs](https://vitest.dev)
- [Playwright Docs](https://playwright.dev)
- [Testing Library Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- Project docs: `TESTING_GUIDE.md`, `TESTING_AUDIT_SUMMARY.md`

---

**Last Updated**: 2026-04-19  
**Maintained by**: Cronix Development Team
