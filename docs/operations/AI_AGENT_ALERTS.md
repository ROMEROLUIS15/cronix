# AI Agent Alerting (Mejora 1)

Two complementary alert paths. They cover different failure shapes and live in
different places on purpose.

| Path | Detects | Where | Code? |
|------|---------|-------|-------|
| **Error-rate** | % of failed turns over a rolling 60m window crosses a threshold | Postgres (`pg_cron` over `ai_traces`) → Slack | Yes — `20260605120000_ai_agent_error_alerts.sql` |
| **Error chains** | Bursts of raw exceptions (`captureException` / `logger.error`) | Sentry Issue Alert → Slack/email | No — Sentry UI config |

Why split: the agent **never throws on a failed turn** — `Tracer` writes
`outcome` to `ai_traces` instead. Sentry has no visibility into those and no
denominator (total turns) to compute a rate, so the rate alert *must* run where
the data lives. Sentry still owns genuine exception bursts (provider SDK blowups,
unhandled edge-function errors), which it tracks natively.

---

## Path A — Error-rate alert (already coded)

Implemented in `supabase/migrations/20260605120000_ai_agent_error_alerts.sql`.

- `check_ai_agent_error_rate()` runs every 15 min via `pg_cron`.
- Window 60m, threshold **5%**, min volume **20 turns**, cooldown **60m**.
  All four are constants at the top of the function — tune as traffic grows.
- "Error" = `outcome IN ('failure','error')`. `rate_limited` is excluded (it is
  a capacity signal, not an agent failure).
- Every alert is logged to `public.ai_agent_alerts` (also the cooldown source of
  truth). The cron job posts to Slack only on the firing tick, so no spam.
- **Safe before provisioning:** with no Vault secret the function logs a `NOTICE`
  and returns — it does not error.

### One-time setup

1. Create a Slack **Incoming Webhook** (Slack → Apps → Incoming Webhooks → pick a
   channel, e.g. `#cronix-alerts`). Copy the `https://hooks.slack.com/services/...`
   URL.

2. Store it in Supabase Vault as `slack_alerts_webhook_url`:

   ```sql
   -- Supabase Dashboard → SQL Editor
   SELECT vault.create_secret(
     'https://hooks.slack.com/services/XXX/YYY/ZZZ',
     'slack_alerts_webhook_url',
     'Slack incoming webhook for ops alerts'
   );
   ```

3. Apply the migration (`supabase db push`). It registers the cron job. Verify:

   ```sql
   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'ai-agent-error-rate-check';
   ```

### Verify it works

```sql
-- Force a run regardless of schedule:
SELECT public.check_ai_agent_error_rate();

-- Inspect what fired (or didn't):
SELECT * FROM public.ai_agent_alerts ORDER BY created_at DESC LIMIT 5;

-- pg_net delivery status (HTTP response from Slack):
SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;
```

To smoke-test the Slack delivery path without waiting for real errors, lower
`c_threshold` / `c_min_volume` temporarily in the function, run it, then revert.

---

## Path B — Error-chain alert (Sentry, config only)

Genuine exceptions already reach Sentry (`captureException` in
`supabase/functions/_shared/sentry.ts`, `logger.error` on the Node side). Add an
Issue Alert — no code:

1. Sentry → **Alerts → Create Alert → Issues**.
2. Condition: *Number of events in an issue is more than* **N** *in* **1 hour**
   (start at N=10; tune to taste).
3. Optional filter: tag/fingerprint scoped to the agent (e.g. tag
   `component:ai-agent` if you set one via `setSentryTag`).
4. Action: send to **Slack** (`#cronix-alerts`) and/or email.
5. Save. Repeat with a stricter, faster variant for critical issues if needed
   (e.g. *more than 25 in 5 minutes* → immediate page).

> Note: `tracesSampleRate` (0.1 in prod) samples **performance traces**, not
> error events — Issue Alerts see the full error volume. Do **not** build the
> rate alert (Path A) on sampled performance spans; the denominator would lie.
> That is exactly why Path A reads the unsampled `ai_traces` table directly.

---

## Tuning notes

- **Too quiet on low traffic:** lower `c_min_volume` (e.g. 10). With 10 turns a
  single error = 10% → fires; accept the noise or keep 20.
- **Too noisy:** raise `c_threshold`, raise `c_min_volume`, or lengthen
  `c_cooldown`.
- **Per-tenant blowups** (one business failing while the global rate stays low):
  not covered here by design — global aggregate catches systemic issues. If a
  single-tenant alert becomes necessary, add a `GROUP BY business_id` variant
  with its own cooldown keyed by business.
