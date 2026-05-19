# Testing — Cronix

> Fusión de `TESTING.md` + `TESTING_GUIDE.md`. Verificado con `find` y `package.json`.

## 1. Suite

| Tipo | Framework | Ubicación | Archivos |
|---|---|---|---|
| Unit | Vitest + jsdom + RTL | `__tests__/`, `lib/**/__tests__/`, `components/**/__tests__/`, `app/**/__tests__/` | 74 |
| Voice-worker unit | Vitest (Deno-style ts) | `supabase/functions/voice-worker/**/__tests__/` | 8 |
| Repositorios | Vitest + Supabase mock | `lib/repositories/__tests__/` | 8 |
| Integration | Vitest + Supabase local | `tests/integration/`, config `vitest.integration.config.ts` | 2 |
| Components | Vitest + RTL | `components/**/__tests__/`, config `vitest.components.config.ts` | en `__tests__/components/` |
| E2E | Playwright | `tests/e2e/` | 11 specs |

**Total archivos de test verificados**: 114.

## 2. Scripts

```bash
npm test                  # vitest run (unit + components)
npm run test:watch        # vitest watch
npm run test:ui           # vitest UI
npm run test:coverage     # v8 coverage
npm run test:integration  # vitest.integration.config.ts — requiere `npx supabase start`
npm run test:e2e          # playwright test
npm run test:e2e:smoke    # playwright project=smoke
npm run e2e:setup         # tsx scripts/setup-e2e-data.ts (seed datos E2E)
```

## 3. Tests críticos (los que defienden la arquitectura)

### Seguridad multi-tenant
- `lib/ai/core/__tests__/TenantEnforcer.test.ts` — phantom type + ownership mismatch + webhook variant.
- `lib/ai/core/__tests__/adversarial.test.ts` — intentos de cross-tenant injection, malformed UUIDs, SQL-shaped strings, prompt injection en `client_name`.

### BookingEngine
- `lib/ai/core/__tests__/BookingEngine.test.ts` — happy-path + auto-create cliente + SLOT_CONFLICT + ambig + tz boundaries.
- `lib/ai/core/__tests__/ClientResolver.test.ts` — fuzzy matching real (Lisbeth ↔ Lizeth no se unifican, partial-name "Gardi" → "Gardi Suárez" sí).
- `lib/ai/core/__tests__/ServiceResolver.test.ts` — UUID exacto + nombre fuzzy + multiple matches.
- `lib/ai/core/__tests__/timezone.test.ts` — `localToUTC` y `formatLocalDateTime` con TZ no-UTC (America/Caracas).
- `lib/ai/core/__tests__/tool-schemas.test.ts` — Zod safeParse de cada tool.

### Capa de IA observable
- `__tests__/ai/memory/` — parity test entre `lib/ai/memory` y `_shared/memory`.
- `__tests__/ai/router/` — parity + classify thresholds.
- `__tests__/ai/supervisor/` — parity + mapResponseToVerdict + fail-open path.
- `__tests__/ai/observability/` — Tracer record + finish + hashing.
- `__tests__/ai/training/` — buckets + JSONL shape + parity.

### Voice-worker (Deno-tested)
- `voice-worker/capabilities/*/__tests__/fast-path.test.ts` — un test por capability detector.
- `voice-worker/core/__tests__/date-parser.test.ts`, `time-parser.test.ts`, `fuzzy.test.ts`.

### Repositorios
- `lib/repositories/__tests__/Supabase*Repository.test.ts` — mocks de Supabase client. Verifican `.eq('business_id', …)` en cada query.

### Use cases (dominio)
- `__tests__/domain/use-cases/CreateAppointmentUseCase.test.ts` — conflict-check antes de insert.
- Resto: `__tests__/use-cases/`.

### Pagos
- `lib/payments/nowpayments.test.ts` — HMAC verify, body parser.
- `__tests__/actions/` — server actions PayPal + cripto.
- `tests/e2e/payment-flow.spec.ts`, `tests/e2e/plans-referrals.spec.ts`.

### E2E críticos
- `tests/e2e/smoke.spec.ts` — login, navegar, logout.
- `tests/e2e/appointment-booking.spec.ts` — agendar desde dashboard.
- `tests/e2e/voice-assistant.spec.ts` — pipeline de voz mockeado.
- `tests/e2e/tenant-branding.spec.ts` — isolación visual entre tenants.

## 4. Quality gates

| Hook | Acción |
|---|---|
| Pre-commit (Husky + lint-staged) | `eslint --fix` sobre archivos staged |
| Pre-push | `npm run lint && npm run typecheck && npm test && npm audit` |

Si cualquiera falla, el push se cancela. No usar `--no-verify`.

## 5. Patrones

- **Builders sobre fixtures**: en lugar de objetos literales gigantes, hay funciones `makeAppointment(overrides)`, `makeBusiness(overrides)`.
- **Mocks tipados**: `vitest-mock-extended` para interfaces (`IClientRepository`, `IServiceRepository`).
- **Tests parity**: cualquier duplicación entre Node y Deno tiene un test que asegura que ambos archivos son idénticos.
- **Tests adversariales**: no solo happy path. Hay specs dedicados a romper invariantes (prompt injection, fechas fuera de rango, IDs malformados, double-execution).

## 6. Cobertura objetivo

| Capa | Cobertura mínima |
|---|---|
| `lib/domain/use-cases/` | 90% |
| `lib/ai/core/` | 85% |
| `lib/payments/` | 80% |
| `lib/repositories/` | 75% |
| Server actions | 70% |

Coverage reporter: `@vitest/coverage-v8`. `npm run test:coverage`.
