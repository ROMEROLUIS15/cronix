# AI agent failure threshold alert (observability Paso 2) → Sentry

## Objective
Push a Sentry alert to the operator when a business accumulates real AI-agent failures (voice or WhatsApp) in a short window, so a degradation is never discovered by opening a dashboard. Implements `docs/specs/modulo-observability/manifest.md` §5 (Paso 2), corrected to the real shape of `ai_traces`.

## Problem
- §5 was 🔴 "design, not implemented". Its query (`error_code IN ('LLM_EXCEPTION','rate_limited','TOOL_FAILURE','FAST_PATH_FAILURE')`) does not match the data:
  - `TOOL_FAILURE` / `FAST_PATH_FAILURE` / `GUARD_REJECTED` only live in `tool_calls[].errorCode` (jsonb), never in the `error_code` column.
  - Voice tools return `success:false` without a code both for real DB errors (`available-slots/tool.ts:52`) and for normal clarification turns (`cancel/tool.ts:52`) → `TOOL_FAILURE`/`FAST_PATH_FAILURE` are not a failure signal.
  - `rate_limited` comes from guards (voice 30 req/min per user, `voice-worker/index.ts:297`; WA `BOOKING_RATE_LIMIT`), not provider quota → counting it = false alarms.
  - Literal spec query would only catch voice `LLM_EXCEPTION`, already captured by Sentry (Paso 1).
- A forgotten global Slack alert exists (`supabase/migrations/20260605120000_ai_agent_error_alerts.sql`, from commit `efe9802`), never configured.

## Decisions (agent proposal accepted by user, 2026-10-05)
- Channel: **Sentry** (spec open decision #1).
- **Slack alert stays untouched** (user: "no elimines slack"). Both coexist; the manifest documents the difference.
- "Real failure" = allowlist, read from BOTH the `error_code` column and `tool_calls[].errorCode`, normalized by the prefix before `:`: `LLM_EXCEPTION`, `DB_ERROR`, `TOOL_EXECUTION_ERROR`; plus `outcome = 'error'`. Everything else (guards, `rate_limited`, `SLOT_CONFLICT`, `APPOINTMENT_NOT_FOUND`, `STT_NOISE`, `INVALID_ARGS`…) does not count.
- Voice tools mark Supabase errors with `error: 'DB_ERROR'` so voice is not blind.
- Host: pg_cron → Edge Function `cron-ai-alerts` (Bearer `CRON_SECRET` from Vault), same pattern as `cron-imminent-push`; it reuses `_shared/sentry.ts`.
- Values (spec defaults, calibrate later): window 10 min, threshold 3 failed turns per business, cooldown 60 min. One trace counts once.
- Cooldown + audit in a new table `ai_failure_alerts` (not the Slack table); one Sentry issue per business via fingerprint.

## Tasks
- [x] T1 Voice: `DB_ERROR` on Supabase errors in capabilities + single mapping helper for the trace tool-call `errorCode` (agent.ts fast path + voice-pipeline.ts) + tests.
- [x] T2 `_shared/sentry.ts`: `captureMessage` accepts an optional fingerprint.
- [x] T3 Migration: `ai_failure_alerts` table + `fn_claim_ai_failure_alerts()` (SECURITY DEFINER, service_role only) + `idx_ai_traces_created_at` + pg_cron schedule every 10 min + pgTAP (AC-1..AC-3, isolation, window, grants).
- [x] T4 Edge Function `cron-ai-alerts` (testable handler + `index.ts`) + Vitest (AC-4 auth, one Sentry message per claimed alert).
- [x] T5 `types/database.types.ts`: table + RPC.
- [x] T6 Docs: observability manifest §2/§5/§6 + header + Historial, INDEX Historial + coverage, cross-reference in `docs/operations/AI_AGENT_ALERTS.md`.
- [x] T7 Ops (user, after merge): apply migration in prod, deploy `cron-ai-alerts` (`--use-api`), pg_cron path at 200.
- [x] T8 Sentry delivery (user's account): the only workflow uses the legacy "all legacy integrations" action with no target (0 integrations); the user believes its last trigger (2026-10-05 00:50 UTC) sent no email. Replace it with an explicit email action and confirm with "Send test notification". Split out of T7 (2026-10-05): T7 was ticked on the rule's existence, not on observed delivery.

## Acceptance criteria
Spec §6 AC-1..AC-4 (rewritten to the real codes) + only the allowlist counts + per-business isolation + traces outside the window are ignored.

## TDD
Mode: not configured in project/session (source: none found, same as `wa-reminder-reply-routing.md`) → ordinary functional checks; new behavior ships with tests. Runners: Vitest for edge-function TS (`supabase/functions/**/__tests__`), pgTAP (`npx supabase test db`) for SQL, `deno check` for edge type-checking.

## Checks
- `npx vitest run supabase/functions/`
- `deno check` on `voice-worker/index.ts`, `cron-ai-alerts/index.ts` (with `DENO_NO_PACKAGE_JSON=1`)
- `npx supabase test db` (needs local Supabase; run `npx supabase migration up --local` first if the DB volume already existed)
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run knip`, `npm run check:spec-drift`

## Progress
- 2026-10-05: exploration and decisions done; document created. Engram mirror: **pending** (Engram tools unavailable this session).

- 2026-10-05 (writer): T1, T2, T4, T5, T6 done and checked. T3 (migration + pgTAP file) is written but left UNTICKED: pgTAP was not run (no local Supabase) — run `npx supabase test db` (expect 14 asserts in `ai_failure_alerts.test.sql`), then tick T3.
  Evidence: `npx vitest run supabase/functions/` 46 files/798 tests -> 49 files/814 tests, all green; `deno check` voice-worker 13 errors before and after (no new), cron-ai-alerts clean; `npm test` 143 files/1700 tests green; typecheck clean; lint 0 errors (2 pre-existing warnings); knip exit 0; spec-drift OK.
  Follow-up: voice `result` strings on DB errors leak raw `error.message` to TTS.

- 2026-10-05 (parent review): risk assessment `medium` → writer self-verification + parent spot check (`npx vitest run` cron-ai-alerts + voice core + db-error-code: 11 files / 232 tests green).
  T3: added `idx_ai_traces_created_at` (the claim is a cross-tenant time-window scan; all prior `ai_traces` indexes lead with `business_id` and the table has no retention). `npx supabase migration up --local` + `npx supabase test db`: 4 files / 161 tests PASS (14 new).
  Mutation check: the original AC-1 fixture had 1 trace per benign kind (below threshold 3), so a mutant counting `GUARD_REJECTED`/`FAST_PATH_FAILURE` still PASSED. Fixture rewritten (each benign kind ×3, + `REVIEWER_BLOCKED`, `BOOKING_RATE_LIMIT`). Now mutant 1 (guards/fast-path count) → 4/14 fail; mutant 2 (ignore `tool_calls`) → 4/14 fail; restored original → PASS.
  Docs: manifest documents the index and the claim-before-send trade-off (agent proposal, **pending user confirmation**); Slack "never configured" restated as the user's statement (prod job state unverified).

- 2026-10-05 (T7, ops): `cron-ai-alerts` and `voice-worker` deployed. A probe without credentials showed the gateway rejecting (`UNAUTHORIZED_INVALID_JWT_FORMAT`): `supabase/config.toml` was missing `[functions.cron-ai-alerts] verify_jwt = false` (pg_cron sends `Bearer CRON_SECRET`, not a JWT) → every cron call would have died before the handler. Fixed + redeployed; the probe now returns the handler's `{"error":"Unauthorized"}` (AC-4 in prod).
  Prod migration history: 14 June migrations live under other versions + 1 prod-only (`create_match_ai_memories_v2_fix_search_path`); mapping verified (97 vs 97) and handed to the user as `migration repair` (15 reverted / 14 applied) before `db push`.

- 2026-10-05 (T7, verified in prod): repair (15 reverted / 14 applied) → `db push --dry-run` showed only `20261005120000` → pushed. REST `ai_failure_alerts` → HTTP 200 `[]` (project `psuthbtdvprojdbsimvq`). `POST cron-ai-alerts` with `CRON_SECRET` → HTTP 200 `{"alerts":0}`. Edge `SENTRY_DSN`/`CRON_SECRET` digests == `.env.local`; Sentry project `javascript-nextjs` (id matches DSN).
  Sentry: the only issue workflow ("Alertas de Errores Whatsapp") fires on `first_seen_event` only (no level/tag filters, legacy notify action, 24h frequency) → the FIRST alert per business notifies; later incidents of the same business (same fingerprint) do NOT notify, even if the issue is resolved (no regression trigger). Pending a user decision.
  Not verified: Vault `cron_secret` == function `CRON_SECRET` (the pg_cron path) → user checks Invocations in the dashboard.

- 2026-10-05 (T7, pg_cron path verified via Supabase MCP, read-only): job 18 `cron-ai-alerts` (`*/10 * * * *`, active) ran at 16:40 and 16:50 UTC, both `succeeded`; `net._http_response` → HTTP 200 `{"alerts":0}` for both, no 401 → Vault `cron_secret` == function `CRON_SECRET`. T7 closed. Still open (user decision, their Sentry account): add a regression trigger so repeat incidents of an already-alerted business notify.

- 2026-10-05 (T8, Sentry MCP, user approved both changes): project auto-resolve is off, so `regression_event` would only fire after a manual resolve → dropped in favor of `every_event` + message filter (the DB cooldown already dedupes).
  Created workflow **6118587** "Agentes IA – fallos por negocio": `every_event`, action filter `message co ai_agent_failure_threshold`, email → account owner, frequency 60, all envs, source issue stream 6898739 (`javascript-nextjs`). Readback from the create response matches.
  Legacy `plugin` action on 3252024 replaced with email → account owner (readback from the update response matches).
  The user renamed the Sentry org `ibime` → `cronix-saas`; `.env.local` `SENTRY_ORG` updated, Vercel `SENTRY_ORG` pending (user).
  T8 stays open until an email is observed ("Send Test Notification" on 6118587 and on 3252024, or a real alert).
- 2026-10-05 (T8 closed): the user ran "Send Test Notification" on 6118587 and 3252024 → **two "Test Issue" emails received**. Delivery observed. Not yet exercised: the `message` filter of 6118587 (only a real `ai_agent_failure_threshold` event proves it). Manifest §5 "Paso operativo" rewritten to the real rule config (and why not new-issue + regression); `check:spec-drift` OK.

## Next step
Feature done. Open, outside this feature: Vercel `SENTRY_ORG` → `cronix-saas` (user); follow-ups (voice TTS leaks raw `error.message`; dead-man's switch for trace absence, not accepted yet). Commit only when the user asks.
