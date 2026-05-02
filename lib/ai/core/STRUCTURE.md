# Estructura de carpetas — lib/ai/core

## Estado actual vs. target

```
lib/ai/
├── core/                                    ← NUEVO (este PR)
│   ├── contracts/
│   │   ├── tool-result.ts                  ← NUEVO: ToolResult<T>, BookingData, ToolErrorCode
│   │   └── tool-schemas.ts                 ← NUEVO: Zod schemas canónicos + TOOL_DEFS para LLM
│   ├── security/
│   │   └── TenantEnforcer.ts               ← NUEVO: phantom type, verify() + verifyWebhook()
│   ├── booking/
│   │   ├── BookingEngine.ts                ← NUEVO: única fuente de verdad para operaciones
│   │   ├── ClientResolver.ts               ← NUEVO: byName, byId, byPhone
│   │   └── ServiceResolver.ts             ← NUEVO: by UUID + fuzzy + substring
│   ├── utils/
│   │   └── timezone.ts                     ← NUEVO: localToUTC, normalizeTime (canónico)
│   ├── FLOWS.md                            ← NUEVO: flujos end-to-end documentados
│   └── STRUCTURE.md                        ← este archivo
│
├── adapters/                                ← NUEVO
│   └── dashboard/
│       └── DashboardBookingAdapter.ts       ← NUEVO: thin wrapper RealToolExecutor→BookingEngine
│
├── agents/
│   └── dashboard/
│       ├── config.ts                        ← sin cambios
│       ├── index.ts                         ← sin cambios
│       ├── prompt.ts                        ← sin cambios
│       └── tools.ts                         ← actualizar: importar TOOL_DEFS de core/contracts
│
├── orchestrator/
│   ├── ai-orchestrator.ts                  ← sin cambios
│   ├── decision-engine.ts                  ← ajuste: fix fast-path D (client_name requerido)
│   ├── execution-engine.ts                 ← sin cambios
│   ├── state-manager.ts                    ← ajuste: Redis fallback a request cache
│   ├── orchestrator-factory.ts             ← ajuste: inyectar DashboardBookingAdapter
│   ├── tool-adapter/
│   │   └── RealToolExecutor.ts             ← @deprecated: delegar a DashboardBookingAdapter
│   └── ...
│
├── tools/
│   └── appointment.tools.ts                ← @deprecated: solo usar BookingEngine
│
├── with-tenant-guard.ts                    ← @deprecated: reemplazado por TenantEnforcer
└── ...

supabase/functions/
├── _shared/
│   ├── booking-adapter.ts                  ← NUEVO: WhatsAppBookingAdapter (Deno)
│   ├── tenant-guard.ts                     ← mantener por ahora (Deno no puede importar lib/)
│   └── ...
├── process-whatsapp/
│   ├── ai-agent.ts                         ← ajuste: llama WhatsAppBookingAdapter en vez de executeToolCall
│   ├── tool-executor.ts                    ← @deprecated: reemplazado por _shared/booking-adapter
│   └── ...
└── ...
```

## Archivos deprecados (no eliminar aún — migración incremental)

| Archivo | Reemplazado por | Cuándo eliminar |
|---|---|---|
| `lib/ai/tools/appointment.tools.ts` | `BookingEngine` | Cuando `RealToolExecutor` migre completo |
| `lib/ai/orchestrator/tool-adapter/RealToolExecutor.ts` | `DashboardBookingAdapter` | Cuando el factory use el adapter |
| `lib/ai/with-tenant-guard.ts` | `TenantEnforcer` | Cuando todos los tools migren |
| `supabase/functions/process-whatsapp/tool-executor.ts` | `_shared/booking-adapter.ts` | Cuando el agent use el adapter |

## Reglas de arquitectura

1. **Los channel adapters no contienen lógica de negocio.**
   Solo traducen: formato del canal → BookingEngine → formato del canal.

2. **BookingEngine nunca recibe `businessId: string` crudo.**
   Siempre recibe `TenantContext`. El compilador rechaza lo contrario.

3. **Los schemas Zod en `core/contracts/tool-schemas.ts` son la única fuente.**
   Los tool definitions para el LLM se generan a partir de `TOOL_DEFS`,
   no se escriben manualmente en cada adapter.

4. **`localToUTC` viene de `core/utils/timezone.ts`.**
   Cualquier otro archivo que implemente su propia conversión es un bug latente.

5. **`ToolResult<T>` es el único tipo de retorno de tools.**
   Los adapters no retornan strings ni objetos ad-hoc. Convierten ToolResult
   al formato específico de su canal (string para el LLM, JSON para WhatsApp).
```
