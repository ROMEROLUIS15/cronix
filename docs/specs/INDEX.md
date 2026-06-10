# 📚 Índice SDD — Cronix

Este archivo es el **mapa de gobierno** del sistema Spec-Driven Development de Cronix.
Todo agente de IA o desarrollador que vaya a tocar código DEBE leer este índice primero para saber qué spec aplica a su área de trabajo.

---

## Regla de Oro

> Antes de generar, modificar o refactorizar código en cualquier módulo, el agente DEBE leer:
> 1. `constitution.md` — reglas globales que aplican a TODO el sistema
> 2. El `manifest.md` del módulo correspondiente — reglas específicas del dominio

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

---

## Árbol de Specs

```
docs/specs/
├── INDEX.md                          ← Estás aquí
├── constitution.md                   ← LEER SIEMPRE PRIMERO
├── modulo-whatsapp-citas/
│   └── manifest.md
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
└── modulo-dashboard/
    └── manifest.md
```

---

## Guía de Navegación por Tarea

| Si vas a tocar... | Lee estas specs |
|---|---|
| El agente de WhatsApp (`process-whatsapp/`) | `constitution.md` §3, §5, §6 + `modulo-whatsapp-citas` + `modulo-notificaciones` |
| Los Use Cases de citas (`lib/domain/`) | `constitution.md` §1, §2 + `modulo-citas-core` |
| Notificaciones push/realtime | `constitution.md` §3 + `modulo-notificaciones` |
| Pagos o suscripciones | `constitution.md` §1 + `modulo-pagos` |
| Autenticación o middleware | `constitution.md` §4 + `modulo-auth` |
| El Voice Agent (`voice-worker/`) | `constitution.md` §3 + `modulo-voice-agent` |
| El Dashboard (`app/[locale]/dashboard/`) | `constitution.md` §4 + `modulo-dashboard` |
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
| 2026-06-09 | Creación del INDEX.md. Constitution v3 + Manifest WhatsApp v3. Nuevos specs: notificaciones, citas-core, pagos, auth. |
| 2026-06-09 | Nuevos specs: modulo-voice-agent (Voice Worker) y modulo-dashboard (Dashboard UI). Actualización de cobertura al 🟢. |

