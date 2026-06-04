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

### A. `knip` CI gate — now BLOCKING on dependencies ✅ (files/exports = warn backlog)

The `Dead-code scan (knip)` step in `test.yml` is now **blocking** on the high-signal
rules (`dependencies`, `unlisted`, `binaries`, `unresolved` = `error` in `knip.json`).
`files`, `exports`, and `types` are `warn` (reported, non-blocking) because the
remaining backlog is dominated by intentional public-API surface and a few knip
false positives. `npm run knip` exits 0.

Done:
- [x] Deleted 5 verified-dead files (0 importers incl. tests): `lib/auth/password-lockout-alerts.ts`, `lib/domain/use-cases/DeleteClientUseCase.ts`, `lib/appointments/validate-double-booking.ts`, `lib/hooks/use-fetch.ts`, `lib/constants/voice-agent.ts`.
- [x] Added `dotenv` devDep; tuned knip ignores for false-positive deps (`@vitejs/plugin-react`, `@typescript-eslint/eslint-plugin`, `@rushstack/eslint-patch`, `supabase` binary, `jimp`, `k6/http`).
- [x] Made the knip dependency check blocking in CI.

Remaining `warn`-level backlog (optional, not blocking):
- [ ] **Unused files (~13)** — mostly Node parity mirrors `lib/ai/{memory,observability,router}/*` (kept per ADR-0008; only some files are compared by parity tests), barrels (`lib/domain/index.ts`, `lib/domain/use-cases/index.ts`), `lib/ai/types.ts` (knip false positive — 97 real refs), `components/ui/{pwa-debug,register-sw,skeleton}.tsx`, `use-clients-list.ts`.
- [ ] **Unused exports/types (~60)** — `notificationFor*` reminder/whatsapp helpers, `NOWPaymentsAPI`, DTO types in `types/index.ts`, hook return-type interfaces. Verify before deleting — much is intentional API surface.

### B. Verify the remaining "claimed" subsystems are wired (#2)

`knip` covered most of this. Still worth a runtime trace from a live entry point:

- [ ] **Payments** — `NOWPaymentsAPI` is flagged unused by knip. Confirm the NOWPayments crypto gateway is actually reachable (webhook route → handler) or remove it.
- [ ] **Memory / Router / Training / Observability** — confirm which are exercised by a live route/cron vs only by parity tests.

### C. Refactor `runAgentLoop` (#4) — dedicated PR (partially started)

`process-whatsapp/ai-agent.ts:runAgentLoop` is a ~340-line god-function with ≥10
responsibilities (memory recall, intent, write-guard build, trace, ReAct loop,
embedded-`<function>` recovery, dedup, final-pass template selection, sanitize,
deterministic fallback, trace finish). It is **live** WhatsApp code — the rest of
the extraction belongs in its own PR with focused tests, not bundled with other work.

- [x] Extracted `recoverEmbeddedToolCall` → pure `tool-recovery.ts` (behavior-identical) **with real unit tests**.
- [x] Replaced the hollow `whatsapp-agent.test.ts` (it tested inline fakes, not the real code) with real tests of the 2-turn confirmation gate + the recovery helper. **This surfaced a real bug** (see below).
- [x] Extracted `selectFinalResponse` → pure `final-response.ts` with 20 characterization tests (4 branches × edge cases). PR: `feature/whatsapp-refactor-final-response`.
- [x] Extracted `buildWriteGuard` and `trackDedupCall` as private helpers in `ai-agent.ts`. Same PR.

> **Bug found & fixed while writing real tests:** `confirmation-gate.isAffirmative('sí')`
> returned `false` (and `'ajá'`, `'así es'`) because the trailing `\b` doesn't treat
> accented chars as word boundaries — so the gate ignored the most common Spanish
> affirmative. Fixed with an accent-safe boundary (mirrors `core/conversation/frame.ts`).

### D. Minor / nice-to-have

- [x] `Pipeline.ts`: the `if` predicate no longer swallows exceptions silently — it skips the step (fail-closed) but records the error in `StepResult.error`. Covered by a test.
- [x] Moved §28–29 narrative out of `TECHNICAL_DOCUMENTATION.md` (EN+ES) into `docs/INTERVIEW.md` + `docs/INTERVIEW_ES.md`. PR: `feature/split-interview-docs`.
- [ ] `voice-pipeline.ts` is a single-step pipeline — harmless over-abstraction; leave or inline.
- [ ] Optional: cross-tenant injection unit test for `lib/ai/with-tenant-guard.ts` (low value — the guard now only fronts `get_today_summary`; real isolation is RLS + repos, tested via pgTAP).

### E. RLS & DB audit (June 2026) — DONE ✅

- [x] pgTAP `critical_functions.test.sql`: plan count fixed 29→32 (3 password-lockout tests were added without bumping the count).
- [x] pgTAP `rls_policies.test.sql`: expanded 52→86 tests. Added cross-tenant isolation coverage for 11 tables added post-audit with no pgTAP coverage: `ai_memories_v2`, `ai_traces`, `ai_training_exports`, `entity_relationships`, `notifications`, `notification_subscriptions`, `saas_invoices`, `wa_sessions`, `appointment_services`, `failed_password_attempts`, `security_alerts`.
- [x] `seed.sql`: added `platform_admin` user (uid=...000003) to `auth.users` + `public.users` — required for `security_alerts` RLS policy tests.
- [x] `20260604000000_fix_dead_function_overload.sql`: dropped broken `fn_wa_report_service_failure(text,text,int)` overload that referenced nonexistent columns (`last_failure_at`, `circuit_state`, `error_message`); cleaned dead `v_window_start` variable from 3 rate-limiting functions. DB lint: 0 errors in own functions.
- [x] `Pipeline.property.test.ts`: filtered `__proto__`/`constructor`/`prototype` from fast-check dictionary keys — these prototype-polluting keys caused non-deterministic failures.
- [x] `.husky/pre-push`: audit switched to `--omit=dev` — `supabase` CLI devDep carries GHSA-x96m-c5fj-q75c with no fix, irrelevant to production bundle.

All 118 pgTAP tests pass. PR: `fix/pgtap-rls-audit`.
