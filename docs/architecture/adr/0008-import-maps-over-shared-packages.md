# ADR 0008: Import Maps over Shared Packages (Turborepo)

## Status
**Accepted (May 2026)**

## Context

Cronix has two runtime environments with different module resolution:

- **Node.js** (Next.js dashboard): Uses `@/` path aliases, standard npm resolution
- **Deno** (Supabase Edge Functions): Uses URL imports (`https://esm.sh/...`) or bare specifiers resolved via import maps

Shared code between WhatsApp and Voice Edge Functions lives in `supabase/functions/_shared/`. However, sharing code with the Node.js dashboard requires either:
- A shared npm package (Turborepo, npm workspaces)
- Copying code across environments
- A build step that transforms imports

## Decision

We use **Deno Import Maps** as the sharing mechanism for Deno → Deno sharing, and accept the Node.js/Deno boundary as a natural seam.

### For Deno → Deno sharing (Edge Functions):

```
supabase/import_map.json  ← single source of truth for shared deps
  zod → https://esm.sh/zod@3.23.8
  @supabase/supabase-js → https://esm.sh/@supabase/supabase-js@2.39.7
  @upstash/qstash → https://esm.sh/@upstash/qstash@2.7.1

supabase/functions/process-whatsapp/deno.json  ← imports from root map
supabase/functions/voice-worker/deno.json       ← imports from root map
```

Edge Functions use bare specifiers (`import { z } from 'zod'`) resolved by the import map. The root import map version is the single source of truth.

### For Deno ↔ Node.js sharing:

No shared package, and **no shared booking engine** — the Node ↔ Deno boundary is
accepted as a hard seam. Each channel implements its own booking orchestration
(see ADR-0006); the only thing genuinely shared across the runtime boundary is
the **database** (RPCs + `appointments` schema + constraints), which both runtimes
call into.

Where a small, pure contract must stay identical on both sides (e.g. the
deterministic notification `event_id` format), it is duplicated as a tiny mirror
— `supabase/functions/_shared/notifications/event-id.ts` (Deno) and
`lib/notifications/appointment-event-id.ts` (Node) — and pinned by a parity test
(`__tests__/notifications/appointment-event-id.test.ts`). This is only worthwhile
for trivial, stable string contracts, not for full business logic.

### Why not Turborepo?

1. **Edge Functions cannot install npm packages** in the Supabase managed runtime — they must use import maps or URL imports.
2. **Turborepo adds ~50MB of dev dependencies** for a benefit (shared TypeScript compilation) that import maps already solve for Deno.
3. **The Node.js ↔ Deno boundary is small** — only tiny string contracts (e.g. the notification `event_id`) are mirrored across runtimes. A full monorepo tool would be overkill.

## Consequences

- **Positive**:
  - Zero additional infrastructure for sharing (no Turborepo, no npm workspaces)
  - Import maps resolve at deploy time — no build step needed
  - Version bumps are a single line change in `import_map.json`
  - Small cross-runtime contracts (e.g. notification `event_id`) are pinned by a parity test
- **Negative**:
  - Node.js and Deno code cannot share types directly — types must be duplicated or generated
  - Booking business rules are implemented per channel; consistency relies on the
    shared DB/RPC layer plus per-channel tests, not on a shared module
  - Import maps are Deno-specific — if we migrate off Deno, the sharing mechanism changes

## Alternatives Considered

1. **Turborepo + npm workspaces**: Rejected — adds complexity without solving the Edge Function constraint. Edge Functions cannot import from npm packages in production.
2. **Deno `npm:` specifier**: Available in Deno 2.x but Supabase Edge Functions use Deno 1.x. Not compatible.
3. **Copy-on-write with CI checks**: Current approach for Deno→Deno — files in `_shared/` are the shared surface. For the few cross-runtime string contracts, a parity test pins the duplicated mirrors.
4. **`esm.sh` URL imports directly**: Original approach (pre-Fase 0). Inconsistent versions across files — import maps fix this.

---

*Signed: Systems Architect*
