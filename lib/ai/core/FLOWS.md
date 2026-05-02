# Flujos completos — Dashboard y WhatsApp

Documentación de los dos paths de ejecución para `book_appointment`.
Ambos terminan en el mismo `BookingEngine.createAppointment()`.

---

## Flujo A — WhatsApp: cliente externo agenda cita

```
Meta API
  │  POST /webhook/whatsapp
  │  Body: { entry[0].changes[0].value.messages[0] }
  ▼
supabase/functions/whatsapp-webhook/index.ts
  │  1. Verifica firma HMAC (X-Hub-Signature-256)
  │  2. Extrae businessId de la ruta (/webhook/{businessSlug})
  │  3. Publica a la queue (o llama directamente)
  ▼
supabase/functions/process-whatsapp/index.ts
  │  Entrada garantizada:
  │    businessId = "uuid-del-negocio"   ← del webhook, no del LLM
  │    senderPhone = "584247092980"      ← del remitente de WhatsApp
  │    messageText = "quiero agendar manicura mañana"
  ▼
context-fetcher.ts
  │  Carga en paralelo:
  │    business = { id, name, timezone, slug, working_hours }
  │    services = [{ id, name, duration_min, price }]
  │    client   = getClientByPhone(businessId, senderPhone) → null si no existe
  │    activeAppts = getActiveAppointments(businessId, client?.id)
  │    history  = últimas 14 msgs de wa_audit_logs
  ▼
ai-agent.ts → runAgentLoop(messageText, context, customerName, senderPhone)
  │
  │  STEP 1: LLM llama confirmation gate
  │    toolsAllowedThisTurn(history, messageText)
  │    → false (primer mensaje, no hay "¿Confirmo?" previo)
  │    → LLM recibe tools=[] (no puede ejecutar herramientas aún)
  │
  │  LLM (8B) responde:
  │    "¿Para qué fecha y hora quieres tu manicura?
  │     Tengo disponible el martes 5 a las 10am o 3pm."
  │
  │  [siguiente turno del usuario: "el martes a las 3"]
  │
  │  STEP 2: LLM construye confirmación
  │    toolsAllowedThisTurn(history, "el martes a las 3")
  │    → false (no hay "¿Confirmo?" en el turno anterior del asistente)
  │
  │  LLM responde:
  │    "¿Confirmo tu cita de Manicura para el martes 5 a las 3:00 PM?"
  │
  │  [siguiente turno: "sí"]
  │
  │  STEP 3: toolsAllowedThisTurn(history, "sí")
  │    → true (último msg asistente era confirmación + usuario respondió afirmativamente)
  │    → LLM recibe tools=[confirm_booking, cancel_booking, reschedule_booking]
  │
  │  LLM llama:
  │    confirm_booking({
  │      service_id: "uuid-manicura",   ← el 8B conoce el UUID del contexto
  │      date:       "2026-05-05",
  │      time:       "15:00"
  │    })
  ▼
supabase/functions/_shared/booking-adapter.ts
  │  WhatsAppBookingAdapter.execute({
  │    toolName:    "confirm_booking",
  │    rawArgs:     { service_id, date, time },
  │    businessId:  "uuid-del-negocio",  ← del webhook, no del LLM
  │    timezone:    "America/Caracas",
  │    senderPhone: "584247092980",
  │    services:    [...],
  │    activeAppts: [...],
  │  })
  │
  │  1. Normaliza service_id (UUID exacto → skip fuzzy)
  │  2. Normaliza time: "15:00" → ya es HH:mm → ok
  │  3. localToUTC("2026-05-05", "15:00", "America/Caracas")
  │     → "2026-05-05T19:00:00.000Z"  (UTC-4)
  │  4. supabase.rpc('fn_book_appointment_wa', {
  │       p_business_id:  "uuid-del-negocio",
  │       p_client_phone: "584247092980",
  │       p_service_id:   "uuid-manicura",
  │       p_start_at:     "2026-05-05T19:00:00.000Z"
  │     })
  │     El RPC (SQL):
  │       a. Busca cliente por teléfono (fn_clean_phone)
  │       b. Si no existe → INSERT INTO clients
  │       c. Verifica conflicto (FOR UPDATE SKIP LOCKED)
  │       d. INSERT INTO appointments
  │       e. Retorna { success: true, appointment_id: "..." }
  │
  │  Retorna: { success: true, message: "Listo. Tu cita de Manicura...", appointmentId }
  ▼
ai-agent.ts
  │  lastToolParsed.success === true
  │  → renderBookingSuccessTemplate() (template determinístico, no LLM)
  │  → "✅ ¡Tu cita quedó confirmada!\nManicura — martes 5 de mayo a las 3:00 PM"
  ▼
notifications.ts
  │  emitCreatedEvent() → notifica al owner por dashboard + WhatsApp
  │  sendClientBookingConfirmation() → mensaje de confirmación por separado al cliente
  ▼
Meta API ← responde al cliente con el mensaje de confirmación
```

---

## Flujo B — Dashboard: owner agenda cita por voz/texto

```
Browser / App
  │  Usuario (owner) dice: "Agéndame a Ana García mañana manicura a las 10"
  ▼
app/api/assistant/voice/route.ts (o dashboard panel)
  │  withErrorHandler: verifica sesión, inyecta { user, supabase }
  │  Llama: createProductionOrchestrator(supabase, groqApiKey).process(input)
  │
  │  AiInput = {
  │    userId:     "uuid-del-owner",
  │    businessId: "uuid-del-negocio",
  │    userRole:   "owner",
  │    text:       "Agéndame a Ana García mañana manicura a las 10",
  │    timezone:   "America/Bogota",
  │    context:    { services: [...], workingHours: {...} },
  │    history:    [],
  │    channel:    "dashboard",
  │  }
  ▼
AiOrchestrator.process(input)
  │  1. stateManager.load(userId, businessId) → null (nueva sesión)
  │  2. state = stateManager.create({ userId, businessId, channel })
  │  3. stateManager.incrementTurn(state) → turnCount=1
  ▼
DecisionEngine.analyze(input, state)
  │  ¿TODAY_QUERY_PATTERN? No
  │  ¿TOMORROW_QUERY_PATTERN? No
  │  ¿Servicios configurados? Sí
  │
  │  FAST-PATH D: detectOwnerBookingIntent("Agéndame...") → true
  │    extractOwnerBookingData():
  │      date:        normalizeDateInput("mañana", "America/Bogota") → "2026-05-04"
  │      time:        extractOwnerTime("a las 10") → "10:00"
  │      serviceId:   fuzzyMatchService("manicura", services) → "uuid-manicura"
  │      clientName:  extractClientNameFromOwnerText("a Ana García mañana...") → "Ana García"
  │
  │    Todos los campos presentes → retorna:
  │    Decision {
  │      type:   'execute_immediately',
  │      intent: 'confirm_booking',
  │      args:   { service_id: "uuid-manicura", date: "2026-05-04",
  │                time: "10:00", client_name: "Ana García" }
  │    }
  ▼
ExecutionEngine.execute(decision, state, input)
  │  decision.type === 'execute_immediately'
  │  strategy = StrategyFactory.forRole('owner')
  │  strategy.canExecute('confirm_booking') → true
  │  strategy.requiresConfirmation(state) → false (owner no necesita confirmación)
  │
  │  toolExecutor.execute({
  │    toolName:   'confirm_booking',
  │    args:       { service_id: "uuid-manicura", date: "2026-05-04",
  │                  time: "10:00", client_name: "Ana García" },
  │    businessId: "uuid-del-negocio",
  │    userId:     "uuid-del-owner",
  │    timezone:   "America/Bogota",
  │  })
  ▼
DashboardBookingAdapter.execute(params)
  │  1. TenantEnforcer.verify("uuid-del-negocio", "uuid-del-owner", "America/Bogota")
  │     → admin query: users WHERE id = "uuid-del-owner" → business_id = "uuid-del-negocio" ✓
  │     → TenantContext { businessId, userId, timezone }
  │
  │  2. BookingEngine.dispatch(ctx, 'confirm_booking', args)
  ▼
BookingEngine.createAppointment(ctx, args)
  │  1. ConfirmBookingSchema.safeParse(args) → { service_id, date, time, client_name }
  │
  │  2. ClientResolver.resolve(ctx, { clientName: "Ana García" })
  │     → clientRepo.findActiveForAI("uuid-del-negocio")
  │     → fuzzyFind(clients, "Ana García")
  │     → found: { id: "uuid-ana", name: "Ana García" }
  │
  │  3. ServiceResolver.resolve(ctx, "uuid-manicura")
  │     → getActive("uuid-del-negocio")
  │     → byId: { id: "uuid-manicura", name: "Manicura", duration_min: 45, price: 25 }
  │
  │  4. localToUTC("2026-05-04", "10:00", "America/Bogota")
  │     → "2026-05-04T15:00:00.000Z"  (UTC-5)
  │     addMinutesToISO(startISO, 45)
  │     → "2026-05-04T15:45:00.000Z"
  │
  │  5. CreateAppointmentUseCase.execute({
  │       businessId: "uuid-del-negocio",
  │       clientId:   "uuid-ana",
  │       serviceIds: ["uuid-manicura"],
  │       startAt:    "2026-05-04T15:00:00.000Z",
  │       endAt:      "2026-05-04T15:45:00.000Z",
  │     })
  │     → queryRepo.findConflicts(...) → [] (libre)
  │     → commandRepo.create(...) → { id: "uuid-nueva-cita" }
  │
  │  6. cache.invalidate("uuid-del-negocio", "appointments")
  │     cache.invalidateKey("uuid-del-negocio", "dashboard", "stats")
  │
  │  Retorna:
  │    ToolResult<BookingData> {
  │      success:  true,
  │      message:  "Listo. Agendé a Ana García para Manicura el lunes 4 de mayo a las 10:00 a.m.",
  │      data:     { appointmentId: "uuid-nueva-cita", clientName: "Ana García",
  │                  serviceName: "Manicura", date: "2026-05-04", time: "10:00",
  │                  action: "created" }
  │    }
  ▼
ExecutionEngine (continúa)
  │  result.success = true
  │  newState.flow = 'idle'
  │  newState.lastAction = { type: 'created', appointmentId, ... }
  │
  │  emitEvent(AppointmentEvent, notificationService)  → fire-and-forget
  │
  │  Retorna AiOutput {
  │    text:            "Listo. Agendé a Ana García para Manicura el lunes 4 de mayo a las 10:00 a.m.",
  │    actionPerformed: true,
  │    toolTrace:       [{ step:1, tool:'confirm_booking', duration_ms:312, success:true }],
  │    tokens:          0,  (fast-path: no usó LLM)
  │    state:           { flow:'idle', ... },
  │    history:         [{ role:'user', content:'Agéndame...' }, { role:'assistant', ... }],
  │  }
  ▼
Browser / App ← muestra "Listo. Agendé a Ana García..."
               ← calendar se actualiza (cache invalidado)
```

---

## Diferencia clave entre ambos flujos

| Aspecto | WhatsApp | Dashboard |
|---|---|---|
| Identidad cliente | Teléfono del remitente | Nombre + fuzzy match |
| Confirmación | 2-turn gate en historial | Role-based (owner = directo) |
| Creación cliente | RPC SQL (por teléfono) | CreateClientUseCase (por nombre) |
| Timezone | booking-adapter.ts local | BookingEngine vía core/utils |
| LLM tokens para booking directo | ~800 (8B) | 0 (fast-path D) |
| Cache invalidación | ❌ (Edge Function no accede Redis Node.js) | ✅ |

La diferencia de cache es la única inconsistencia restante.
Fix: agregar una llamada HTTP al finalizar el booking de WhatsApp:
```
POST /api/cache/invalidate
Body: { businessId, keys: ['appointments', 'dashboard:stats'] }
Authorization: Bearer <INTERNAL_API_KEY>
```
