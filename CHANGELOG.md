# Changelog — Cronix

Todos los cambios significativos en este proyecto serán documentados en este archivo.

El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/) y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/).

---

## [0.3.0] — 2026-04-24

### Agregado

#### Ajuste 1: Visibilidad de Citas en el Calendario del Dashboard

El Dashboard ahora **auto-refresca automáticamente** cuando el agente de WhatsApp crea o reagenda citas. No hay necesidad de recargar la página (F5) manualmente.

**Cambios técnicos:**
- `app/[locale]/dashboard/appointments/hooks/use-appointments-list.ts` — Agregada suscripción a Realtime
  - Suscribe al canal `notifications:{businessId}`
  - Escucha eventos `appointment.created` y `appointment.rescheduled`
  - Dispara `fetchAppointments()` automáticamente para refrescar
  - Implementado con patrón useEffect + cleanup (remover suscripción al desmontar)

**Beneficios:**
- Sincronización en tiempo real entre WhatsApp y Dashboard
- UX mejorada: sin fricción de sincronización manual
- Baseline para futuras features Realtime en el Dashboard

**Referencias:**
- [WHATSAPP_AI_ARCHITECTURE.md](docs/WHATSAPP_AI_ARCHITECTURE.md) — Sección 5 (pipeline de notificaciones actualizado)
- [ARCHITECTURE.md](ARCHITECTURE.md) — Sección 6 (pipeline dual)

---

#### Ajuste 2: Precisión en la Lógica de Cancelación de Citas

El agente de WhatsApp ahora **distingue explícitamente** entre cancelar una cita única vs múltiples citas, evitando asupciones ambiguas.

**Cambios técnicos:**

1. **`supabase/functions/process-whatsapp/context-fetcher.ts`**
   - Extended lookback para `getActiveAppointments()` de "ahora" a "4 horas atrás"
   - Justificación: Permite detectar citas que ya iniciaron (mismo día, para cancelación post-inicio)
   - Cambio: `const since = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()`

2. **`supabase/functions/process-whatsapp/prompt-builder.ts`**
   - Sección CANCELACIÓN reescrita con criterios explícitos:
     - **Cita única** (exactamente 1): Identifica + propone directamente → `¿Confirmas que la cancele?`
     - **Múltiples citas** (2 o más): Lista todas + pregunta cuál → nunca asume
     - **Confirmación obligatoria**: JAMÁS llama `cancel_booking` sin confirmación del cliente
   - Tres puntos numéricos claros + ejemplo de wording para cada caso

3. **`supabase/functions/process-whatsapp/tool-executor.ts`**
   - Función `cancel_booking()` — Agregado `sanitizeUUID()` explícito al inicio
   - Mensajes de error mejorados con contexto y guía (refiere al listado CITAS ACTIVAS)
   - Errores ahora es más conversacionales para que el LLM pueda recuperarse

**Beneficios:**
- Cancelaciones más confiables, especialmente en imprecisión del cliente ("cancela mi cita del lunes")
- Previene cancelaciones accidentales (nunca asume si hay múltiples)
- Mejor UX: citas activas de 4h atrás siguen cancelables (casos reales: "quiero cancelar la que tengo en 20 min")

**Riesgos mitigados:**
- Cancelación incorrecta de cita (la cita equivocada)
- No detectar citas same-day pasadas la hora de inicio

**Referencias:**
- [WHATSAPP_AI_ARCHITECTURE.md](docs/WHATSAPP_AI_ARCHITECTURE.md) — Sección 2 (guardrails hardening actualizado)
- [ARCHITECTURE.md](ARCHITECTURE.md) — Sección 4 (WhatsApp Agent, contexto extendido)

---

## [0.2.0] — 2026-04-19

### Agregado

#### Voice Assistant Asíncrono para el Dashboard

Implementación de un asistente de voz en el Dashboard usando **QStash para orquestación asíncrona** + **Redis para estado de jobs** + **Deepgram Aura para TTS**.

**Arquitectura:**
```
FAB (Voice Button)
    ↓ [Pulsa grabar]
STT (Groq Whisper) + enqueue a QStash
    ↓
route.ts: submit → jobStore.update(status: 'pending')
    ↓
QStash: espera a que worker esté disponible
    ↓
worker/route.ts: LLM orchestration + TTS synthesis
    ↓
jobStore.update(status: 'completed', resultText, resultAudioUrl)
    ↓
FAB: polling desde status/route.ts cada 500ms
    ↓ [Cuando completado]
Reproducir audioUrl + mostrar texto
```

**Archivos nuevos:**
- `app/api/assistant/voice/route.ts` — Submit endpoint: STT + enqueue
- `app/api/assistant/voice/worker/route.ts` — QStash worker: orchestration + TTS
- `app/api/assistant/voice/status/route.ts` — Polling endpoint: job status check
- `lib/ai/job-store.ts` — Redis-backed job store con TTL 24h

**Archivos modificados:**
- `components/dashboard/voice-assistant-fab.tsx` — Async flow con confirmation audio + polling
- `lib/ai/agents/dashboard/config.ts` — Integration del orchestrator
- `lib/ai/orchestrator/execution-engine.ts` — Support para action responses

**Características:**
- Retry automático via QStash (hasta 4 intentos)
- Fallback a texto si TTS falla
- Progress audio (tono confirmación)
- Contador de intentos visible

**Test coverage:**
- `__tests__/api/assistant/voice/` — Suite de 28 tests (Vitest)
- E2E: `tests/voice-assistant.spec.ts` — Playwright (FAB drag, record, play audio)

**Referencias:**
- [ARCHITECTURE.md](ARCHITECTURE.md) — Sección 12 (Voice Assistant Async)
- [README.md](README.md) — Módulo #5

---

## [0.1.0] — 2026-04-18

Base histórica documentada. Includes:

### Funcionalidades Base

- **Agente de IA WhatsApp** — ReAct loop con Groq Llama 3
  - Booking: agendar, cancelar, reagendar citas
  - Audio: Whisper transcription + TTS (Deepgram)
  - Multi-tenant: slug routing + sesión
  - Rate limiting: 6 capas de seguridad

- **Agente de IA Dashboard** — Orquestador de conversación
  - Citas: confirmar, cancelar, reagendar, buscar disponibilidad
  - Clientes: crear, buscar, historial
  - Finanzas: ingresos, proyecciones, reportes
  - Permisos: RBAC por rol (owner, employee, external)
  - Modelos: 8b primario, 70b fallback

- **Notificaciones Dual**
  - Dueño: WhatsApp directo + PWA push + DB
  - Cliente: WhatsApp branded confirmations
  - Idempotencia: event_id determinista

- **Auth + Security**
  - Supabase Auth + Passkeys (WebAuthn)
  - Login rate limiting: 3 intentos → 5 min lockout
  - Session timeout: 30 min inactividad + 12h absoluto
  - RLS multi-tenant

- **Observabilidad**
  - Sentry: error tracking + breadcrumbs
  - Helicone: LLM cost tracking per tenant
  - Dead Letter Queue: WhatsApp message recovery
  - System Pulse: founder-only admin dashboard

- **i18n**
  - 6 idiomas: Español, English, Français, Deutsch, Italiano, Português
  - next-intl integration

- **Testing**
  - Vitest: 142+ unit tests
  - Playwright: E2E tests para voice, auth, appointments
  - pgTAP: 45+ RLS security tests en PostgreSQL

### Tech Stack

- Frontend: Next.js 15 (App Router), React 19, TailwindCSS, Framer Motion
- Backend: Vercel (Node.js) + Supabase Edge Functions (Deno)
- Database: Supabase PostgreSQL + Realtime
- LLM: Groq (Llama 3.1-8b, Llama 3.3-70b, Whisper)
- Queue: Upstash QStash + Redis
- Deploy: Vercel + Supabase

---

## Convenciones de Versioning

- **0.x.y** — Fase de desarrollo activo (pre-1.0)
- **0.MAJOR.0** — Feature releases (new capabilities)
- **0.x.MINOR** — Bug fixes, small improvements
- **0.x.PATCH** — Docs, refactor (no feature)

---

## Cómo Contribuir

1. Cada feature nueva genera un versioning bump
2. Todos los cambios técnicos deben reflejarse aquí ANTES de ser mergeados
3. Las PRs deben incluir una línea de CHANGELOG draft

---

## Links de Referencia

- [Roadmap y ADRs](docs/architecture/ARCHITECTURE_DECISIONS.md)
- [Guía de Testing](TESTING_GUIDE.md)
- [Seguridad](docs/security/SECURITY_AND_RATE_LIMITS.md)
