# 📋 Manifiesto de Dominio: Agente Conversacional de WhatsApp y Gestión de Slots

Este documento define las reglas de negocio inmutables para el módulo de agendamiento automatizado en WhatsApp y su reflejo en el Dashboard del comercio.

## 1. Identificación Multi-Tenant e Isolation
*   **Detección de Inquilino:** El agente de WhatsApp opera estrictamente dentro del contexto del `business_id` asociado al enlace o slot compartido. Queda prohibido consultar, mutar o listar agendas, servicios o configuraciones de un negocio ajeno.
*   **Slug Routing:** El enrutamiento y la resolución del inquilino seguro se realizan mediante el mecanismo de parsing del slug (`#slug` → `tenant_id`). Queda prohibido hardcodear IDs. El sistema usa un enrutamiento de 3 niveles en orden de precedencia: (1) slug en el mensaje actual → (2) sesión activa del remitente → (3) mensaje de landing genérico.

## 2. Los 4 Parámetros Críticos Obligatorios y Flujos Conversacionales

### Contrato de Datos para Confirmar una Cita
Para confirmar con éxito una nueva cita, el agente conversacional (Groq / Llama 3) DEBE extraer y validar obligatoriamente los siguientes 4 datos como argumentos de la tool `confirm_booking`:
1.  `customer_name`: Nombre completo del cliente (extraído del perfil de WhatsApp, no solicitado en chat).
2.  `date`: Fecha de la cita (Formato estricto `YYYY-MM-DD`).
3.  `time`: Hora de la cita (Formato estricto `HH:mm` en 24h, zona horaria LOCAL del negocio).
4.  `service_id`: UUID exacto del servicio del catálogo del negocio.

### Mecanismo de Gateo de Herramientas (Confirmation-Gate)
El agente NO valida los 4 parámetros como pre-check antes de llamar al caso de uso. En su lugar, opera bajo el mecanismo de `confirmation-gate` de 2 turnos:
1.  **Turno de recopilación:** El LLM conversa libremente (sin acceso a tools) para recopilar los datos que le faltan y propone una confirmación explícita al usuario (ej: *"¿Confirmo la cita para Corte de cabello el 2026-06-15 a las 10:00?"*).
2.  **Turno de confirmación:** Solo si la respuesta del usuario es afirmativa inequívoca (ej: "sí", "dale", "confirma"), el sistema habilita las tools de escritura para ese turno.

*Regla estructural:* Si la gate está cerrada (el usuario no ha confirmado), `activeTools = []` — el LLM nunca recibe los schemas de las tools, eliminando toda alucinación de argumentos.

### Flujo de Reagendamiento (`reschedule_booking`)
Permite modificar la fecha y hora de una cita con estado activo `CONFIRMED`. Requiere `appointment_id`, `new_date` y `new_time`. Debe validar la disponibilidad del nuevo slot antes de transicionar el estado a `RESCHEDULED`. Opera bajo el mismo mecanismo de confirmation-gate.

Si el cliente solicita reagendar pero no proporciona todos los datos necesarios (ej. "Reagendar para mañana" indica fecha pero no hora), el LLM debe identificar el dato faltante (en este caso, la hora) y solicitar únicamente lo que falta en lugar de pedir ambos datos desde cero. Si el cliente tiene múltiples citas activas, se debe identificar cuál reagendar a partir del servicio o la fecha original indicada por el cliente; de lo contrario, se listan las citas y se le pide que elija.

### Flujo de Cancelación (`cancel_booking`)
Realiza la baja lógica de la cita transicionando su estado a `CANCELLED`, liberando el slot de forma inmediata en la base de datos. Requiere `appointment_id`. Opera bajo el mismo mecanismo de confirmation-gate.

### Memoria de Sesión y Recuperación Episódica
El recall de contexto conversacional en el almacén de vectores opera estrictamente bajo los parámetros reales del sistema: `topK=5` y umbral mínimo de similitud semántica `threshold=0.78`.

## 3. Soporte de Notas de Voz (STT)

El bot de WhatsApp acepta mensajes de audio enviados por los clientes.
El pipeline convierte el audio a texto ANTES de ingresar al agente
conversacional, haciendo que el canal (voz o texto) sea transparente
para toda la lógica de negocio.

### Proveedor STT
**Deepgram Nova-2** (`model=nova-2&language=es&smart_format=true`).
Acepta cualquier formato de audio que Meta envíe (ogg/opus, mp4, webm).
Proveedor real: `transcribeAudio` en `ai-agent.ts` llama a `api.deepgram.com` con `DEEPGRAM_AURA_API_KEY`. Este path migró de Groq Whisper a Deepgram Nova-2 (los identificadores `whisper*` muertos de la migración fueron eliminados de `groq-client.ts`/`message-handler.ts`).

### Flujo de Procesamiento
Cliente envía nota de voz
│
▼
[Meta Graph API] downloadMediaBuffer(audio.id) → ArrayBuffer + mimeType
│
▼
[Deepgram Nova-2] transcribeAudio(buffer, mimeType) → { text: string | null, tokens: number }
│
▼
rawText = text ← mismo pipeline que mensaje de texto
│
└─► agente conversacional (confirmation-gate, tools, etc.)
    ✅ reservar ✅ reagendar ✅ cancelar ✅ servicios ✅ disponibilidad

### Manejo de Errores (en orden de precedencia)

| Error | Comportamiento |
|---|---|
| `LlmRateLimitError` (Deepgram 429) | HTTP 503 + `retryLater(retryAfterSecs)` → QStash reintenta automáticamente |
| `CircuitBreakerError` (Deepgram) | HTTP 503 + `retryLater(30)` → QStash reintenta en 30s |
| Error genérico de red/parsing | HTTP 202, notifica al cliente: *"No pude procesar tu audio..."* |
| Transcripción vacía (silencio) | HTTP 202, notifica: *"No pude entender tu mensaje de voz..."* |

### Regla de Transparencia de Canal
Una vez que el audio es transcrito a texto, el sistema no distingue si
el mensaje original fue escrito o hablado. Las mismas reglas de negocio,
guards, confirmation-gate y tools aplican en ambos casos.

### Criterios de Aceptación

**AC-STT-1 — Nota de voz activa todas las operaciones:**
- DADO un cliente que envía una nota de voz diciendo "quiero agendar un
  corte para mañana a las 3",
- CUANDO el pipeline transcribe el audio con Deepgram Nova-2,
- ENTONCES el texto transcrito ingresa al agente conversacional y puede
  ejecutar las mismas operaciones que si el cliente hubiera escrito el texto.

**AC-STT-2 — Rate limit no pierde el mensaje:**
- DADO que Deepgram Nova-2 retorna rate limit durante la transcripción,
- CUANDO `transcribeAudio` lanza `LlmRateLimitError`,
- ENTONCES el endpoint retorna HTTP 503 con header Retry-After y QStash
  reintenta automáticamente — el mensaje del cliente no se pierde.

**AC-STT-3 — Audio inentendible notifica al cliente:**
- DADO una nota de voz con transcripción vacía (silencio, ruido),
- CUANDO `result.text` es null o string vacío,
- ENTONCES el bot responde al cliente pidiéndole que hable más claro
  o escriba su consulta, y el pipeline termina con HTTP 202.

## 4. Pipeline Asíncrono de Notificaciones (La Campana del Dashboard)
Toda mutación exitosa sobre el estado de una cita (`CONFIRMED`, `RESCHEDULED`, `CANCELLED`) gatillada desde el bot de WhatsApp debe propagar alertas de forma inmediata mediante un diseño asíncrono que no bloquee al usuario en el chat. El patrón de despacho es fire-and-forget con el operador `void` (ver Constitution §3).

El pipeline ejecuta los canales en el siguiente orden jerárquico:
1.  **Base de Datos (fuente de verdad):** Se persiste la notificación en la tabla `notifications` enlazada al `business_id`. Si este paso falla, se aborta el pipeline.
2.  **Tiempo Real (Dashboard):** El backend emite el evento a través de los canales de Supabase Realtime para incrementar dinámicamente la campana de alertas del dueño. Falla silenciosamente sin afectar el booking.
3.  **WhatsApp al Dueño:** Se despacha una plantilla de alerta al número vinculado del dueño del negocio (vía Meta Graph API directa). Falla silenciosamente.
4.  **Web Push al PWA del Dueño:** Se envía una notificación push al PWA instalado del dueño vía la edge function `push-notify`. Falla silenciosamente.

En paralelo (independiente del pipeline del dueño), se envía un mensaje de confirmación formal al número de WhatsApp del cliente.

*Garantía de idempotencia:* Cada evento tiene un `eventId` determinista generado por `buildAppointmentEventId()`. Si QStash reintenta el mismo tool call, el pipeline detecta el `event_id` existente en DB y no duplica notificaciones.

## 5. Criterios de Aceptación y Errores Deterministas

### Manejo de Errores con Respuestas Deterministas
El sistema captura y responde de forma determinista mediante las estructuras definidas en `final-response.ts`:

| Código de Error | Respuesta al Usuario |
|---|---|
| `SLOT_CONFLICT` | "⚠️ Ese horario ya está ocupado. ¿Te gustaría intentar con otra fecha u hora disponible?" |
| `BOOKING_RATE_LIMIT` | "⚠️ Has alcanzado el límite de citas nuevas por hoy..." |
| `INVALID_ARGS` | "⚠️ Hubo un problema con los datos de la cita. Por favor indícame nuevamente el servicio, fecha y hora." |
| `UNAUTHORIZED` / `NOT_FOUND` | "⚠️ No encontré esa cita en tu historial. ¿Puedes confirmarme los detalles?" |
| `DB_ERROR` / `TOOL_EXECUTION_ERROR` | "⚠️ No pude completar la reserva por un problema técnico. ¿Intentamos de nuevo, o prefieres elegir otro horario?" |

> **Resolución de `service_id` (NORMATIVO — anti-FK-crash).** El `service_id` que recibe `confirm_booking` SIEMPRE debe resolverse contra el catálogo cargado (`p.services`): si el arg tiene forma de UUID pero NO pertenece al catálogo, el adapter lo rechaza con `INVALID_ARGS` (listando los servicios reales) **antes** de llamar la RPC — un id ajeno jamás llega a `fn_book_appointment_wa`. Defensa en profundidad: la RPC valida `p_service_id` ∈ servicios del negocio y devuelve `{success:false, error:'SERVICE_NOT_FOUND'}` en vez de dejar reventar `appointments_service_id_fkey`. Causa raíz histórica (2026-06-18): el prompt hardcodeaba un UUID de ejemplo realista que el LLM 8B copiaba en los args en lugar del REF# real → FK violation → DB_ERROR en cada reserva. El prompt ya no expone un UUID de ejemplo copiable.

> **Consulta de citas (read-only, determinista):** "¿tengo alguna cita?", "mis citas", "cuándo es mi cita" → `isListAppointmentsQuery` (`read-intents.ts`) responde directo desde `activeAppointments` (0 tokens), sin pasar por el LLM. No dispara si el texto trae un verbo de escritura (agendar/cancelar/reagendar).
>
> **Recovery de intención de agendar:** cuando el 8B falla (salida vacía/sintaxis interna) en un turno de agendamiento con la gate cerrada, `buildDeterministicIntentResponse` pide el dato faltante de forma determinista (servicio/día) en lugar de caer en el bucle "Estoy verificando la información…".

### Criterios de Aceptación (Happy Path)

**AC-1 — Agendamiento exitoso:**
- DADO un cliente con un slot disponible y el bot en estado de confirmation-gate abierta,
- CUANDO el agente llama a `confirm_booking` con `service_id`, `date` y `time` válidos,
- ENTONCES el sistema reserva el slot, cambia el estado a `CONFIRMED`, y dispara el pipeline asíncrono de 4 notificaciones con `void`.

**AC-2 — Cancelación exitosa:**
- DADO un cliente con una cita activa `CONFIRMED` y confirmation-gate abierta,
- CUANDO el agente llama a `cancel_booking` con el `appointment_id` correcto,
- ENTONCES el estado pasa a `CANCELLED`, el slot queda disponible instantáneamente en DB, y se dispara el pipeline de notificaciones.

**AC-3 — Reagendamiento exitoso:**
- DADO un cliente con una cita activa `CONFIRMED` y confirmation-gate abierta,
- CUANDO el agente llama a `reschedule_booking` con `appointment_id`, `new_date` y `new_time` donde el nuevo slot está libre,
- ENTONCES el estado pasa a `RESCHEDULED`, el slot anterior queda disponible, el nuevo queda ocupado, y se dispara el pipeline de notificaciones.

**AC-4 — Gate cerrada (anti-alucinación):**
- DADO cualquier mensaje del usuario donde el turno anterior del asistente NO fue una pregunta de confirmación,
- CUANDO el pipeline procesa el turno,
- ENTONCES `activeTools = []` — ninguna tool de escritura es accesible para el LLM en ese turno.

## 6. Optimizaciones de Rendimiento: Fast Path y Compuerta Híbrida

### Fast Path (Bypass de LLM)

Para reducir el consumo de tokens y latencia, las intenciones de tipo FAQ con confianza alta (>= 0.90) se responden con una plantilla determinista sin invocar `callLlm()`.

| Intención | Respuesta |
|---|---|
| `greeting` (saludo) | Plantilla de bienvenida con el nombre del negocio. |
| `pricing_inquiry` (consulta de servicios/horarios) | Lista de servicios con precio y duración del catálogo del negocio. |

El conjunto de intenciones FAQ se define en `FAQ_INTENTS` dentro de `faq-responses.ts`. Para agregar una nueva intención FAQ, basta con añadir su label al `Set` e implementar el caso en `buildFaqResponse()`.

### Flujo de Agendamiento Determinista (cero alucinación en la escritura) — NORMATIVO

El camino de **escritura** de una cita nueva no depende del LLM 8B para ningún dato vinculante. `runAgentLoop` invoca `resolveBookingTurn` (`booking-flow.ts`) **antes** del loop ReAct; el 8B nunca emite `service_id`/`date`/`time` ni propone una hora. La máquina determinista resuelve dos momentos:

| Momento | Disparo | Acción |
|---|---|---|
| **Propuesta** (`kind:'reply'`) | contexto de booking + servicio resoluble + fecha parseable + hora explícita (`extractTime`) | Valida la hora contra `computeAvailableSlots` (horario + slots ocupados). Si libre → emite "¿Confirmo tu cita de *X* para el … a las …?". Si ocupada → lista los horarios reales libres. Si cerrado → pide otra fecha. **Nunca** inventa ni auto-reserva. |
| **Ejecución** (`kind:'execute'`) | el turno previo del asistente fue NUESTRA propuesta (`¿Confirmo tu cita de …`) **+** afirmativa del cliente | Recupera servicio/fecha/hora de la propuesta de forma determinista (acepta fecha ISO o expresión en español), **re-valida** el slot, y ejecuta `confirm_booking` con esos args exactos vía `executeToolCall`. |

`kind:null` → no es un momento determinista (servicio ambiguo, falta fecha, cancel/reschedule); cae al resolver de hueco de hora y al LLM. La ejecución determinista reusa `executeToolCall` (rate-limit, adapter con validación servicio∈catálogo + solapamiento + horario, y pipeline de notificaciones); **omite** el reviewer constitucional a propósito (existe para vetar alucinaciones del LLM, y aquí los args son deterministas → 0 tokens). La validación de slot en el momento de ejecutar también cubre el caso de carrera (slot ocupado entre propuesta y "sí") y cierra el hueco de horario fuera de servicio. El 8B queda solo para charla/recopilación cuando el turno es ambiguo.

### Resolver de Disponibilidad Determinista (anti-alucinación de hora) — NORMATIVO

Cuando el cliente está en contexto de agendamiento y proporciona una **fecha pero NO una hora**, el agente NUNCA debe inventar una hora. Antes del LLM, `runAgentLoop` invoca `resolveBookingTimeGap` (`availability.ts`), que calcula de forma determinista (0 tokens) los horarios libres reales a partir de `working_hours` + slots ocupados + duración del servicio (`computeAvailableSlots`, espejo de la lógica del voice-agent):

| Slots libres ese día | Respuesta determinista |
|---|---|
| Día cerrado / 0 libres | Informa y pide otra fecha. |
| Exactamente 1 | Propone ese slot como pregunta de confirmación (`¿Confirmo…?` → la gate de 2 turnos abre con "sí"). |
| Varios | Lista los horarios y pregunta cuál — **nunca elige por el cliente**. |

Condiciones de disparo: contexto de booking (intent `book_appointment` o el turno anterior del asistente ofreció/propuso agendar) **+** fecha parseable (`parseDateExpression`, espejo determinista del voice) **+** sin hora en el texto (`textHasTime`) **+** servicio resoluble (único en catálogo o nombrado). Si falta cualquiera, cae al LLM. Refuerzo secundario: el system prompt prohíbe explícitamente inventar la hora en citas nuevas.

**Formato de horario (NORMATIVO — fuente de verdad: el dashboard).** El agente lee `business.settings.workingHours` tal como lo escribe el dashboard (Settings): claves de día de 3 letras minúsculas `mon|tue|wed|thu|fri|sat|sun` y valor `[open, close]` (ej. `["09:00","18:00"]`) para día abierto o `null` para cerrado. **No** existe `settings.working_hours` (snake/objeto) — esa divergencia histórica hacía que el horario configurado nunca llegara al agente; corregido para que `computeAvailableSlots` y el system prompt lean `workingHours`. Si el objeto está ausente/vacío (negocio sin configurar) → default 09:00–18:00 todos los días. El voice-agent tenía la misma divergencia (usaba la clave correcta `workingHours` pero esperaba día completo `monday` + objeto `{open,close}`); corregido con un normalizador en `voice-worker/index.ts` que convierte el formato del dashboard (`mon`+tupla) al shape que consumen sus capabilities.

### Compuerta Híbrida (Agendamiento Directo en Turno 1)

Excepción a la regla de 2 turnos: si la intención es `book_appointment` con confianza >= 0.90 **y** el texto del usuario contiene referencias explícitas de fecha y hora (detectadas por `textHasExplicitBookingParams()`), la compuerta de herramientas se abre directamente (`activeTools = BOOKING_TOOLS`) permitiendo que el LLM llame a `confirm_booking` sin un turno de confirmación redundante.

La validación de seguridad de parámetros y solapamiento de horarios se delega al `WriteGuard` y al caso de uso del dominio (`WhatsAppBookingAdapter`).

| Condición | Comportamiento |
|---|---|
| `intent === 'book_appointment'` + `confidence >= 0.90` + fecha + hora explícitos | Compuerta abierta en Turno 1 |
| Cualquier otro caso | Compuerta cerrada hasta confirmación explícita (regla de 2 turnos) |

### Criterios de Aceptación

**AC-FF-1 — Fast Path para saludos:**
- DADO un mensaje "Hola" del cliente,
- CUANDO `router.classify()` retorna `{ intent: 'greeting', confidence: 0.95 }`,
- ENTONCES `runAgentLoop` retorna la plantilla de bienvenida sin llamar a `callLlm()`.

**AC-FF-2 — Fast Path solo para confianza alta:**
- DADO un mensaje con intención `greeting` pero confianza < 0.90,
- CUANDO el pipeline procesa el mensaje,
- ENTONCES el flujo continúa al ReAct loop normalmente (no hay bypass).

**AC-HG-1 — Compuerta híbrida con parámetros explícitos:**
- DADO un mensaje "Quiero agendar un corte para mañana a las 3:00 PM",
- CUANDO `intent === 'book_appointment'` con confidence >= 0.90 y `textHasExplicitBookingParams()` retorna `true`,
- ENTONCES `activeTools = BOOKING_TOOLS` aunque la confirmation-gate esté cerrada.

**AC-HG-2 — Compuerta híbrida NO se abre sin parámetros:**
- DADO un mensaje "Quiero agendar" sin fecha ni hora,
- CUANDO `textHasExplicitBookingParams()` retorna `false`,
- ENTONCES `activeTools = []` (gate cerrada, se requiere turno de confirmación).
