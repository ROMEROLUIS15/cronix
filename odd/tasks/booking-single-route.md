# Dashboard and voice button take the same booking route as WhatsApp
Objective: create, reschedule and cancel from the dashboard forms and its voice button go through the one `emitBookingEvent`, with no duplicated notification logic.
Branch: `feat/booking-single-route`. Delivery: `ask-on-risk`. Test runner: Vitest (`npm test`, `npm run test:components`). Excludes `voice-call-agent`.
Engram mirror: pending — `mem_save` is rejected by a local hook in this session.

## Specs
- S1 (verbatim): "Deben tomar esta misma ruta, no redundar en código, ya la lógica la tenemos, hay que tomarla también desde el botón de voz del dashboard y de voz agent para que hagan el mismo trabajo. Sobre todo encarguémonos más del dashboard."
- S2 (verbatim): "No podemos avanzar hacia otro lado si esto no se ha medido, ni comprobado, ni entregado, testeado."
- S3 (verbatim, asked whether the owner gets WhatsApp for their own actions): "solo por las de clientes y empleados". Bell, Realtime and push stay for everyone.
- S4 (verbatim): "Mide el botón del dashboard, el agente del dashboard. En la voz no." and "No vamos a ir con el agente de voz por ahora." and "No puedes basarte en ninguna documentación, tienes que basarte en código y mediciones."
- S5 (from the measurement, proposed and accepted with the plan): the bell says "Cita reagendada" and "Cita cancelada" with an `event_id`, like WhatsApp, instead of "Cita actualizada".
- S6 (from the measurement, proposed and accepted with the plan): the voice button does not create an appointment unless the sentence asks for one. "Cambia la cita", heard as "E2E la cita", created a new one and answered "Listo".
- Not in this feature, second step named in the plan: locked RPC writes on dashboard and voice, and cache invalidation in the pipeline.

## Tasks
| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S1, S3 | inline | done | c91d49d |
| T2 | S1, S3, S5 | inline, new endpoint | done, measured | c91d49d, ab21b6b |
| T3 | S1, S5 | inline, forms | done, measured | 6c1297b |
| T4 | S1, S3 | inline, voice | done, measured | 52a55c3 |
| T5 | S6 | inline | done, measured; partial for a follow-up to a misheard sentence (L7) | ab21b6b, 8de64ba |
| T6 | S2 | deploy and repeat the measurement | deployed; see L6 | |

## Log
- L1 (2026-11-04, user, verbatim): "No, no podemos pasar a más nada hasta verificar que de voz y de dashboard también funciona. Deben tomar esta misma ruta, no redundar en código, ya la lógica la tenemos, hay que tomarla también desde el botón de voz del dashboard y de voz agent para que hagan el mismo trabajo. Sobre todo encarguémonos más del dashboard. [...] No podemos avanzar hacia otro lado si esto no se ha medido, ni comprobado, ni entregado, testeado."
- L2 (2026-11-04, baseline, E2E business): dashboard create (local Supabase), reschedule and cancel (production) write and reach another session without reload. All three: broadcast and push, no `whatsapp-service`, bell without `event_id`, and "Cita actualizada" for reschedule and cancel. Voice button with real audio: create and cancel worked; "Reagenda" heard as "E2E" answered a query; "Cambia" heard as "E2E" created a new appointment. One typed booking landed on 4 Nov instead of 6 Nov, then 3 of 3 were right; cause unknown.
- L3 (2026-11-04, design): the browser cannot import Deno code, so the forms call one authenticated edge function, `booking-event`. It reads the appointment on the server, scoped to the caller's business, and never trusts event data from the browser.
- L4 (2026-11-04, verifier): 3 blockers on the first version. The intent guard rejected normal sentences and its own question had no accepted answer, and `booking-event` never started Sentry. Corrected in ab21b6b, rechecked: all pass.
- L5 (2026-11-04, user, verbatim, on deploying): "dale, despliega y mide cuando termine la verificación".
- L6 (2026-11-04, measured on production functions, E2E business): dashboard reschedule and cancel: `POST booking-event 200`, bell "Cita reagendada" and "Cita cancelada" with event_id, reached the other session. Dashboard create on a local Supabase with the function served: same, "Nueva cita agendada". Security: E2E session on an RS STUDIO appointment 404 with 0 bell rows added; cancel of an active appointment 409; bad action 400; no or bad token 401. Voice button with audio: "Mueve" and "Cambia" rescheduled, "Cancela" cancelled, bell with channel voice and event_id; "E2E la cita…" no longer created an appointment. WhatsApp to the owner by an employee: covered by tests only, no employee was measured.
- L7 (2026-11-04, open, advisory): the guard reads the current turn only, so a follow-up such as "a las 4" to a misheard sentence could still book if the LLM calls `smart_schedule`. Audio can cut a sentence at a pause, seen twice with synthetic speech.
