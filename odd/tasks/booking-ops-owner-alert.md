# Booking operations: owner WhatsApp alert, day list refresh, and a per-surface verification matrix
Objective: create, reschedule and cancel behave correctly on every surface: the owner is alerted and the dashboard shows the change without a reload.
Branch: `fix/booking-ops-owner-alert`. Delivery: `ask-on-risk`, forecast under 400 authored lines. Test runner: Vitest (`npm test`, `npm run test:components`).
Engram mirror: pending — `mem_save` is rejected by a local hook in this session.

## Specs
- S1 (bug, verbatim from the user): "Un cliente escribió ARS Studio por agendamiento y el agente en WhatsApp le dijo que había sido reagendada, pero resulta que en la base de datos y en el dashboard no se marcó, o no sé si en la base de datos se marcó, pero en el dashboard no. Sin embargo, al dueño de negocio no le llegó la notificación de reagendamiento."
- S2 (scope, verbatim): "esto debe ser verificado de manera agnóstica y global en toda la plataforma. No debe funcionar solamente para un cliente, debe funcionar perfectamente el agendamiento, reagendamiento y cancelación de citas."
- S3 (owner alert): `emitBookingEvent` reaches `whatsapp-service` for created, rescheduled and cancelled events, with a test that runs the real Deno file. Point 1 of the plan the user approved.
- S4 (guard): CI fails on an undefined name in `supabase/functions`. Point 2.
- S5 (day list): the appointments list refreshes without a reload: polling every 20 s and on returning to the tab, like the home calendar. Point 3.
- S6 (matrix): the 3 operations on WhatsApp, voice, dashboard and phone, measured against appointment, cache, bell and owner alert. Point 4.
- S7 (user, verbatim, after S3-S6 were proposed): "si, en el dashboard no se marco la cita". Clarified by S8.
- S8 (user, verbatim): "En el dashboard no le marcó que la cita había sido reagendada. No le movió de día, ni de hora, ni de nada." and "No quiero más respuestas supuestas, quiero respuestas medidas."
- S9 (user, verbatim): "el aviso en producción falta, hay que desplegar, entonces despliega las funciones." and "PGTAG, hay que revisarlo. No pueden faltar los PGTAG. Hay que instalar Deno también. Y verifiquemos bien qué pasa con la plantilla."

## Tasks
| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1, S3 | inline | done, RED then GREEN | fix(notifications) |
| T2 | S4 | inline | done, RED then GREEN | test(edge-functions) |
| T3 | S1, S5, S7 | inline | done, RED then GREEN, plus browser probe | fix(appointments) |
| T4 | S2, S6 | explorer for voice and dashboard, parent writes | matrix done; WhatsApp measured in production (L12); open gaps in L10 | docs commit |
| T6 | S9 | inline | pgTAP and Deno done; both functions deployed from c40bb9f; owner delivery not measured | fix(supabase), fix(ci) |
| T5 | S1-S7 | docs close (constitution §7) | done | docs commit |

## Log
- L1 (2026-11-04, user, verbatim): "Antes de arrancar con lo que me propones, hay que verificar algo. Ayer sucedió un bug grave. Un cliente escribió ARS Studio por agendamiento y el agente en WhatsApp le dijo que había sido reagendada, pero resulta que en la base de datos y en el dashboard no se marcó, o no sé si en la base de datos se marcó, pero en el dashboard no. Sin embargo, al dueño de negocio no le llegó la notificación de reagendamiento. Entonces, esto debe ser verificado de manera agnóstica y global en toda la plataforma. No debe funcionar solamente para un cliente, debe funcionar perfectamente el agendamiento, reagendamiento y cancelación de citas."
- L2 (2026-11-04, user, verbatim): "si, en el dashboard no se marco la cita"
- L3 (2026-11-04, evidence): appointment d5ddd19e (RS STUDIO) was moved to 13:00 on 2026-11-03 08:03 Caracas time: RPC success, row at 13:00, bell row "Cita reagendada" exists. So the database was right.
- L4 (2026-11-04, root cause, owner alert): `notif-channels.ts:27,147` use an undefined `supabase` since 70b038a (2026-10-28). The `catch` swallows the ReferenceError, so `whatsapp-service` is never called. Reproduced by running the real file with a fake fetch, for all 3 event types.
- L5 (2026-11-04, root cause, dashboard): `use-appointments-list.ts` opened the same Realtime topic as the layout listener. realtime-js `channel()` returns the existing channel, so its `removeChannel` closed the shared one on leaving the list. The list had no polling, so since 3b8dc70 (2026-10-29) a missed broadcast left an old time on screen until the page was reopened. See L8 for the browser evidence.
- L6 (2026-11-04, decision): the list stops owning a channel and listens to the layout listener's window event, plus polling. Polling alone would leave the layout listener dead.
- L7 (2026-11-04, checks): `npm test` 1786, `test:components` 416, `test:evals:agent` 9, `tsc` exit 0, lint 0 errors, `knip` exit 0. pgTAP was blocked by `[inbucket]` in `supabase/config.toml`; see L11.
- L8 (2026-11-04, browser probe, real Chrome, local dev server, E2E business only, Broadcast messages with no database writes): with no broadcast, 0 reads in 8 s. Three probes each, reads within 5 s of a broadcast. Fixed code: list page, list after changing day, and home plus bell after leaving the list all answered 3 of 3. Old list hook: home answered 1 of 3 and the bell 1 of 3 after leaving the list, and that one bell read came 2.5 s later, consistent with its 20 s poll. The list after changing day still answered with the old hook, so the earlier claim that changing day broke it was wrong. The incident itself was not reproduced: nobody knows which screen the owner had open.
- L9 (2026-11-04, matrix, by reading code unless stated):
  | Surface / operation | Write | Overlap check | Redis cache | Bell | Broadcast | Owner alert |
  |---|---|---|---|---|---|---|
  | WhatsApp create | `fn_book_appointment_wa` | locked RPC | yes | yes | yes | WhatsApp + push (WhatsApp restored by T1) |
  | WhatsApp reschedule | `fn_reschedule_appointment_wa` | locked RPC | yes | yes | yes | same; reschedule also measured in production |
  | WhatsApp cancel | update status | n/a | yes | yes | yes | same; no cancel in production traces |
  | Phone create | `fn_book_appointment_wa` | locked RPC | no | yes | yes | same; 0 lines, 0 calls in production |
  | Phone reschedule, cancel | not offered (404) | | | | | |
  | Voice create, reschedule | direct insert/update | check then write | yes | yes | no | none, the spec marks it n/a |
  | Voice cancel | direct update | n/a | yes | yes | no | none, the spec marks it n/a |
  | Web create, reschedule | browser insert/update | browser only | no (no-op in browser) | yes | yes | push |
  | Web cancel | browser update | n/a | no (no-op in browser) | yes | yes | push |
- L10 (2026-11-04, open gaps found by the matrix, not fixed, need a user decision): (a) no database overlap guard on voice and web, so two concurrent bookings can both pass; (b) web writes never clear Redis, so the first paint of the home can be stale until the 20 s poll; (c) voice sends no Broadcast (D9), so bell, list and other tabs wait for the poll; (d) phone bookings do not clear Redis; (e) no column or UI marks an appointment as rescheduled, see S7; (f) web edit form ignores `appointment_services` errors; (g) `void emitBookingEvent` is not tied to `EdgeRuntime.waitUntil` in `process-whatsapp`, so the runtime could end it before WhatsApp or push finish. Not measured, and constitution §3 prescribes `void`, while `phone-agent-api/index.ts:31` already uses `waitUntil`. Suspicion ruled out: `appointment-fetcher.ts:20` excludes cancelled appointments from reminders.
- L11 (2026-11-04, checks after S9): `[inbucket]` renamed to `[mailpit]`: pgTAP 172 of 172 on a local stack. Deno 2.9.8 installed in `~/.deno/bin`. `deno check` with each function's config: `process-whatsapp` and `phone-agent-api` clean; `voice-worker` 4, `cron-reminders` 2, `whatsapp-webhook` 5, `push-notify` 4, `cron-imminent-push` 1, `embed-text` 2 type errors, not touched. All 55 edge test files already run under Vitest in `npm test`, and none uses `Deno.test`; an earlier claim that they did not run in CI was wrong.
- L12 (2026-11-04, production, E2E business, real path webhook then QStash then process-whatsapp, real Chrome on cronix-app.vercel.app): connected page: book, reschedule and cancel all reached the database, the bell and the day list. With the Realtime broadcast lost and the page online: database at 17:00, list stuck at 3:00 PM for 75 s with 0 reads, until a manual reload. Same test on the fixed code: new time after 5 s with 1 read. This matches S8. A real network loss does not show it: the PWA reloads itself when back online. Not proven: that this is what happened to the owner on 2026-11-03.
- L13 (2026-11-04, Meta, production phone number, fake recipient, control template): `owner_event_notification`, its `_v2`, and `client_winback` answer 132001 in es, es_ES, es_MX, es_AR, es_LA, en and en_US, same as the control. `daily_owner_summary` exists with 2 variables and `appointment_reminder` with 4, both in es. The token cannot list templates. So the owner alert falls back to free text until a template exists, and retention sends cannot succeed. Bodies of existing templates were not read.
- L14 (2026-11-04, deploy): the workflow failed twice with CLI `latest`, first on `[inbucket]` and then on a missing `--yes`; both changed nothing in production. During a GitHub Actions incident the API showed runs as `queued` long after they had finished, so results were read from the logs. With `--yes`, `process-whatsapp` and `phone-agent-api` deployed from c40bb9f. Afterwards book, reschedule and cancel through the real path on the E2E business reached the database, the list and the bell, with no error traces. The E2E business has no phone, so `sendOwnerWhatsApp` returns before sending: owner delivery is still not measured.
- Next: create or name the owner event template; measure delivery with a real number; merge so the day list fix reaches the web and `main` can deploy functions again.
