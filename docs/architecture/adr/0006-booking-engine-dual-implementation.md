# ADR 0006: Per-Channel Booking Implementations (no shared engine)

## Status
**Revised (June 2026)** — supersedes the original "BookingEngine Dual Implementation" decision.

> **What changed:** The original ADR declared `lib/ai/core/booking/BookingEngine.ts`
> the Node.js "source of truth" that the dashboard delegated to, with the Deno
> `booking-adapter.ts` as a hand-ported mirror kept in sync by a contract-parity
> test. An architecture audit (June 2026) found that **none of this was wired**:
> `BookingEngine` was imported only by its own tests, and the claimed
> `contracts-parity.test.ts` did not exist. A deeper pass found that the Node AI
> tool layer the dashboard was assumed to use (`lib/ai/tools/appointment.tools.ts`
> + a ReAct planner) was **never wired to any live route either** — the dashboard's
> only live AI surface is the voice assistant. Both dead subsystems were removed
> (BookingEngine ~1,274 LOC; the Node AI text-agent ~1,450 LOC). This ADR now
> documents the booking architecture as it actually is.

## Context

Cronix creates/updates/cancels appointments from three surfaces, but only **two**
use an AI booking layer:

1. **WhatsApp** (Edge Function — Deno): client self-serves by **phone**; `businessId`
   comes from the HMAC-verified Meta webhook; client auto-created by phone in an RPC.
2. **Voice** (Edge Function — Deno): receptionist books by **name** from STT, with
   anti-hallucination corpus validation and ambiguity confirmation. This is the
   dashboard's only AI assistant (the floating voice button).
3. **Dashboard UI** (Next.js — Node.js): the owner books **manually** through forms
   → server actions → domain use-cases → repositories. No AI/LLM involved.

A single shared AI engine is **not possible across runtimes**: the two AI channels
run on Deno and cannot import Node.js modules (see ADR-0008). An earlier attempt to
designate a Node `BookingEngine` as the cross-channel SSOT could never be shared
with the Deno channels and went unused; a parallel Node AI tool layer
(`lib/ai/tools/appointment.tools.ts` + a ReAct planner) was likewise never wired to
a live route. Both were removed in the June 2026 audit.

## Decision

The two AI channels each own their booking implementation; the dashboard UI uses the
domain use-cases directly. There is **no shared booking engine** — the shared surface
is the **database** (RPCs + the `appointments` schema + conflict-detection
constraints), which all three surfaces converge on.

| Surface | Booking implementation | Client identity | Notes |
|---|---|---|---|
| WhatsApp (AI, Deno) | `supabase/functions/_shared/booking-adapter.ts` → RPC `fn_book_appointment_wa` / `fn_reschedule_appointment_wa` | phone | adapter delegates DB writes to RPCs |
| Voice (AI, Deno) | `supabase/functions/voice-worker/capabilities/{schedule,cancel,reschedule}/` | name (fuzzy) | corpus guards, ambiguity confirmation, write guard |
| Dashboard UI (Node) | server actions → `lib/domain/use-cases/*` → repositories | — | manual booking, no AI |

Business rules that MUST stay consistent (conflict detection, timezone math,
status transitions) live where they can be enforced once for everyone: in the
Postgres RPCs and in the `appointments` table constraints. Application code in
each channel handles only channel-specific orchestration.

## Consequences

- **Positive**:
  - No false single-source-of-truth; the code matches the docs.
  - Each channel evolves independently without a cross-runtime abstraction.
  - The real shared contract (DB schema + RPCs) is enforced by the database, not
    by developer discipline.
- **Negative**:
  - Conflict-check and timezone-conversion logic is implemented per AI channel
    (`booking-adapter.ts`, voice `time-format.ts`) and, for the dashboard UI, in
    the domain use-cases. Changes must be applied in each, or pushed into the RPCs.
  - No compile-time link between the channels — only the shared DB layer and
    tests keep them aligned.

## Alternatives Considered

1. **Node `BookingEngine` as cross-channel SSOT**: Tried and removed — Deno
   channels can never import it, and the dashboard never adopted it, so it was
   pure dead weight masquerading as the source of truth.
2. **Push ALL business rules into Postgres RPCs**: Partially adopted (WhatsApp
   already books via RPC). Full migration of dashboard + voice to RPC-only is a
   viable future step to make the DB the literal single source of truth.
3. **Port a shared engine to Deno**: Rejected — would create two diverging
   versions across runtimes with no automated sync.

---

*Signed: Systems Architect — revised after June 2026 architecture audit.*
