# Architecture Audit — Backlog & Follow-ups

Tracking doc for the June 2026 architecture audit. The audit removed two dead AI
subsystems, unified the notification contract, fixed timezone/notification bugs,
corrected the docs to the real architecture, and added a `knip` dead-code
guardrail. This file tracks what remains.

## Done ✅

- [x] Fixed 3 notification bugs (WhatsApp cancel date/serviceName; voice cancel/reschedule UTC→local).
- [x] Unified deterministic notification `eventId` across the 3 surfaces + idempotency via `UNIQUE(notifications.event_id)`.
- [x] Removed `BookingEngine` + resolvers + contracts + `TenantEnforcer` (~1,274 LOC, never wired).
- [x] Removed the Node AI text-agent (`appointment.tools.ts`, `client.tools.ts`, `crm.tools.ts`, `_helpers.ts`, `lib/ai/fuzzy-match.ts`, `planner.ts`) (~1,450 LOC, never wired to a live route).
- [x] Corrected docs to the real architecture: booking AI = **2 Deno channels** (WhatsApp + Voice); dashboard books manually; tenant isolation = **3 real layers** (filtered repos → RLS → constitutional reviewer).
- [x] `Pipeline.ts`: throw `PipelineTimeoutError` (was a generic `Error`) + `clearTimeout` the timer (was a leak).
- [x] DST/timezone round-trip tests (`voice-worker/core/__tests__/time-format.test.ts`, `process-whatsapp/__tests__/time-utils.test.ts`).
- [x] `knip` dead-code guardrail: config + `npm run knip` + informational CI step. Removed 5 unused deps (`ai`, `@ai-sdk/openai`, `react-hook-form`, `@hookform/resolvers`, `class-variance-authority`).

## Backlog

### A. Make the `knip` CI gate blocking (currently informational)

`npm run knip` reports a pre-existing backlog. Clear it, then drop
`continue-on-error: true` from the `Dead-code scan (knip)` step in `test.yml`.

- [ ] **Unused files (~22)** — triage `npm run knip`. Notable groups:
  - Node parity mirrors `lib/ai/{memory,observability,router}/*` (e.g. `EpisodicStore.ts`, `PgTraceSink.ts`, `hashing.ts`, `index.ts` barrels) — only some files are actually compared by `__tests__/ai/*/parity.test.ts`; decide whether to keep full mirrors (ADR-0008) or prune to the compared surface.
  - App leftovers: `lib/ai/types.ts`, `lib/hooks/use-fetch.ts`, `lib/constants/voice-agent.ts`, `lib/appointments/validate-double-booking.ts`, `lib/auth/password-lockout-alerts.ts`, `lib/domain/use-cases/DeleteClientUseCase.ts`, `components/ui/skeleton.tsx`, `app/[locale]/dashboard/clients/hooks/use-clients-list.ts`.
- [ ] **Unused exports (~50)** — e.g. most `notificationFor*` helpers in `lib/use-cases/notifications.use-case.ts`, `NOWPaymentsAPI`, several validation schemas. Verify before deleting (some are public API surface).
- [ ] **Unlisted deps** — `dotenv` (used in tests/scripts, not in `package.json`), `@typescript-eslint/eslint-plugin` (in `.eslintrc.json`). Add to `devDependencies` or ignore in knip.

### B. Verify the remaining "claimed" subsystems are wired (#2)

`knip` covered most of this. Still worth a runtime trace from a live entry point:

- [ ] **Payments** — `NOWPaymentsAPI` is flagged unused by knip. Confirm the NOWPayments crypto gateway is actually reachable (webhook route → handler) or remove it.
- [ ] **Memory / Router / Training / Observability** — confirm which are exercised by a live route/cron vs only by parity tests.

### C. Refactor `runAgentLoop` (#4) — dedicated PR

`process-whatsapp/ai-agent.ts:runAgentLoop` is a ~340-line god-function with ≥10
responsibilities (memory recall, intent, write-guard build, trace, ReAct loop,
embedded-`<function>` recovery, dedup, final-pass template selection, sanitize,
deterministic fallback, trace finish). It is **live** WhatsApp code — refactor it
in its own PR with focused tests, not bundled with other work.

- [ ] Extract: `recoverEmbeddedFunctionCall`, `selectFinalResponse` (template vs deterministic vs fallback), `buildWriteGuard`, the dedup/fingerprint loop.
- [ ] Keep behavior identical; cover the decision tree (success template, known-error deterministic message, empty-loop fallback) with unit tests before refactoring.

### D. Minor / nice-to-have

- [ ] Move the "Junior pitch / Senior pitch" narrative out of `TECHNICAL_DOCUMENTATION.md` into a separate `INTERVIEW.md` so it stops masquerading as architecture docs.
- [ ] `Pipeline.ts`: the `if` predicate swallows exceptions silently (skips the step). Consider recording the predicate error in `StepResult.error`.
- [ ] `voice-pipeline.ts` is a single-step pipeline — harmless over-abstraction; leave or inline.
- [ ] Optional: cross-tenant injection unit test for `lib/ai/with-tenant-guard.ts` (low value — the guard now only fronts `get_today_summary`; real isolation is RLS + repos, tested via pgTAP).
