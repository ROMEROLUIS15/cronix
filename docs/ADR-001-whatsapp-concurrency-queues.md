# Architecture Decision Record (ADR): WhatsApp Webhook Message Queueing

## Context
Our WhatsApp AI bot uses Groq API (running LLAMA models) to answer customer queries. When a customer sends a message on WhatsApp, Meta sends an HTTP POST request to our Supabase Edge Function (`whatsapp-webhook`).

The core problems we faced:
1. **Timeout Restrictions:** Meta's webhook spec requires a `200 OK` response within 3 seconds. Otherwise, Meta assumes the request failed and initiates exponential retries, leading to duplicate messages.
2. **Concurrency Colission:** Processing the conversation through the AI, parsing action tags (`[CONFIRM_BOOKING...]`), and writing to the database synchronously takes >3 seconds.
3. **Traffic Spikes:** If 30+ clients message the bot simultaneously, the Supabase Edge Function might time out or exceed Groq API rate limits (HTTP 429), resulting in catastrophic message loss since there was no retries mechanism for the actual AI processing layer.

## Decision
We elected to implement a **Serverless Queueing Architecture using Upstash QStash** (Option 2), rather than handling the processing synchronously or using native PostgreSQL queues (via `pg_net` or `pg_cron`).

### Architecture Changes
1. **Dumb Receiver (`whatsapp-webhook`):** 
   - The original webhook was stripped of all business logic.
   - It only validates Meta's HMAC signature `x-hub-signature-256`.
   - It acts purely as a proxy, immediately forwarding the raw JSON payload to QStash via `fetch`.
   - It responds with a `200 OK` to Meta in ~50ms max.

2. **Durable Queue (QStash):** 
   - QStash ingests the message reliably.
   - It provides out-of-the-box concurrency limits (so we don't bombard Groq API) and exponential backoff retries if the Edge Function fails or timeouts.

3. **Background Processor (`process-whatsapp`):**
   - A newly created Supabase Edge Function that acts as the real webhook handler.
   - It is triggered exclusively by QStash and verifies the `Upstash-Signature` to prevent spoofing.
   - It executes the heavy business logic: downloading audio chunks, LLM inference, tenant routing, rate limits checking, and Database insertions.

## Consequences

**Positive:**
- **Zero Message Loss:** Traffic spikes are buffered by QStash.
- **No Duplicate Ghost Messages:** Meta receives its 200 OK immediately.
- **Protection Against AI Outages:** If Groq goes down temporarily, QStash will automatically retry the webhook later.
- **Observability:** Upstash provides a visual dashboard for our Edge workers' incoming queues.

**Negative:**
- **New Dependency:** The application now relies on Upstash.
- **Environment variables overhead:** Required adding `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`, and `PROCESS_WHATSAPP_URL` to local and production `.env` files.

## Alternatives Considered
- **Native Supabase Database Queues:** Saving the payload into a `wa_messages` table and triggering a PostgreSQL webhook (`pg_net`) or cron (`pg_cron`). Discarded because `pg_net` can overwhelm downstream AI limits under high concurrency without extra manual throttling mechanisms, while `pg_cron` introduces up to 1-minute artificial delay.

*Document finalized on: March 31, 2026*
