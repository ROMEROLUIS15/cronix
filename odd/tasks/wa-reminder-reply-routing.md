# WA reminder replies: routing, cancel intent, observability

## Objective
Client replies to the 20:00 reminder ("no podré asistir") must reach the WhatsApp agent, run the deterministic cancel flow and notify the owner. Every drop on that path must leave a pushed signal.

## Problem (prod evidence, 2026-10-05)
- Last WhatsApp row in `ai_traces` / `wa_audit_logs`: 2026-07-29 19:30 UTC. QStash keeps delivering replies to `process-whatsapp` (HTTP 200) minutes after each reminder.
- `cron-reminders` never anchors `wa_sessions`; 0/14 reminded clients had a session (table has 3 rows). Replies without `#slug` fall to the generic landing (`message-handler.ts:212-220`) with no trace. Violates operacion-canonica **R2 / AC-R2**.
- `CANCEL_RE` (`intents.ts:21`) only knows `cancel*/anul*/borr*`; "no podré asistir" never reaches the cancel flow.
- Owner WA templates are REJECTED in Meta; `sendOwnerWhatsApp` records nothing when it degrades to the 24h-window free-text fallback.

## Scope (authorized by user 2026-10-05: points 1–3)
1. Routing: anchor session on reminder send + fallback routing by client phone.
2. Observability: push a signal for unrouted messages and for owner-WA template failure.
3. Cancel intent: recognize "can't attend" phrasing, outside new-booking/reschedule sub-dialogues.

Out of scope: re-submitting Meta templates (manual, Business Manager); `daily_owner_summary` template missing; async Meta delivery failures via `statuses` webhook.

## Decisions / trade-offs (agent proposal accepted by user)
- Session upsert on reminder send: last reminder wins if a phone belongs to several businesses.
- Fallback routing tier (new tier 3, landing becomes 4): match `clients.phone_digits` (+ trunk-zero alt form, same heuristic as `fn_find_client_by_phone`) across businesses; 1 business → route; >1 → business with the soonest upcoming non-cancelled appointment; otherwise landing (never guess).
- Unrouted messages and owner-template failure go to Sentry (warning) — `ai_traces` requires `business_id`, which an unrouted message lacks.
- "Can't attend" is a separate predicate wired only into the cancel branch (C); strict `MANAGE_EXISTING_RE` and the reschedule sub-dialogue guard stay unchanged.

## Tasks
- [x] T1 Shared WA phone helper (`_shared/`): canonical sender id + candidate forms, pure + tested.
- [x] T2 `cron-reminders`: upsert `wa_sessions` for each successfully sent reminder.
- [x] T3 `business-router`: fallback routing by client phone + wire into `message-handler` tenant routing; anchor session on match.
- [x] T4 Sentry `captureMessage` helper; warning on unrouted message; warning on owner-WA template failure / undelivered.
- [x] T5 `intents.ts`: can't-attend predicate + wiring in `booking-flow` (C) + tests (incl. negative mid-booking / mid-reschedule).
- [x] T6 Docs: WA manifest §1 (4-tier routing), operacion-canonica (R2 restored, D4 status), observability manifest, INDEX Historial.

## TDD
Mode: not configured in project/session (source: none found) → ordinary functional checks; new behavior ships with tests. Runner: **Vitest** for edge-function tests too (`supabase/functions/**/__tests__` are Vitest files, run by `npm test`; there is no `Deno.test` in the repo — `deno test` fails type-checking them, pre-existing). `deno check` for edge type-checking.

## Checks
- `npx vitest run supabase/functions/` (baseline: 44 files / 773 tests green)
- `deno check` on `process-whatsapp/index.ts`, `cron-reminders/index.ts`
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run knip`, `npm run check:spec-drift`

## Progress
- 2026-10-05: diagnosis done; document created. Engram mirror: **pending** (Engram tools unavailable this session).
- T1: `_shared/wa-phone.ts` (`toWaSenderId`, `waSenderCandidates`) — trunk-zero rule tightened to 9–10 trailing digits so NANP (+1 202…) is never rewritten. `wa-phone.test.ts` 9/9; mutation (drop the length guard) → 3 tests fail.
- T2: `cron-reminders/modules/session-anchor.ts` upserts `wa_sessions` after a successful reminder send (best-effort, Sentry on failure). `db.ts` typed as `SupabaseClient` (stale `@deno-types` removed). Cron `deno check`: baseline 8 errors; with `DENO_NO_PACKAGE_JSON=1` (runtime-like resolution, no root package.json) now 2 pre-existing unrelated errors, none new. Plain `deno check` (root package.json → node_modules resolution) now aborts resolving `npm:@sentry/deno` — `_shared/sentry.ts` is type-checked for the first time from the cron graph (before, a misplaced `@deno-types` in `index.ts` masked the Sentry import). Runtime unaffected: `index.ts` already loaded `sentry.ts`.
- T3: routing extracted to `tenant-routing.ts` (`resolveTenant` 4 tiers + `replyUnrouted`); tier 3 `getBusinessByClientPhone` in `business-router.ts` (dedup `getBusinessById`); pure decision `client-phone-routing.ts` 7/7 tests. `message-handler.ts` 296 → 281 lines.
- T4: `captureMessage` in `_shared/sentry.ts`; warning `wa_unrouted_message` (shape only, no content); `sendOwnerWhatsApp` reports `owner_wa_template_failed` (warning) / `owner_wa_undelivered` (error) with the whatsapp-service error string; owner phone lookup now checks `error`. `deno check process-whatsapp/index.ts` clean; edge Vitest 46 files / 789 tests green.

- T5: `isCantAttendIntent` (separate `CANT_ATTEND_RE`, folded) wired only into branch (C) of `resolveBookingTurn`; `CANCEL_RE`, `MANAGE_EXISTING_RE`, reschedule guard and `inBookingContext` untouched. Tests: intents +3, booking-flow +5 (positive, confirm → `executeCancel`, mid-booking / mid-reschedule negatives, "no puedo ir, ¿lo cambiamos…?" stays reschedule), golden eval +1 ("no podré asistir" → cancel, full pipeline) → 8/8. Mutations: unwiring → positive fails; adding it to the reschedule guard → mid-reschedule negative fails. No voice/Node parity mirror of `intents.ts` exists.
- T6: WA manifest §1 (4 tiers + trade-offs), operacion-canonica (R2 detail, D4 status: templates REJECTED 2026-10-05, new D6, AC-R2, D1–D6), observability §3 (+ Historial), notificaciones §4 canal 3, INDEX Historial row. CRLF preserved (node count, LF=0).
- Final checks: `npm test` 140 files / 1684 tests green (+25); `npm run test:evals:agent` 8/8; `npm run typecheck` clean; `npm run lint` 0 errors (2 pre-existing warnings, other files); `npm run knip` exit 0 (no findings in new files); `npm run check:spec-drift` OK; `deno check process-whatsapp/index.ts` clean; cron see T2.

- Parent verification: RDD off → `gentle-ai review assess` = **medium** (writer on full model → self-verification + spot check). Spot check `npx vitest run` over wa-phone / client-phone-routing / intents / booking-flow / conversation-evals: 5 files, 77 tests green. Diff readback OK; `appointment_status` enum confirmed to include `pending`/`confirmed`. Residual (unverified): Sentry signals emitted from the `void emitBookingEvent` chain may be cut if the isolate ends before flush (pre-existing pattern, constitution §3).

## Next step
Deploy `process-whatsapp` + `cron-reminders` (`--use-api` from Windows) — user decision. External: get an owner-event template approved in Meta (D4). Engram mirror still pending.
