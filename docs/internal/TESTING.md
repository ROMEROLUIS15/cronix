# Testing — Cronix

> **Suite verificada: 1.410 unit (Vitest, 118 files) + 16 specs E2E (Playwright) + 138 asserts pgTAP, mas integración Supabase local y tests Deno de Edge Functions**

## 1. Suite Overview

| Tipo | Framework | Ubicación | Tests | Archivos | Propósito |
|---|---|---|---|---|---|
| **Unit Tests** | Vitest + jsdom + RTL | `__tests__/`, `lib/**/__tests__/` | 1.410 | 118 | Lógica, componentes, utilidades, AI |
| **E2E Tests** | Playwright | `tests/e2e/` | — | 16 specs | Flujos de usuario end-to-end |
| **Integration Tests** | Vitest + Supabase local | `tests/integration/` | — | 7 | Flujos con datos reales (RLS, multi-tenant) |
| **pgTAP Tests** | SQL + TAP | `supabase/tests/` | 138 | 3 | RLS policies, funciones RPC, alertas de IA |
| **Voice-worker unit** | Vitest (Deno-style) | `supabase/functions/voice-worker/**/__tests__/` | 50+ | 5 | Capacidades de asistente de voz |
| **Voz con audio real** | Playwright (micrófono falso de Chromium) + script `tsx` | `tests/e2e/voice-roundtrip.spec.ts`, `scripts/check-voice.ts` | 1 spec (4 turnos) + 1 chequeo | 2 | Asistente de voz de punta a punta contra producción, en CI — ver §4-bis |

**Reproducible**: 1.410 unit (Vitest) + 16 specs E2E (Playwright) + 138 asserts pgTAP. (+ integración Supabase local y tests Deno de Edge Functions.)

## 1.1 Desglose por dominio

| Dominio | Unit | E2E | Integration | Tests | Archivos |
|---|---|---|---|---|---|
| **Autenticación & Autorización** | 7 | 4 | 2 | 13+ | 13 |
| **Pagos & Facturas** | 2 | 1 | 1 | 4+ | 4 |
| **Citas & Agendamiento** | 5 | 1 | 1 | 7+ | 7 |
| **Clientes** | 2 | 1 | — | 3 | 3 |
| **Componentes UI/Layout** | 40+ | — | — | 150+ | 40 |
| **AI & LLM** | 15+ | — | — | 80+ | 15 |
| **Validaciones (Zod)** | 5 | — | — | 40+ | 5 |
| **API Routes** | 13 | — | — | 97 | 13 |
| **Otros (utils, middleware, etc.)** | 20+ | 8 | 3 | 30+ | 30 |
| **Database (pgTAP)** | — | — | — | 138 | 3 |
| **TOTAL** | 1.410 | 16 specs | 7 files | 138 pgTAP | **118** |

## 2. Scripts

```bash
# Unit Tests (Vitest)
npm test                  # vitest run (1.410 unit tests, 118 files)
npm run test:watch        # vitest watch (modo desarrollo)
npm run test:ui           # vitest UI (interfaz visual)
npm run test:coverage     # v8 coverage report

# Integration Tests (Supabase local)
npm run test:integration  # vitest.integration.config.ts (requiere `npx supabase start`)

# E2E Tests (Playwright)
npm run test:e2e          # playwright test (16 specs)
npm run test:e2e:smoke    # playwright project=smoke (suite rápida)
npx playwright test --project=voice  # voz con audio real (fixtures/voice/*.wav vía micrófono falso de Chromium)
npm run check:voice       # chequeo sintético del voice-worker desplegado (WebM real; diario en CI)
npm run e2e:setup         # tsx scripts/setup-e2e-data.ts (seed datos E2E)

# pgTAP Tests (PostgreSQL native, requiere Supabase local)
npx supabase test db      # Ejecuta todos los pgTAP (138 asserts, ~0.07s)
npx supabase test db --debug  # Debug mode con salida detallada

# Workflows completos
npm test && npm run test:integration && npm run test:e2e && npx supabase test db  # Suite completa (~90s)
```

## 3. Tests críticos (los que defienden la arquitectura)

### ✅ Autenticación & Autorización (13+ tests)
- `__tests__/auth/get-session.test.ts` — Session retrieval, validation, token parsing
- `__tests__/auth/get-business-id.test.ts` — Business context extraction from JWT
- `__tests__/actions/auth.test.ts` — Login/logout actions, session management
- `__tests__/actions/csrf-action.test.ts` — CSRF token generation & validation
- `__tests__/actions/forgot-password.test.ts` — Password recovery flow
- `__tests__/actions/reset-password.test.ts` — Password reset validation
- `__tests__/security/csrf.test.ts` — CSRF protection mechanisms
- `tests/integration/auth-session-flow.test.ts` — End-to-end session creation with RLS
- `tests/integration/passkey-auth-flow.test.ts` — WebAuthn challenge/response, counter increment
- `tests/e2e/auth-register.spec.ts` — Registration workflow (Playwright)
- `tests/e2e/auth-login.spec.ts` — Login with valid/invalid credentials
- `tests/e2e/auth-password-reset.spec.ts` — Password reset token flow
- `tests/e2e/auth-invite.spec.ts` — Team invitations & code validation

### ✅ Seguridad multi-tenant (40+ tests)
- `lib/ai/with-tenant-guard.ts` — per-tool `tenantGuard.verify()` against `users.business_id`, called by every dashboard AI tool
- RLS audit + cross-tenant adversarial scenarios — see `docs/architecture/DATABASE_SECURITY_TESTING.md`
- `tests/integration/auth-session-flow.test.ts` — RLS enforcement + multi-tenant isolation
- `tests/integration/passkey-auth-flow.test.ts` — Tenant-scoped passkey verification
- **notification_subscriptions RLS** — Strictened policies to prevent cross-tenant writes (2026-05-21 migration)
- **appointment_reminders idempotency** — Partial UNIQUE index for race-proof cron (2026-05-21 migration)

### ✅ Booking & appointment use-cases
- `supabase/functions/voice-worker/core/__tests__/fuzzy.test.ts` — Client/service fuzzy matching (voice; Lisbeth ↔ Lizeth no unify)
- `__tests__/notifications/appointment-event-id.test.ts` — Deterministic notification `eventId` (Node↔Deno contract)
- `tests/integration/appointments-flow.test.ts` — Full appointment creation, confirmation, cancellation
- `__tests__/domain/use-cases/CreateAppointmentUseCase.test.ts` — Conflict-check antes de insert
- `__tests__/domain/use-cases/RescheduleAppointmentUseCase.test.ts` — Rescheduling with conflict validation
- `__tests__/domain/use-cases/CancelAppointmentUseCase.test.ts` — Cancellation & refund logic
- `tests/e2e/business-flows-clients.spec.ts` — Full client CRUD workflow

### ✅ AI/LLM Observable Layer (80+ tests)
- `__tests__/ai/memory/memory-engine.test.ts` — Parity test entre `lib/ai/memory` y `_shared/memory`
- `__tests__/ai/router/semantic-router.test.ts` — Parity + classify thresholds (9 intents, 0.78 threshold)
- `__tests__/ai/supervisor/constitutional-reviewer.test.ts` — Verdict mapping + fail-open path
- `__tests__/ai/supervisor/guard.test.ts` — Safety check validations
- `__tests__/ai/observability/tracer.test.ts` — Tracer record + finish + hashing
- `__tests__/ai/training/` — Buckets + JSONL shape + parity tests
- `__tests__/ai/circuit-breaker.test.ts` — Fallback chain (70B → 8B → Gemini)
- `__tests__/ai/resilience.test.ts` — Error recovery mechanisms

### ✅ Voice-worker (Deno-tested, 50+ tests)
- `supabase/functions/voice-worker/capabilities/next-appointment/__tests__/fast-path.test.ts`
- `supabase/functions/voice-worker/core/__tests__/frame.test.ts`
- `supabase/functions/voice-worker/core/__tests__/slot-extractor.test.ts`
- Date/time parsing, fuzzy matching, capability detection — verificado sin LLM

### ✅ Componentes (150+ tests)
**UI Components:**
- `__tests__/components/ui/button.test.tsx` — 32 tests (variants, sizes, loading state)
- `__tests__/components/ui/modal.test.tsx` — 24 tests (open/close, keyboard nav, backdrop)
- `__tests__/components/ui/date-time-picker.test.tsx` — DateTime selector
- `__tests__/components/ui/pwa-install-banner.test.tsx` — 24 tests (native prompt, iOS fallback)
- `__tests__/components/ui/pwa-update-toast.test.tsx` — 22 tests (update notifications)
- `__tests__/components/ui/passkey-register.test.tsx` — 12 tests (WebAuthn registration)
- `__tests__/components/ui/passkey-login-button.test.tsx` — 14 tests (platform auth detection)
- `__tests__/components/ui/client-select.test.tsx`, `language-switcher.test.tsx`

**Layout Components:**
- `__tests__/components/layout/dashboard-shell.test.tsx` — 20 tests (page routing, sidebar, notifications)
- `__tests__/components/layout/notification-panel.test.tsx` — 12 tests (mark-as-read, filtering)
- `__tests__/components/layout/topbar.test.tsx`, `sidebar.test.tsx`

**Dashboard Components:**
- `__tests__/components/dashboard/voice-assistant-fab.test.tsx` — 19 tests (chat history, position persistence)
- `__tests__/components/dashboard/voice-visualizer.test.tsx` — 21 tests (animation bars, volume response)
- `__tests__/components/dashboard/services-onboarding-banner.test.tsx` — 18 tests

**Admin Components:**
- `__tests__/components/admin/dead-letter-feed.test.tsx` — 24 tests (DLQ display, realtime)
- `__tests__/components/admin/system-status-grid.test.tsx` — System health status

### ✅ API Routes (97 tests, 13 archivos)
- `__tests__/api/health.test.ts` — 16 tests (DB check, env validation, circuit breaker status)
- `__tests__/api/passkey-authenticate-options.test.ts` — 11 tests (challenge generation, rate limiting)
- `__tests__/api/passkey-authenticate-verify.test.ts` — 14 tests (credential verify, counter increment)
- `__tests__/api/assistant-proactive.test.ts` — 11 tests (LLM greeting, Deepgram TTS)
- `__tests__/api/assistant-tts.test.ts` — 15 tests (text-to-speech, streaming)
- `__tests__/api/admin-user-status.test.ts` — User status management
- `__tests__/api/activity-ping-route.test.ts` — Activity logging
- `__tests__/api/webhooks/paypal.webhook.test.ts` — PayPal signature verification

### ✅ Pagos (4+ tests, 4 archivos)
- `tests/integration/payment-pipeline.test.ts` — 8 tests (invoice creation, status transitions)
- `__tests__/actions/` — Server actions PayPal + cripto
- `tests/e2e/payment-flow.spec.ts` — E2E payment processing
- Idempotency: RPC `fn_finalize_paypal_payment` (FOR UPDATE) + webhook async

### ✅ Validaciones (Zod, 40+ tests, 5 archivos)
- `__tests__/validations/appointment.schema.test.ts` — Appointment validation rules
- `__tests__/validations/auth.schema.test.ts` — Auth schemas
- `__tests__/validations/client.schema.test.ts` — Client schemas
- `__tests__/validations/finance.schema.test.ts` — Financial schemas
- `__tests__/validations/service.schema.test.ts` — Service schemas

### ✅ E2E Workflows (16 specs)
- `tests/e2e/auth-register.spec.ts` — Registration with validation
- `tests/e2e/auth-login.spec.ts` — Login & session persistence
- `tests/e2e/auth-password-reset.spec.ts` — Password recovery
- `tests/e2e/auth-invite.spec.ts` — Team invitations
- `tests/e2e/dashboard-core-pages.spec.ts` — 17 tests (page navigation, profile, settings)
- `tests/e2e/business-flows-clients.spec.ts` — 14 tests (CRUD, filtering, bulk operations)

## 4. pgTAP Tests (Database-Level Testing)

### Overview
**pgTAP** es un framework de testing **nativo de PostgreSQL** que ejecuta tests SQL directamente en la base de datos. A diferencia de vitest (que testa lógica de aplicación), pgTAP testa comportamiento crítico que **NO puede mockarse**: RLS policies, RPC functions, triggers, constraints.

**Archivos:**
- `supabase/tests/rls_policies.test.sql` — 86 asserts validando Row-Level Security
- `supabase/tests/critical_functions.test.sql` — 43 asserts validando funciones RPC críticas
- `supabase/tests/ai_agent_alerts.test.sql` — 9 asserts de alertas del agente de IA
- `supabase/tests/ai_failure_alerts.test.sql` — 14 asserts de la alerta de fallos por negocio (Sentry)

### 4.1 RLS Policies (86 asserts)

Valida que **multi-tenant isolation** funcione a nivel de base de datos:

| Sección | Tests | Qué valida |
|---|---|---|
| **Authentication & Context** | 3 | `current_user_id()`, `current_business_id()` |
| **Businesses** | 3 | Solo propietarios ven su business |
| **Users** | 5 | Aislamiento strict por business_id |
| **Appointments** | 6 | Staff ve citas de su business, clientes solo sus citas |
| **Clients** | 6 | Aislamiento cross-tenant (UNIQUE business_phone) |
| **Notification Subscriptions** | 8 | Hardening INSERT/UPDATE policies (2026-05-21) |
| **Services** | 8 | No pueden ver/editar servicios de otro tenant |
| **Audit Logs** | 8 | Staff ve logs de su business, no de otros |

**Hallazgos críticos:**
- Partial unique index `uq_reminder_imminent_owner` en `appointment_reminders` previene race conditions en cron jobs
- INSERT/UPDATE policies en `notification_subscriptions` validan `business_id` directamente desde `users` table (no confía en contexto enviado)
- Todas las políticas SELECT usan `business_id = (SELECT business_id FROM users WHERE id = auth.uid())`

### 4.2 Critical Business Functions (43 asserts)

Valida lógica de negocio que **debe ser exacta y confiable**:

#### Payments (5 tests)
- `fn_finalize_paypal_payment` idempotencia: segunda llamada retorna `'already_processed'`
- Amount tolerance: diffs < 0.01 aceptados (±1 centavo)
- Amount mismatch > 0.01: rejected con status `'amount_mismatch'`
- Invoice not found: returns `'invoice_not_found'`
- Subscription extension + plan update

#### Appointments (2 tests)
- `fn_book_appointment_wa` creates appointments via WhatsApp
- `fn_reschedule_appointment_wa` exists

#### Rate Limiting (5 tests)
- `fn_wa_check_rate_limit` — WhatsApp message rate limiting
- `fn_web_check_rate_limit` — Web request rate limiting
- `fn_wa_check_circuit_breaker` — Protección contra cascading failures
- `fn_wa_check_token_quota` — Token usage tracking

#### Helpers (3 tests)
- `fn_clean_phone` — Phone number normalization (removes formatting)

### 4.3 Ejecución

```bash
# Ejecutar todos los pgTAP tests
npx supabase test db

# Esperado:
# /Users/.../rls_policies.test.sql ........ ok
# /Users/.../critical_functions.test.sql .. ok
# /Users/.../ai_agent_alerts.test.sql ..... ok
# All tests successful.
# Files=3, Tests=138, Result: PASS
```

---

## 4-bis. Asistente de voz con audio real (E2E + chequeo sintético)

### Por qué existe
Los tests de componentes (`__tests__/components/dashboard/use-voice-assistant.test.tsx`) prueban la lógica del botón con un micrófono simulado: no ven el audio real, ni la grabación del navegador, ni el `voice-worker`, ni Deepgram. El 2026-10-23 llegaron a producción dos fallas que ninguna prueba vio: audio WebM corrupto después de varios turnos (una grabadora huérfana metía fragmentos sin cabecera) y cortes HTTP/2 entre el `voice-worker` y Deepgram. Este tipo de prueba recorre el camino completo con audio real. En su primera corrida detectó el segundo bug y reprodujo el primero.

### E2E con micrófono falso (navegador → servidor)
- **Spec:** `tests/e2e/voice-roundtrip.spec.ts`, en el proyecto Playwright `voice` (`playwright.config.ts`). Chromium arranca con `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture=<wav>` y `--autoplay-policy=no-user-gesture-required`: el navegador "escucha" un WAV en loop como si fuera el micrófono. Los demás proyectos (`chromium`, `firefox`, `webkit`, `Mobile Chrome`) ignoran este spec porque necesita ese micrófono.
- **Audio:** `tests/e2e/fixtures/voice/que-citas-tengo-hoy.wav`, que dura 4,3 s: 0,5 s de silencio, la pregunta "¿Qué citas tengo hoy?" y 2 s de silencio, a 16 kHz. Se eligió una pregunta que no depende de los datos del negocio.
- **Flujo:** el proyecto `setup` hace el login del usuario E2E. Después vienen 4 turnos seguidos, cada uno: tocar el botón, grabar, el botón corta solo (por silencio o en el tope de 10 s), subir al `voice-worker` **desplegado**, Deepgram, agente. En el turno 2 se descarta la respuesta mientras suena y se pregunta enseguida: es la secuencia que rompió producción.
- **Qué verifica en cada turno:**
  - el `voice-worker` responde **HTTP 200** (si el audio sale corrupto, Deepgram lo rechaza y el `voice-worker` devuelve 400, así que el test falla);
  - la transcripción contiene al menos 2 de las 4 palabras de la pregunta (`tests/e2e/fixtures/voice/question.ts`);
  - el botón vuelve a reposo.

  **No** compara el texto de la respuesta, porque el LLM varía.
- **Estado del botón:** el botón expone `data-state` (`idle`, `listening`, `processing` o `speaking`) para que el test siga la máquina de estados.
- **Diagnóstico cuando falla:** imprime en el log del job, completos, los cambios de estado del botón (`[fab-state]`), la consola, los textos enviados a hablar (`[tts]`), los errores de página y los pedidos de red fallidos. Además los adjunta al reporte de Playwright.

### Chequeo sintético (solo servidor)
- `npm run check:voice` (`scripts/check-voice.ts`) hace el login del usuario E2E y sube `tests/e2e/fixtures/voice/que-citas-tengo-hoy.webm` (el mismo contenedor WebM/Opus que manda el botón) al `voice-worker` desplegado.
- Pasa solo con **200**, una transcripción de la pregunta y una respuesta no vacía. Reintenta una vez ante un 5xx. Si falla, sale con código 1.
- Detecta lo que el E2E no ve entre pushes: una clave de Deepgram o Groq vencida, o un deploy roto.

### Dónde corre en CI

| Qué | Workflow → job | Cuándo | Si falla |
|---|---|---|---|
| E2E de voz | `Tests` (`test.yml`) → **`E2E Voice (real audio, Playwright)`** | Cada push a `develop` o `main` | **No** es `continue-on-error`: el workflow sale rojo y GitHub avisa por email |
| Chequeo sintético | **`Voice Check (deployed voice-worker)`** (`voice-check.yml`) | Diario a las 12:00 UTC (8:00 en Caracas), después del workflow "Deploy Supabase Edge Functions" y a mano | El workflow sale rojo y GitHub avisa por email |

- Los dos comparten el grupo de concurrencia `e2e-voice-fixture-user`: nunca corren a la vez, porque usan el mismo usuario, su historial en Redis y su límite de pedidos. El 2026-10-24 las únicas corridas rojas del E2E fueron las dos que se superpusieron.
- Un deploy hecho a mano (`npx supabase functions deploy … --use-api`) **no** dispara `voice-check.yml`. Después de desplegar el `voice-worker`, corré `npm run check:voice`.

### Contra qué corre y qué deja
- Corre contra **producción** (Supabase y el `voice-worker` desplegado) con el usuario E2E (`E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD`).
- Escribe trazas en `ai_traces` solo para el negocio de prueba. Cuesta centavos de Deepgram y Groq por corrida.
- El E2E de un push prueba el código del **navegador** de ese push contra el servidor que ya está desplegado. Un cambio del `voice-worker` recién queda probado cuando se despliega.

### Secrets de GitHub
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `E2E_TEST_EMAIL` y `E2E_TEST_PASSWORD` ya están cargados.
- **`DEEPGRAM_AURA_API_KEY` todavía no está cargado** (verificado el 2026-10-24). Lo usa `/api/assistant/tts` del servidor Next del job para decir la respuesta en voz alta. Sin él el E2E igual pasó, pero el turno que descarta la respuesta depende de una ventana muy corta en estado `speaking`. Para cargarlo desde `.env.local` sin mostrarlo:
  `$env:GH_TOKEN = gh auth token --user ROMEROLUIS15; ((Select-String -Path .env.local -Pattern '^DEEPGRAM_AURA_API_KEY=(.+)$').Matches[0].Groups[1].Value.Trim().Trim('"')) | gh secret set DEEPGRAM_AURA_API_KEY --repo ROMEROLUIS15/cronix`

### Correrlo en local
```bash
npx playwright install chromium        # una sola vez
npm run build && npx next start -p 3100   # en otra terminal
PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test --project=voice
npm run check:voice
```
- **Si el puerto 3000 lo ocupa otra app,** Playwright la reutiliza (`reuseExistingServer`) y el login termina en una página ajena. Por eso se usa el puerto 3100.
- **Si el servidor lo levanta Playwright** (`npm run build && npm run start`), puede superar su límite de 180 s mientras compila. Conviene compilar y levantarlo aparte, como arriba.

### Limitaciones y mantenimiento
- Prueba una sola pregunta, sin nombres propios ni frases largas.
- **Keyword boost:** el `voice-worker` le pasa a Deepgram los nombres de los clientes y eso puede reemplazar palabras comunes. En el negocio de prueba, "citas" se transcribe "E2E". Por eso se exigen 2 de 4 palabras y no la frase exacta.
- **Regenerar los fixtures:** los comandos están en la cabecera del spec (TTS de Deepgram `aura-2-nestor-es` y ffmpeg). El JSON de Deepgram se manda como UTF-8; Git Bash rompe los acentos si se pasa en línea.

## 5. Quality gates

| Hook | Acción | Status |
|---|---|---|
| Pre-commit (Husky + lint-staged) | `eslint --fix` sobre archivos staged | ✅ Active |
| Pre-push | `npm run lint && npm run typecheck && npm test && npm audit` | ✅ Active |
| CI/CD (GitHub Actions) | Lint + TypeCheck + Unit + Integration + E2E | ✅ Ready |
| CI — voz con audio real | `E2E Voice (real audio, Playwright)` en cada push a `develop`/`main` + `Voice Check` diario (§4-bis) | ✅ Active |

Si cualquiera falla, el push se cancela. No usar `--no-verify`.

## 6. Patrones de Testing

- **Builders sobre fixtures**: `makeAppointment(overrides)`, `makeBusiness(overrides)` en lugar de objetos gigantes
- **Mocks tipados**: `vitest-mock-extended` para interfaces (`IClientRepository`, `IServiceRepository`)
- **Tests parity**: Cualquier duplicación entre Node (`lib/ai/*`) y Deno (`_shared/*`) tiene un test que asegura zero drift
- **Tests adversariales**: No solo happy path. Specs dedicados a romper invariantes:
  - Prompt injection en `client_name`
  - Fechas fuera de rango
  - UUIDs malformados
  - Double-execution / race conditions
  - Cross-tenant injection attempts
- **Accessibility**: ARIA roles, keyboard navigation, labels validadas en componentes
- **Edge cases**: Rapid state changes, concurrent operations, timezone boundaries

## 7. Métricas & Cobertura

### Coverage actual (vitest v8)
```bash
npm run test:coverage
```

### Cobertura objetivo por capa
| Capa | Target | Actual | Status |
|---|---|---|---|
| `lib/domain/use-cases/` | 90% | 95%+ | ✅ |
| `lib/ai/core/` | 85% | 90%+ | ✅ |
| `lib/payments/` | 80% | 85%+ | ✅ |
| `lib/repositories/` | 75% | 80%+ | ✅ |
| Server actions | 70% | 75%+ | ✅ |
| `lib/ai/memory/` (parity) | 100% | 100% | ✅ |
| `lib/ai/router/` (parity) | 100% | 100% | ✅ |
| `lib/ai/supervisor/` (parity) | 100% | 100% | ✅ |

### Métricas de ejecución
- **Total reproducible**: 1.410 unit (Vitest) + 16 specs E2E + 138 asserts pgTAP
- **Execution time**: ~35 segundos (Vitest) + ~0.07s (pgTAP)
- **Test files**: 118 unit (Vitest) + 3 pgTAP + tests Deno (voice-worker)
- **Passing rate**: 100%
- **Flakes**: 0
- **Average per test**: ~31ms (Node.js), ~1ms (pgTAP)

### Desglose por tipo
| Tipo | Tests | Archivos | Tiempo |
|---|---|---|---|
| Unit (Vitest) | 1.410 | 118 | ~35s |
| E2E (Playwright) | 16 specs | 16 | ~20-30s |
| Integration (Vitest) | (Supabase local) | 7 | ~8-10s |
| pgTAP (SQL) | 138 asserts | 3 | ~0.07s |
| Voice-worker (Deno) | tests Deno | — | — |
| **TOTAL reproducible** | **1.410 unit + 138 pgTAP** | **118** | **~60-70s** |

## 8. Mantenimiento & Próximos pasos

### En desarrollo
- Pre-commit hooks: `eslint --fix` automático
- Pre-push gates: 4 validaciones (lint, tsc, test, audit)
- CI/CD ready para GitHub Actions

### Optional para futuro
- Supabase Functions (deno) — Requiere Deno runtime setup
- Visual regression tests (low ROI con CSS-in-JS)
- Performance benchmarks (una vez suite estable)
