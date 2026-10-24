# WhatsApp: weekday + "en la mañana" misparse, and owner alert for unfinished cancel/reschedule requests
Objective: a client who asks to cancel or reschedule by WhatsApp gets the date they asked for, and the owner learns about the request as soon as it is made, even if the client never finishes the conversation. Branch: `develop` (merges to `main` --no-ff). Delivery: ask-on-risk. Test runner: Vitest (`npm test`, includes the process-whatsapp and voice-worker suites).
Engram mirror: pending — the Engram tools are not available in this session.

## Specs
- S1 (bug, verbatim from the user): "hay clientes que han cancela su cita y han querio reagendar via whatsapp y al dueño de negocio no le ha llegado aviso y tampoco ha sido verificado que respuesta le esta dando a al cliente".
  Observed in prod (2026-10-24 00:06 UTC, business ac0ba6e9): client message "😭 buenas noches cancela mi cita.. y reagendame para el día martes en la mañana 🙏🏻el niño tiene juego y no puedo faltar🙈" → reply "¿A qué hora quieres tu cita de *Pestañas* el 24 de octubre? Para reagendar tengo: 8:00 am, …" → 0 tools, appointment still `pending`, no owner notification.
- S2 (parser): a weekday followed by "en la mañana" / "por la mañana" resolves to that weekday, never to tomorrow ("reagendame para el martes en la mañana" on Fri 2026-10-23 → 2026-10-27). "mañana" alone and "mañana en la mañana" still mean tomorrow. Applies to both mirrors (process-whatsapp and voice-worker date parsers).
- S3 (day part): "en/por la mañana" asks for morning times. The time question then lists only times before 12:00 ("ofrece horarios antes de las 12"); "en/por la tarde" lists times from 12:00 on. If no time is left in that part of the day, it says so and lists the rest.
- S4 (owner alert, option A chosen by the user: "a"): as soon as a client asks to cancel or reschedule a specific appointment, the owner is notified (bell + realtime + WhatsApp + push), e.g. "V… pidió reagendar su cita de mañana 9:00, pendiente de confirmar". The appointment is NOT touched until the client confirms (the 2-moment contract of operacion-canonica.md:70 is kept). One alert per appointment and request type (idempotent by `event_id`).
- S5 (verification): a golden conversation eval reproduces the prod message and checks the reply, the owner alert, and the complete reschedule after confirmation.

## Tasks
| ID | Specs | Route | Status | Commit |
|---|---|---|---|---|
| T1 | S2, S3 | inline (no writer reason: units overlap in reschedule-flow.ts) | done — 134 focused tests green, 801 WA+voice | 2e41b37 |
| T2 | S4 | inline | done — 66 focused tests green; unit 1742, components 408, evals 8, deno check exit 0 | 488811b |
| T3 | S5 | inline | done — eval with the prod message; mutation-verified (no parser fix → fails; no owner alert → 2 fail) | (next commit) |
| T4 | docs (operacion-canonica O3/D7/AC-O3/AC-NLU-24, modulo-notificaciones, INDEX) | inline | done | (next commit) |

## Log
- L1 (2026-10-24, user, verbatim): "se esta presentando un bug, hay clientes que han cancela su cita y han querio reagendar via whatsapp y al dueño de negocio no le ha llegado aviso y tampoco ha sido verificado que respuesta le esta dando a al cliente"
- L2 (2026-10-24, user, verbatim, choosing among A/B/C): "a"
- L3 (2026-10-24): evidence. `wa_audit_logs` 2026-10-24 00:06 UTC, trace path `deterministic_booking`, intent `cancel_appointment`. `parseDateTime` returns 2026-10-24 for "reagendame para el martes en la mañana" and 2026-10-27 for "reagendame para el martes" → `date-parser.ts:113` matches `\bmanana\b` before the weekday branch. The voice-worker mirror has the same line (`voice-worker/core/date-parser.ts:126`). No unrouted messages (`wa_unrouted_message` empty); Sentry 1A is the retention `client_winback` template, unrelated.
- L4 (2026-10-24): design. The owner WhatsApp template `owner_event_notification` takes 4 free variables (estado, cliente, servicio, fecha y hora), so the request alert reuses it — no new Meta template. New event types `appointment.cancel_requested` / `appointment.reschedule_requested`; `buildAppointmentEventId` gains the two actions in both mirrors (Deno `_shared/notifications/event-id.ts`, Node `lib/notifications/appointment-event-id.ts`). The dashboard bell picks new rows up via postgres_changes + 20 s poll; the broadcast list in `use-realtime-dashboard-sync.ts` gets the two events for instant refresh.
- L5 (2026-10-24): differential check of the parser, old (2e41b37~1) vs new, on 34 phrases → 9 differ, all the same misreading: 4 now right ("el martes en/por la mañana", "martes a las 9 de la mañana", "el 27 de octubre en la mañana" all gave tomorrow before), and 5 stop inventing tomorrow ("a las 9 de la mañana", "en la mañana", "por la mañana", "de la mañana", "agéndame a la mañana" → no date, so the agent asks the day). The other 25 ("hoy", "mañana", "pasado mañana", "mañana en la mañana", dates, "próximo lunes", "en 3 días"…) are identical.
- Risk: item 3 (the date parser is shared by booking, cancel, reschedule, availability and the voice agent). Covered by the differential above and the full WA+voice suites.
- Next: commit T3/T4 → native review assess → push develop + main → user deploys `process-whatsapp` and `voice-worker`.
