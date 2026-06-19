# 📚 Índice SDD — Cronix

Este archivo es el **mapa de gobierno** del sistema Spec-Driven Development de Cronix.
Todo agente de IA o desarrollador que vaya a tocar código DEBE leer este índice primero para saber qué spec aplica a su área de trabajo.

---

## 🚦 Protocolo de Arranque (GATE OBLIGATORIO — Ley Cero)

> **ANTES de generar, modificar o refactorizar una sola línea de código**, el agente DEBE leer, en este orden:
> 1. `constitution.md` — reglas globales que aplican a TODO el sistema.
> 2. El `manifest.md` del módulo que vas a tocar (ver la tabla **Mapa de Módulos** + la **Guía de Navegación por Tarea** más abajo).

**Reglas del gate (innegociables):**

1. **Sin excepción por "cambio pequeño".** El gate aplica a cada tarea de código, incluidas correcciones de una línea.
2. **Normativo manda sobre tu criterio.** Las cláusulas normativas del spec (contratos, invariantes, códigos de error, flujos) son ley: el código se adapta a ellas. Las cláusulas descriptivas (nombres de función, rutas de archivo, proveedor concreto) se siguen del código real actual.
3. **Divergencia → reportar, no improvisar.** Si el spec y el código difieren, detente y reporta la divergencia antes de escribir. No "elijas" en silencio.
4. **Zona sin spec → confirmar.** Si el área no tiene spec o está marcada 🔴, decláralo y pide confirmación antes de codificar — es alto riesgo de regresión.
5. **Declaración de lectura.** Al inicio de tu respuesta a cualquier tarea de código, declara qué specs leíste, ej: `SDD: constitution + modulo-pagos`. Si no puedes nombrarlos, NO has cumplido el gate y debes volver atrás. En los PRs, esta declaración se formaliza en `.github/pull_request_template.md`, que exige **citar la invariante concreta** que gobierna el cambio (no basta el nombre del módulo) — el revisor verifica que la cláusula citada corresponda al área tocada.

> Este protocolo es la **fuente canónica**. Las reglas always-on de cada agente solo lo invocan y refuerzan — no lo redefinen:
> - `.agent/rules/good-development-practices.md` — Antigravity (`trigger: always_on`)
> - `CLAUDE.md` — Claude Code (con `@import` de este índice)
> - `AGENTS.md` — opencode + clientes compatibles (modelos vía OpenRouter, etc.)
> - `.cursor/rules/sdd-gate.mdc` — Cursor (`alwaysApply: true`)
> - `.github/copilot-instructions.md` — VS Code / GitHub Copilot

---

## Mapa de Módulos

| Módulo | Spec | Cobertura | Código Principal |
|---|---|---|---|
| **Arquitectura Global** | [constitution.md](./constitution.md) | 🟢 95% | Todo el repo |
| **WhatsApp + Agendamiento Bot** | [modulo-whatsapp-citas/manifest.md](./modulo-whatsapp-citas/manifest.md) | 🟢 92% | `supabase/functions/process-whatsapp/` |
| **Notificaciones** | [modulo-notificaciones/manifest.md](./modulo-notificaciones/manifest.md) | 🟢 90% | `supabase/functions/process-whatsapp/notifications.ts`, `lib/notifications/` |
| **Citas Core (Domain)** | [modulo-citas-core/manifest.md](./modulo-citas-core/manifest.md) | 🟢 90% | `lib/domain/use-cases/` |
| **Pagos y Suscripciones** | [modulo-pagos/manifest.md](./modulo-pagos/manifest.md) | 🟢 88% | `lib/payments/` |
| **Autenticación** | [modulo-auth/manifest.md](./modulo-auth/manifest.md) | 🟢 85% | `lib/auth/`, `middleware.ts` |
| **Dashboard UI** | [modulo-dashboard/manifest.md](./modulo-dashboard/manifest.md) | 🟢 90% | `app/[locale]/dashboard/`, `components/layout/`, `components/dashboard/` |
| **Agente de Voz** | [modulo-voice-agent/manifest.md](./modulo-voice-agent/manifest.md) | 🟢 92% | `supabase/functions/voice-worker/` |
| **Observabilidad de Agentes** | [modulo-observability/manifest.md](./modulo-observability/manifest.md) | 🟡 70% | `supabase/functions/_shared/observability/`, `_shared/sentry.ts`, `app/[locale]/dashboard/observability/` |

---

## Árbol de Specs

```
docs/specs/
├── INDEX.md                          ← Estás aquí
├── constitution.md                   ← LEER SIEMPRE PRIMERO
├── modulo-whatsapp-citas/
│   ├── manifest.md
│   └── operacion-canonica.md      ← contrato normativo de punta a punta del agente
├── modulo-notificaciones/
│   └── manifest.md
├── modulo-citas-core/
│   └── manifest.md
├── modulo-pagos/
│   └── manifest.md
├── modulo-auth/
│   └── manifest.md
├── modulo-voice-agent/
│   └── manifest.md
├── modulo-dashboard/
│   └── manifest.md
└── modulo-observability/
    └── manifest.md
```

---

## Guía de Navegación por Tarea

| Si vas a tocar... | Lee estas specs |
|---|---|
| El agente de WhatsApp (`process-whatsapp/`) | `constitution.md` §3, §5, §6 + `modulo-whatsapp-citas` (+ **`operacion-canonica.md`**) + `modulo-notificaciones` |
| Los Use Cases de citas (`lib/domain/`) | `constitution.md` §1, §2 + `modulo-citas-core` |
| Notificaciones push/realtime | `constitution.md` §3 + `modulo-notificaciones` |
| Pagos o suscripciones | `constitution.md` §1 + `modulo-pagos` |
| Autenticación o middleware | `constitution.md` §4 + `modulo-auth` |
| El Voice Agent (`voice-worker/`) | `constitution.md` §3 + `modulo-voice-agent` |
| El Dashboard (`app/[locale]/dashboard/`) | `constitution.md` §4 + `modulo-dashboard` |
| Trazas, captura de errores o alertas de agentes IA | `constitution.md` §3, §6 + `modulo-observability` |
| Cualquier Edge Function | `constitution.md` §3 (void/waitUntil), §5 (QStash), §6 (DLQ) |
| Cualquier query a DB | `constitution.md` §4 (business_id obligatorio) |

---

## Convención de Madurez de Specs

| Indicador | Significado |
|---|---|
| 🟢 80-100% | Spec completo y verificado contra código. Seguro para SDD. |
| 🟡 50-79% | Spec parcial. Usar con precaución — puede haber gaps. |
| 🔴 0-49% | Sin spec o muy incompleto. Alto riesgo de regresión. |

---

## Historial de Versiones

| Fecha | Cambio |
|---|---|
| 2026-06-18 | Nuevo spec normativo **`modulo-whatsapp-citas/operacion-canonica.md`**: fuente única de la operación de punta a punta del agente de WhatsApp. Fija invariantes C1 (una sola confirmación al cliente), O1/O2 (notificación automática al dueño + campana + push en agendar/reagendar/cancelar), N1 (nombre real del cliente, no `Cliente <n>`), R1–R3 (recordatorio diario a las 20:00 hora local del negocio, país-agnóstico, que habilita reagendar/cancelar) y la regla de invalidación de caché del dashboard en toda escritura WA. Documenta los defectos D1–D5 observados (doble confirmación, cita ausente del calendario, reagendamiento sin notificar al dueño, notificaciones con error, nombre placeholder) mapeados a su causa raíz y estado. Pendiente: corrección de D1–D5 en código. |
| 2026-06-17 | i18n Fase 3 (revisión de calidad nativa por idioma, los 6 locales): **DE** unificado a registro informal `du` (56 strings formales `Sie`→`du` con gramática correcta; elegido por el dueño) + anglicismo `observability.turns`→"Durchläufe"; **FR** abreviaturas de mes `Jun/Jul`→`Juin/Juil` (resto ya localizado), registro `vous` ya consistente; **IT** concordancia de género `clients.form.legacyPhoneDesc` "alla prossima salvataggio"→"al prossimo salvataggio", registro `tu` ya consistente; **PT/EN** ya limpios (sin leftovers de español). Sin cambios de claves (parity 14 tests verdes). |
| 2026-06-17 | fix(setup/auth): registro con Google no podía crear negocio. `fn_create_business_and_link_owner` tenía DOS overloads en prod (7-arg huérfano de `20260420000001` + 8-arg con `p_referral_code` del referral system) porque `CREATE OR REPLACE` con firma cambiada crea overload nuevo, no reemplaza. La llamada de 7 args nombrados de `SupabaseBusinessRepository.createWithOwnerLink` quedaba ambigua → PostgREST PGRST203, el INSERT nunca corría. Solo afectaba a Google (email auto-crea negocio desde metadata vía `businesses.create()`, sin RPC). Fix: drop del overload huérfano (`20260617000000`, aplicado en prod). Mismo patrón que `20260604000000`. |
| 2026-06-17 | modulo-dashboard §7 (nuevo, NORMATIVO): contrato i18n — cero texto hardcoded visible (server→`getTranslations`, client→`useTranslations`, formato locale-aware), paridad de claves obligatoria entre los 6 locales (`es` fuente). Fix bug: `nav.plans` faltaba en pt/fr/de/it (clave muerta `nav.referrals`). Migrados a i18n + traducidos ×6: dashboard (observability, finanzas, header, paneles, appointments/new, voice-fab, payment-modal…), auth/público (invite, passkey-login), componentes UI/PWA (modal, session-timeout, client-select, phone-input, banners PWA). Guard `__tests__/i18n/parity.test.ts`. Typos ES corregidos en privacy ("se serán"→"serán", "Oponermi"→"Oponerte") y terms ("Agreeings:"→"Acuerdas lo siguiente:"). **Páginas legales `privacy`+`terms` migradas ×6** (`t.raw` listas + `t.rich` links, server components async). Toda la superficie de cara al usuario queda i18n'd (44 namespaces ×6); solo resta revisión nativa de calidad por idioma. Excluido por decisión: admin (inglés interno), marca (`Free/Pro/Enterprise`), debug (`pwa-debug`). Nota: traducción legal = boilerplate, conviene revisión jurídica por jurisdicción. |
| 2026-06-15 | constitution.md §7 (nuevo): "Documentación y Trazabilidad" — toda tarea de código cierra actualizando el manifest/spec afectado (y este Historial si es relevante para el sistema). Auditoría de honestidad doc↔código en README, AI_SYSTEM.md, TESTING.md, TECHNICAL_DOCUMENTATION(.md/_ES.md) y `.env.local.example` (tests 1.410/118 archivos, pgTAP 138 asserts, 85 migraciones, referidos vía RPC `fn_apply_referral_bonus`, fila Retención/win-back, capabilities 9→12, reviewer rubric v4 + hard-block en `delete_client`). |
| 2026-06-15 | Nuevo spec: **modulo-observability** (trazas dual-sink, captura Sentry en voice-worker desplegada, dashboard pasivo, y contrato 🔴 del Paso 2: alerta de umbral sobre `ai_traces`). modulo-voice-agent: documentadas como normativas §3 (parseDateExpression prefer), §4 (getServices fast path), AC-6 (nearest), §8 (coerceToolArgs). |
| 2026-06-09 | Creación del INDEX.md. Constitution v3 + Manifest WhatsApp v3. Nuevos specs: notificaciones, citas-core, pagos, auth. |
| 2026-06-09 | Nuevos specs: modulo-voice-agent (Voice Worker) y modulo-dashboard (Dashboard UI). Actualización de cobertura al 🟢. |
| 2026-06-12 | modulo-voice-agent §8: capa antialucinación (frame corpus, mention guards por token, filtro de args declarados, write-guard en delete_client, invariantes de available-slots/delete_client/smart_schedule, códigos GUARD_REJECTED). |
| 2026-06-12 | modulo-voice-agent: 12ª capability `get_client_appointments` (citas futuras por cliente). Supervisor: rúbrica v2 con `conversationWindow` + memoria episódica desde voz (espejos Node/Deno en paridad). |
| 2026-06-12 | modulo-voice-agent §9: dimensión de staff — asignación por nombre ("con Marielys"/"conmigo"), `assigned_user_id` en writes de voz, `findConflicts` per-staff. Sin nombrar → NULL (política default queda para el sprint multi-empleado). |
| 2026-06-13 | modulo-voice-agent §7: equivalencia de clase vocal (`vowelClassKey`, i↔e/o↔u) sobre la clave fonética — resuelve confusión vocal del STT para cualquier nombre, preservando precisión por consonante. Detectores fast-path (próxima-cita/servicios) normalizados + ampliados. |
| 2026-06-13 | cross-cutting: invalidación de caché del dashboard centralizada en `_shared/cache-invalidation.ts` (un solo seam). Cierra el MISMO hueco en WhatsApp (`process-whatsapp/appointment-repo.ts` book/reschedule/cancel) que ya se tapó en voz; voz ahora importa del shared (sin duplicar). |
| 2026-06-13 | modulo-voice-agent: `parseDateExpression` gana modo `prefer` ('future' default / 'nearest'). `list-appointments` usa 'nearest' → "qué citas tuve el 9 de junio" resuelve al día más cercano (4 días atrás), no al próximo año. Arregla "no encuentra citas por fecha pasada"; schedule/cancel/reschedule siguen en 'future'. |
| 2026-06-13 | modulo-voice-agent §8: invalidación de caché cross-canal — toda escritura de voz exitosa invalida el caché Upstash del dashboard (`clients`/`appointments`/`dashboard`) vía `invalidateDashboardCache`. Arregla "creo cliente por voz y no aparece en el dashboard hasta 3 min" (el insert de voz no pasaba por el repo Node que invalida). |
| 2026-06-13 | modulo-voice-agent §8: hard-block del reviewer acotado SOLO a `delete_client` (único write destructivo); book/cancel/reschedule degradan el veto a warn (ya cubiertos por guards deterministas + findConflicts). Rúbrica v4: regla 7 (create→book es normal) + regla 8 (cancelar/reagendar tras agendar = cambio de planes, no contradicción/duplicado). Arregla REVIEWER_BLOCKED falso al agendar y al cancelar. |
| 2026-06-13 | (reemplazado por la entrada de arriba) modulo-voice-agent §8: hard-block en destructivas (cancel/reschedule/delete); rúbrica v3 regla 7. |
| 2026-06-14 | modulo-retencion Fase 6 (dashboard): Card de retención en Settings con toggle + modal de frecuencia (default 30 → `default_attendance_frequency_days`; toggle → `settings.retention`). Plan-gated con `canAccessRetention` (free = botón bloqueado + upsell). i18n `settings.retention.*` en los 6 locales. |
| 2026-06-14 | modulo-retencion Fase 5 (opt-out): migración `retention_opted_out` + RPC con exclusión (aplicadas en prod). Node `setRetentionOptOut` (match por phone_digits). Deno `process-whatsapp/retention-optout.ts` (`isOptOutRequest` determinista + `markRetentionOptOut`) conectado en `message-handler` como intercept. Tests Node+Deno. Pendiente: deploy de process-whatsapp. |
| 2026-06-14 | modulo-retencion Fase 4 (enfoque A): route `POST /api/cron/retention` (auth CRON_SECRET, service-role) corre `ProcessRetentionUseCase` por negocio; `findRetentionEnabledIds()` en business repo; adapter `WinbackMessenger` (`template:'client_winback'`); migración pg_cron `20260614130000` escrita **sin aplicar** (paso ops). Tests adapter + repo. |
| 2026-06-14 | modulo-retencion Fase 3: use-cases `GetEligibleClientsUseCase` + `ProcessRetentionUseCase` en `lib/domain/use-cases/retention/` (puerto `IRetentionMessenger`, helper `canAccessRetention`). Tests AC-5/6/7/11 con mocks. Adapter del puerto + wiring quedan para Fase 4 (cron). |
| 2026-06-14 | modulo-retencion Fase 2: `findInactiveByFrequency` + `updateLastReengaged` implementados (repo + interfaz + tests). `setRetentionOptOut` diferido a Fase 5 (columna `retention_opted_out` sin migrar). Tipos: alta manual del RPC `get_reengageable_clients_rpc` + columnas v1 en `database.types.ts` (regen completo descartado — el archivo se mantiene a mano). |
| 2026-06-13 | modulo-voice-agent §7: `last-visit` reclasificado como **read sensible** — aplica el gate de confianza de writes (`found` <0.80 → reconfirma "¿confirmas?/¿a quién te refieres?"). Match de token exacto/fonético sigue pisando a 0.90, así que el acierto responde 100% directo y solo el match débil pregunta. Prompt determinista (`bypassLLM`) → sin coste de tokens. |

