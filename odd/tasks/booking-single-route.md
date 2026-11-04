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
| T1 | S1, S3 | inline | pending | |
| T2 | S1, S3, S5 | inline, new endpoint | pending | |
| T3 | S1, S5 | inline, forms | pending | |
| T4 | S1, S3 | inline, voice | pending | |
| T5 | S6 | inline | pending | |
| T6 | S2 | deploy and repeat the measurement | pending | |

## Log
- L1 (2026-11-04, user, verbatim): "No, no podemos pasar a más nada hasta verificar que de voz y de dashboard también funciona. Deben tomar esta misma ruta, no redundar en código, ya la lógica la tenemos, hay que tomarla también desde el botón de voz del dashboard y de voz agent para que hagan el mismo trabajo. Sobre todo encarguémonos más del dashboard. [...] No podemos avanzar hacia otro lado si esto no se ha medido, ni comprobado, ni entregado, testeado."
- L2 (2026-11-04, baseline, E2E business): dashboard create (local Supabase), reschedule and cancel (production) write and reach another session without reload. All three: broadcast and push, no `whatsapp-service`, bell without `event_id`, and "Cita actualizada" for reschedule and cancel. Voice button with real audio: create and cancel worked; "Reagenda" heard as "E2E" answered a query; "Cambia" heard as "E2E" created a new appointment. One typed booking landed on 4 Nov instead of 6 Nov, then 3 of 3 were right; cause unknown.
- L3 (2026-11-04, design): the browser cannot import Deno code, so the forms call one authenticated edge function, `booking-event`. It reads the appointment on the server, scoped to the caller's business, and never trusts event data from the browser.
