# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Cronix — Gobernanza para Agentes

Este repositorio opera bajo **Spec-Driven Development (SDD)**. Las especificaciones viven en `docs/specs/` y son vinculantes.

## 🚦 LEY CERO — Gate SDD (antes de tocar código)

**ANTES de generar, modificar o refactorizar una sola línea de código, ejecuta el Protocolo de Arranque** (definido de forma canónica en `docs/specs/INDEX.md`, importado al final de este archivo):

1. Leer `docs/specs/INDEX.md` e identificar el módulo a tocar.
2. Leer `docs/specs/constitution.md` (reglas globales del repo).
3. Leer el `manifest.md` del módulo correspondiente.

Reglas del gate (innegociables):

- **Sin excepción por "cambio pequeño".** Aplica a cada tarea de código, incluidas correcciones de una línea.
- **Lo normativo del spec (contratos, invariantes, códigos de error, flujos) manda sobre tu criterio.** Lo descriptivo (nombres de función, rutas, proveedor concreto) se sigue del código real actual.
- **Si el spec y el código divergen, reporta la divergencia antes de escribir.** No improvises ni elijas en silencio.
- **Área sin spec o marcada 🔴 → decláralo y pide confirmación** antes de codificar.
- **Declara qué specs leíste** al inicio de tu respuesta a una tarea de código (ej: `SDD: constitution + modulo-pagos`). Si no puedes nombrarlos, no cumpliste el gate.

## Reglas de estilo y arquitectura

Las reglas detalladas de código (capas DDD, tipado estricto, manejo de errores, multi-tenant, testing) viven en `.agent/rules/good-development-practices.md` y también son vinculantes.

Puntos que muerden en cada revisión: `noUncheckedIndexedAccess: true` está activo → nunca accedas a un array por índice sin guarda (`array[0]!` solo si la lógica lo garantiza). Nunca uses `.catch()` sobre un query builder de Supabase; chequea `{ data, error }` explícitamente. Prohibido `any` y `SELECT *` en producción.

---

## Comandos

```bash
# Desarrollo
npm run dev                # Next.js + Turbopack (localhost:3000)
npm run build              # Build de producción
npm run lint               # ESLint
npm run typecheck          # tsc --noEmit
npm run knip               # Detecta dead code / deps sin usar (¡es gate de CI y puede poner "Tests" en rojo!)

# Tests unitarios (Vitest)
npm test                   # Suite unitaria + repos (jsdom). NO incluye __tests__/components/**
npm run test:watch         # Modo watch
npx vitest run <ruta>      # Un solo archivo, p.ej. lib/payments/nowpayments.test.ts
npx vitest run -t "<nombre parcial del test>"   # Un test por nombre
npm run test:coverage      # Coverage v8 (umbral 70% líneas sobre domain/repos/ai-core/api)

# Otras suites
npm run test:components    # Componentes (jsdom + RTL, config aparte — ver nota abajo)
npm run test:integration   # Integración contra Supabase local (vitest.integration.config.ts)
npm run test:e2e           # Playwright (todos los specs)
npm run test:e2e:smoke     # Playwright suite reducida (--project=smoke)
npm run test:evals:agent   # Evals E2E del agente WhatsApp (conversaciones golden, BLOQUEANTE en CI)
npm run test:evals         # Evals Python/DeepEval (necesita evals/.venv)
npx supabase test db       # pgTAP: RLS + funciones RPC + alertas (corre contra Supabase local)

# Base de datos / Supabase (requiere Docker)
npx supabase start                    # Levanta Postgres + Edge + Studio (127.0.0.1:54323)
npx supabase db reset                 # Reaplica migraciones + seed
npm run check:spec-drift              # Verifica que specs y código no divergieron (gate de CI)

# Ejercitar los agentes en local (sin esperar tráfico real)
npm run sim:whatsapp       # Simula un mensaje entrante de WhatsApp contra process-whatsapp
npm run trigger:voice      # Dispara el voice-worker
npm run seed:intents       # Reindexa los embeddings de intents
npm run e2e:setup          # Siembra los datos que consume la suite E2E

# Loadtest (local, free-tier-safe — nunca contra prod)
npm run loadtest:seed / :explain / :load
```

**El job "Tests" de CI corre**, en este orden: `test:evals:agent` → `npm test` → `test:components` → `lint` → `knip` → `check:spec-drift`. Bloquean todos menos `check:spec-drift` (`continue-on-error`). Que "Tests" salga rojo suele ser knip, no vitest.

**`npm test` NO incluye `__tests__/components/**`** (config aparte: necesitan el transform de JSX vía `@vitejs/plugin-react`). Corre `npm run test:components` — **389 tests, bloqueante**. Dos cosas que muerden si escribes tests de componentes: (1) el mock de i18n compartido está en `__tests__/setup/next-intl-mock.tsx` — resuelve contra `messages/es.json` **real** (asserts en español, no en la key), con override opcional; los componentes usan `useTranslations`/`useLocale` y revientan sin provider, así que no vuelvas a hand-rollear mocks parciales. (2) Nunca mockees un módulo devolviendo un `Proxy` desde una factory `async`: el runtime lo lee como *thenable* (`get(_, 'then')`) y **mata el worker** con "Worker exited unexpectedly". Lista los exports (p.ej. iconos de `lucide-react`) explícitamente.

**Deno / Edge Functions** (`supabase/functions/`) no usan npm ni Vitest: se validan con `deno check` y tests `deno test` propios. Desde Windows, desplegar una Edge Function requiere `supabase functions deploy <name> --use-api` (el bundling con Docker rompe los import maps).

**Quality gates** (Husky): pre-commit corre `eslint --fix` sobre staged; pre-push corre 4 etapas — `lint → tsc → vitest → npm audit` (este último solo `--audit-level=high --omit=dev`, las devDeps no van al bundle). Un fallo cancela el push — no lo bypassees.

## Arquitectura esencial (lo que no se ve leyendo un solo archivo)

Lee `README.md` para el panorama completo. Lo crítico para no romper cosas:

- **Doble runtime físico con duplicación byte-a-byte.** El código de IA vive dos veces: `lib/ai/**` (Node, para el dashboard) y `supabase/functions/_shared/**` (Deno, para Edge Functions). **No hay cross-imports** — Deno no puede importar módulos Node. Si tocas lógica compartida (supervisor, router, memory, observability, training, cache-invalidation) **debes editar ambas copias**: los tests `__tests__/ai/**/contracts-parity.test.ts` fallan al menor drift. Lo mismo para i18n (`__tests__/i18n/parity.test.ts`, 6 locales, `es` es la fuente).

- **Dos agentes de IA, un Pipeline Engine.** WhatsApp (`supabase/functions/process-whatsapp/`, cliente vía teléfono) y Voz (`supabase/functions/voice-worker/`, dueño vía nombre) comparten el `Pipeline<T>` de `_shared/pipeline/`. Ambos priorizan rutas deterministas (fast-paths sin LLM) sobre el LLM; el LLM tiene prohibido inventar datos del negocio. Contrato normativo de punta a punta: `docs/specs/modulo-whatsapp-citas/operacion-canonica.md`.

- **Aislamiento multi-tenant en 3 capas independientes.** (1) Repos filtran `.eq('business_id', …)` + ownership asserts; (2) RLS en Postgres deriva el tenant del JWT (`current_business_id()`); (3) `ConstitutionalReviewer` (Groq 8B) revisa los writes de IA. Toda query lleva `business_id`. **Las RPC `SECURITY DEFINER` browser-facing deben invocar `fn_assert_business_access(business_id)`** o son fuga cross-tenant (ver Historial de INDEX.md, 2026-06-22).

- **Toda escritura de datos invalida el caché del dashboard** vía `_shared/cache-invalidation.ts` / `cache.invalidateKey(business, …)`. Omitirlo = datos obsoletos hasta ~3 min. Las server actions van por `lib/domain/use-cases/` (Zod → conflict check → repo → invalidate), nunca directo a la DB desde la UI.

- **`types/database.types.ts` se mantiene a mano.** El regen completo de Supabase se descartó; añade columnas/RPC nuevas manualmente en vez de regenerar el archivo entero.

- **Pagos idempotentes.** PayPal → RPC `fn_finalize_paypal_payment` (FOR UPDATE) + webhook como red de seguridad; NOWPayments (cripto) → QStash queue; manual → aprobación admin. Todos convergen en `saas_invoices`. `PAYPAL_ENV=live` es opt-in explícito (no derivar de `NODE_ENV`, Vercel lo pone en `production` en previews).

- **Migraciones son inmutables una vez aplicadas.** Nueva migración = nuevo archivo timestamped en `supabase/migrations/`; `CREATE OR REPLACE FUNCTION` con firma distinta crea un *overload* nuevo (no reemplaza) → causa de bugs PGRST203 pasados.

---

@docs/specs/INDEX.md
