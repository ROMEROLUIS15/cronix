/**
 * Supabase Edge Function — process-whatsapp (entry point)
 *
 * Processes WhatsApp messages dequeued from QStash.
 * All pipeline logic lives in message-handler.ts.
 *
 * Module map:
 *  security.ts        ← QStash verification + message sanitization
 *  message-handler.ts ← full pipeline (routing, context, agent, notifications)
 *  guards.ts          ← rate limits, circuit breaker, token quota
 *  business-router.ts ← slug → business lookup + session anchoring
 *  context-fetcher.ts ← services, clients, appointments, history, slots
 *  appointment-repo.ts← create / reschedule / cancel
 *  audit.ts           ← logInteraction + createInternalNotification
 *  ai-agent.ts        ← runAgentLoop + transcribeAudio
 */

import { serve }          from "https://deno.land/std@0.168.0/http/server.ts"
import { initSentry }     from "../_shared/sentry.ts"
import { handleMessage }  from "./message-handler.ts"

initSentry('process-whatsapp')

serve(handleMessage)
