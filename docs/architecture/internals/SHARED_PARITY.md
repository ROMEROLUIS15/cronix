# Node/Deno parity (`supabase/functions/_shared/`)

## Problema

Las Edge Functions de Supabase corren en Deno. Las API routes / Server Actions de Next.js corren en Node. **No pueden importar el mismo módulo**:

- Deno requiere `.ts` explícito en relative imports (`./foo.ts`).
- Deno no entiende paths Next.js (`@/lib/...`).
- Node no entiende `Deno.env`, `Supabase.ai.Session`, `https://esm.sh/...`.

Pero ambos lados necesitan la misma lógica de IA: memoria, router, supervisor, observabilidad, training exporter.

## Decisión

Duplicar byte-by-byte bajo `supabase/functions/_shared/` con **parity tests** que fallan al menor drift.

```
lib/ai/memory/MemoryEngine.ts
    └─── duplicate ───►   supabase/functions/_shared/memory/MemoryEngine.ts
                          (idéntico modulo extension .ts en imports)

__tests__/ai/memory/parity.test.ts
    ├─ readFileSync('lib/ai/memory/MemoryEngine.ts')
    ├─ readFileSync('supabase/functions/_shared/memory/MemoryEngine.ts')
    ├─ normalize: strip ".ts" suffix from imports in the Deno version
    └─ assert: bytes equal
```

Si una persona modifica solo un lado, el test falla. El pre-push gate bloquea el push.

## Módulos duplicados

| Node | Deno | Parity test |
|---|---|---|
| `lib/ai/memory/` | `_shared/memory/` | `__tests__/ai/memory/parity.test.ts` |
| `lib/ai/router/` | `_shared/router/` | `__tests__/ai/router/parity.test.ts` |
| `lib/ai/supervisor/` | `_shared/supervisor/` | `__tests__/ai/supervisor/parity.test.ts` |
| `lib/ai/training/` | `_shared/training/` | `__tests__/ai/training/parity.test.ts` |
| `lib/ai/observability/` | `_shared/observability/` | `__tests__/ai/observability/parity.test.ts` |

`_shared/` también contiene utilities exclusivas para Deno que no necesitan parity:
- `_shared/booking-adapter.ts` — booking de WhatsApp en runtime Edge (vía RPCs de Supabase).
- `_shared/sentry.ts` — wrapper de Sentry para Deno.
- `_shared/supabase.ts` — admin client + DLQ logger.
- `_shared/tenant-guard.ts` — verificación de tenant para webhooks (el negocio viene del webhook HMAC, no de un usuario autenticado).
- `_shared/notifications/event-id.ts` — `eventId` determinista de notificación (espejo Deno del de Node).
- `_shared/database.ts` — tipos compartidos.

## Alternativas descartadas

- **Workspaces npm con build target Deno**: añade pipeline de bundling, latencia de deploy, debug doloroso.
- **Compilar Node → Deno con tsx**: el output no respeta los `.ts` extensions y rompe runtime.
- **Library externa publicada en jsr/deno.land**: añade un release cycle aparte; las parity tests siempre estarían un commit detrás.
- **Postal-style shared package**: ergonómico pero no resuelve la diferencia en imports de runtime libs (`@supabase/supabase-js` vs `esm.sh/...`).

La duplicación literal + parity test es la opción **más simple que funciona**.

## Cómo hacer cambios

1. Edita el archivo en `lib/ai/<module>/`.
2. Copia el contenido a `supabase/functions/_shared/<module>/`.
3. Ajusta las extensiones `.ts` en imports relativos del lado Deno.
4. Corre `npm test` (el parity test es parte de la suite).
5. Si falla, ajusta hasta que los bytes coincidan (modulo la regla de extensión).

Plan futuro: un script `npm run shared:sync` que automatice los pasos 2-3.

## Costo aceptado

- **Duplicación de líneas**: ~1500 líneas duplicadas hoy.
- **Disciplina de doble-edición**: mitigada por el parity test.
- **Ventaja**: cero magia, debug directo (cada lado se ejecuta en su propio runtime sin transpilación), zero-cost en runtime.
