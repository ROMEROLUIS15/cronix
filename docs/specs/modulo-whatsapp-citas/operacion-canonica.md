# 🎯 Operación Canónica del Agente Inteligente de WhatsApp — NORMATIVO

> **Estatus:** 🟢 Normativo y vinculante. Este archivo es la **fuente única de verdad** sobre cómo DEBE comportarse, de principio a fin, el agente inteligente de citas vía WhatsApp y sus efectos colaterales (confirmaciones, notificaciones al dueño, campana del dashboard y recordatorio diario).
>
> Complementa —no reemplaza— al [`manifest.md`](./manifest.md) de este módulo y al de [`modulo-notificaciones`](../modulo-notificaciones/manifest.md). Ante conflicto, **manda lo normativo de este archivo** para la superficie de cara al cliente/dueño descrita aquí.
>
> **Regla de oro:** ningún dato vinculante de una cita (servicio, fecha, hora, identidad del cliente) puede ser inventado por el modelo. Toda escritura es determinista y validada. El LLM solo conversa.

---

## 1. Propósito y alcance

El agente de WhatsApp es un asistente que, sobre un único número de WhatsApp del sistema, atiende a los clientes de cualquier negocio (resuelto por slug `#slug`) y les permite **agendar, reagendar y cancelar** citas de forma conversacional, conociendo el **catálogo de servicios** y el **horario** real del negocio, con **rutas deterministas** que eliminan la alucinación.

Cada operación exitosa produce, de forma automática y exactamente una vez, el conjunto completo de efectos definidos en §4–§7. El cliente además recibe, a las **20:00 hora local del negocio**, un recordatorio de su cita del día siguiente que a su vez habilita reagendar/cancelar (§8).

---

## 2. Capacidades obligatorias del agente

| Capacidad | Determinista | Notas |
|---|---|---|
| **Agendar** cita nueva (`confirm_booking`) | Sí (§3) | 4 datos: cliente (perfil WA), servicio, fecha, hora. |
| **Reagendar** cita activa (`reschedule_booking`) | Sí (§3) | Identifica la cita por servicio/fecha; valida nuevo slot. |
| **Cancelar** cita activa (`cancel_booking`) | Sí (§3) | Identifica la cita; libera el slot. |
| **Consultar servicios** (precio/duración) | Sí (fast-path) | Desde el catálogo real; nunca inventa servicios ni precios. |
| **Consultar horario** | Sí | Desde `settings.workingHours`; nunca inventa horas de apertura. |
| **Consultar citas del cliente** | Sí (read-intent) | "¿tengo cita?" responde desde las citas activas reales. |

---

## 3. Rutas deterministas y barreras anti-alucinación (NORMATIVO)

Esta es la columna vertebral del agente. **Principio rector:** el LLM (modelo pequeño `llama-3.1-8b-instant`) solo conversa y recopila; **nunca produce, calcula ni inventa un valor vinculante** de una cita (servicio, fecha, hora, identidad). Todo dato que se escribe en la base de datos es **extraído y validado de forma determinista** del catálogo real, del parser de fechas, del horario y de la disponibilidad real. Subir el modelo o el prompt solo reduce la tasa de error; estas barreras la llevan a **cero** en el camino de escritura.

### 3.1 Orden de precedencia de rutas (árbol de decisión, NORMATIVO)

Cada turno del cliente se evalúa en este orden estricto. La **primera** ruta que aplica responde y termina el turno; el LLM solo corre si ninguna ruta determinista aplica.

| # | Ruta determinista | Disparo | Coste |
|---|---|---|---|
| 0 | **Intercept opt-out de retención** | el texto pide darse de baja | 0 tokens |
| 1 | **Fast-path FAQ** | intención `greeting`/`pricing_inquiry` con confianza ≥ 0.90 | 0 tokens — plantilla |
| 2 | **Flujo de agendamiento determinista** (propuesta/ejecución) | contexto de booking + datos resolubles (§3.3) | 0 tokens |
| 3 | **Resolver de hueco de hora** | booking + fecha sin hora | 0 tokens — ofrece/lista horarios reales |
| 4 | **Consulta de citas (read-only)** | "¿tengo cita?", "mis citas" | 0 tokens — desde citas activas reales |
| 5 | **ReAct LLM (último recurso)** | nada de lo anterior aplicó (turno ambiguo / charla / recopilación) | con gate + barreras §3.4 |
| 6 | **Pase final determinista** | siempre, sobre la salida del LLM | plantilla de éxito / mapa de error / saneo / fallback de intención |

> El LLM nunca es la primera ni la única autoridad. Es un **respaldo conversacional** envuelto por barreras antes (gate, tools) y después (pase final, saneo, fallback).

### 3.2 Los 4 datos críticos y su resolución determinista (NORMATIVO)

| Dato | Fuente determinista | El LLM puede… |
|---|---|---|
| **Cliente** | Nombre de perfil de WhatsApp (no se pide en chat) | nunca lo inventa ni lo pide |
| **Servicio** | Match contra el catálogo real cargado (`p.services`) | sugerir el más parecido por nombre y preguntar; nunca inventar uno ni un precio |
| **Fecha** | Parser determinista de expresiones en español (`parseDateExpression`) | nunca calcula fechas (el 8B es poco fiable en aritmética de fechas) |
| **Hora** | `computeAvailableSlots` sobre `workingHours` + slots ocupados + duración | **jamás** propone una hora que el cliente no dijo |

**Regla de la hora (innegociable):** si el cliente da fecha **sin** hora, el sistema calcula los horarios libres reales y (a) propone el único libre como pregunta de confirmación, (b) lista los libres y pregunta cuál, o (c) informa que el día está cerrado/lleno. Si el cliente da fecha **y** hora explícita, se **valida** esa hora contra el horario y los slots ocupados antes de proponer; si no es válida, se ofrecen los libres. Nunca se elige una hora por el cliente.

### 3.3 Contrato del flujo de escritura (NORMATIVO)

La escritura de una cita ocurre en dos momentos, ambos deterministas:

1. **Propuesta** — con servicio + fecha + hora resueltos y **validados** contra disponibilidad real, el sistema emite la pregunta `¿Confirmo tu cita de <servicio> para el <fecha> a las <hora>?`. El texto lo genera código, no el LLM.
2. **Ejecución** — solo tras esa propuesta **y** una afirmación inequívoca del cliente ("sí/dale/ok/confirmo"). El sistema **reconstruye los datos de forma determinista de su propia propuesta** y los **re-valida** en el instante de escribir (defensa contra el slot ocupado entre la propuesta y el "sí", y contra una hora fuera de horario). `confirm_booking` lo invoca el código, no un tool-call elegido por el LLM.

Reagendar y cancelar siguen el mismo contrato de 2 momentos: identificación determinista de la cita (por servicio/fecha de las citas activas reales), validación del nuevo slot (reagendar) y confirmación explícita antes de ejecutar.

### 3.4 Capas anti-alucinación (barreras, NORMATIVO)

Todas deben permanecer activas. Quitar cualquiera reabre una superficie de alucinación.

| ID | Barrera | Qué evita |
|---|---|---|
| **B1** | **Gate de confirmación de 2 turnos** | Que el modelo agende sin un "sí" explícito. Si la gate está cerrada, `activeTools = []` (el LLM ni ve los esquemas de tools). |
| **B2** | **Resolución determinista de los 4 datos** (§3.2) | Que el LLM emita servicio/fecha/hora inventados. |
| **B3** | **Validación de servicio contra catálogo** | Un `service_id` con forma de UUID ajeno al catálogo se rechaza (`INVALID_ARGS`) **antes** de la RPC; además la RPC valida `servicio ∈ negocio` (`SERVICE_NOT_FOUND`) en vez de reventar la FK. |
| **B4** | **Validación de slot + horario** (en propuesta y en ejecución) | Agendar fuera del horario real o sobre un slot ocupado; carrera entre propuesta y confirmación. |
| **B5** | **Prohibición de inventar hora** | Que el 8B fabrique "las 3 PM" cuando el cliente no dijo hora. |
| **B6** | **Saneo de salida + detección de sintaxis interna** | Que se filtren al cliente UUIDs, `<function>`, JSON de tools o nombres de tool; si se detectan → fallback determinista. |
| **B7** | **Guard de deduplicación por turno** | Doble ejecución de la misma tool con los mismos args (cita duplicada). |
| **B8** | **Idempotencia por `event_id` determinista** | Notificaciones duplicadas al dueño si el loop o QStash reintentan. |
| **B9** | **Revisor constitucional (WriteGuard)** sobre escrituras **propuestas por el LLM** | Hallucinaciones del LLM en el camino de respaldo. Se **omite** a propósito en el camino determinista (los args son de código → 0 tokens extra). |
| **B10** | **Recuperación de función embebida solo con gate abierta** | Ejecutar como tool una alucinación que el modelo escupió como texto cuando NO debía. |
| **B11** | **Fallback determinista de intención** | Que el 8B caiga en el bucle "Estoy verificando la información…": ante salida vacía/inusable se pide el dato faltante desde el estado real de la DB. |
| **B12** | **Rate limit de reservas** | Abuso / spam de citas nuevas. |

### 3.5 Qué puede y qué NO puede hacer el LLM (NORMATIVO)

- **Puede:** saludar, explicar servicios/horarios (con datos reales inyectados), recopilar lo que falta, redactar respuestas amables, identificar la intención.
- **NO puede:** emitir `service_id`/`date`/`time`/`appointment_id` que no provengan de las fuentes deterministas; proponer una hora no dicha por el cliente; confirmar/escribir sin la gate; afirmar que un servicio "no existe" sin revisar el catálogo; inventar precios, duraciones u horarios; ver los esquemas de tools con la gate cerrada.

### 3.6 Errores deterministas

Todo fallo se traduce a un mensaje determinista por código (`SLOT_CONFLICT`, `BOOKING_RATE_LIMIT`, `INVALID_ARGS`, `SERVICE_NOT_FOUND`, `UNAUTHORIZED/NOT_FOUND`, `DB_ERROR`). El cliente nunca recibe un error crudo ni una alucinación de recuperación; ver §5 del `manifest.md`.

> Detalle de implementación (descriptivo, no normativo): `process-whatsapp/booking-flow.ts` (`resolveBookingTurn`, `extractTime`), `availability.ts` (`computeAvailableSlots`, `resolveBookingTimeGap`), `date-parser.ts`, `confirmation-gate.ts`, `read-intents.ts`, `faq-responses.ts`, `final-response.ts`, `ai-agent.ts` (orden de rutas + saneo + dedup), `_shared/booking-adapter.ts` y la RPC `fn_book_appointment_wa`. Ver §6 del `manifest.md`.

---

## 4. Conocimiento del negocio: servicios y horario (NORMATIVO)

- **Servicios:** el agente solo ofrece servicios del catálogo real del negocio, con su precio y duración exactos. Si el cliente pide algo que no está, busca el más parecido y pregunta; nunca afirma que "no existe" sin revisar todo el catálogo, ni inventa uno.
- **Horario:** el agente lee `settings.workingHours` (fuente de verdad: el dashboard; claves `mon…sun`, valor `[apertura, cierre]` o `null`=cerrado). Ningún negocio debe operar sin horario; los caminos de alta lo siembran y el dashboard exige confirmarlo (ver §6 del `manifest.md`). El agente nunca ofrece ni acepta un horario fuera de `workingHours`.

---

## 5. Confirmación al CLIENTE: exactamente una (NORMATIVO)

> **INVARIANTE C1 — Una sola confirmación.** Por cada operación exitosa (agendar / reagendar / cancelar), el cliente recibe **exactamente UN** mensaje de confirmación por WhatsApp. Nunca dos, nunca cero.

El mensaje debe:
- Indicar la operación (agendada / reagendada / cancelada), el negocio, el servicio, la fecha y la hora en formato local legible.
- Ser el único acuse: la respuesta conversacional del agente y la confirmación formal **no pueden ser dos mensajes distintos** que digan lo mismo. Se elige una sola superficie como acuse de la operación.

> **Defecto observado (D1):** el cliente recibe DOS mensajes casi idénticos —el texto de respuesta del agente (plantilla de éxito) y la confirmación formal dedicada—. Viola C1. Causa: dos rutas independientes escriben al cliente (la respuesta del loop y `sendClientBookingConfirmation`). Corrección: una sola fuente de acuse.

---

## 6. Notificación al DUEÑO: automática y completa (NORMATIVO)

> **INVARIANTE O1 — El dueño se entera siempre.** Toda operación exitosa (agendar / reagendar / cancelar) dispara automáticamente, exactamente una vez (idempotente por `event_id`), los cuatro efectos hacia el dueño, en este orden:
> 1. **Persistencia en `notifications`** (fuente de verdad; si falla, se aborta el resto).
> 2. **Realtime** → la **campana del dashboard** se incrementa con esa notificación.
> 3. **WhatsApp al dueño** (texto libre vía Meta) con cliente, servicio, fecha y hora.
> 4. **Web push** al PWA del dueño.
> Cada canal posterior a la DB falla en silencio sin romper la reserva.

> **INVARIANTE O2 — Aplica a las TRES operaciones.** `appointment.created`, `appointment.rescheduled` y `appointment.cancelled` deben notificar al dueño con el mismo contrato. El reagendamiento no es una excepción.

> **Defectos observados:**
> - **(D2) La cita no aparece en el calendario/campana del dashboard de inmediato.** Causa raíz: la escritura vía `WhatsAppBookingAdapter` (RPC directa) **no invalida la caché del dashboard** (Upstash), a diferencia del path de voz/repo que sí lo hace. El registro existe en DB pero el dashboard sirve datos cacheados. Corrección normativa: **toda escritura WA exitosa DEBE invalidar la caché del dashboard** (`clients`/`appointments`/`dashboard`) en el mismo seam compartido.
> - **(D3) El dueño no recibe la notificación de reagendamiento.** Viola O2. Pendiente de corrección/verificación: confirmar que `reschedule_booking` emite el evento y que el canal WA del dueño no está fallando.
> - **(D4) Las notificaciones llegan "con error" / sin el nombre del cliente.** Ver §7.

---

## 7. Identidad del cliente: nombre real de WhatsApp (NORMATIVO)

> **INVARIANTE N1 — Nombre real.** Al agendar, el cliente se crea/actualiza con su **nombre de perfil de WhatsApp** real. Un placeholder (`Cliente 1234`) solo es admisible como último recurso cuando WhatsApp no entrega ningún nombre, y nunca debe pisar un nombre ya curado por el dueño.

Este nombre es el que aparece en: la notificación al dueño, la campana, y el **recordatorio diario al cliente** (§8). Un placeholder propaga "Hola Cliente 6589" a todos esos canales.

> **Defecto observado (D5):** los clientes creados por WhatsApp quedan con nombre `Cliente <últimos4>`. Causa raíz: el ejecutor de tools no pasa el `customerName` (perfil WA) al adapter, y el adapter llama a la RPC con `p_client_name = null`, por lo que la RPC siembra el placeholder. Corrección: propagar el nombre real del perfil de WhatsApp hasta la creación del cliente.

---

## 8. Recordatorio diario al cliente — 20:00 hora local del negocio (NORMATIVO)

> **INVARIANTE R1 — País-agnóstico.** A las **20:00 de la zona horaria de cada negocio** (sea cual sea el país), se dispara un recordatorio por WhatsApp a **cada cliente** con una cita al **día siguiente**. La hora de disparo se resuelve por la timezone del negocio, no por una hora global.

> **INVARIANTE R2 — Habilita autogestión.** El recordatorio le informa al cliente que tiene una cita mañana (servicio, fecha, hora, negocio) e invita explícitamente a **responder por el mismo chat para reagendar o cancelar**. Esa respuesta entra al agente como un turno normal y dispara los flujos deterministas de reagendar/cancelar (§3), con sus confirmaciones (§5) y notificaciones al dueño (§6).

> **INVARIANTE R3 — Nombre correcto.** El recordatorio se dirige al cliente por su nombre real (§7), nunca por un placeholder.

> Detalle (descriptivo): `cron-reminders/` con `fn_get_businesses_at_hour(20)` + rango "mañana" por timezone; el nombre proviene de `clients.name` (de ahí que D5 lo contamine).

---

## 9. Tabla de defectos → invariante → causa raíz → estado

| ID | Defecto observado | Invariante violada | Causa raíz (dónde) | Estado |
|---|---|---|---|---|
| D1 | Doble mensaje de confirmación al cliente | C1 | Dos rutas escriben al cliente: respuesta del agente + `notifications.ts: sendClientBookingConfirmation` | 🟢 **corregido** — se eliminó el 2º mensaje; el acuse único es la respuesta del agente |
| D2 | La cita no aparece en calendario/campana al instante | O1 | `_shared/booking-adapter.ts` no invalida la caché del dashboard | 🟢 **corregido** — `tool-executor.ts` invalida la caché tras toda escritura WA exitosa |
| D3 | El dueño no recibe notificación de reagendamiento | O2 | Reagendar dependía del 8B y no se ejecutaba de forma fiable → no se emitía el evento | 🟢 **corregido** — ruta determinista de reagendar/cancelar (§3.3); el reagendamiento ahora se ejecuta por código y emite el evento (DB/campana/push). El canal **WhatsApp** al dueño sigue sujeto a D4 |
| D4 | Notif por evento al dueño no llega fuera de 24h | O1/O2 | La notif por evento usaba texto libre directo a Meta (sin plantilla) → fuera de la ventana de 24h no se entrega | 🟢 **implementado (código)** — `sendOwnerWhatsApp` ahora va por `whatsapp-service` con **plantilla-primero + fallback a texto libre** (igual que el resumen diario). Nombre de plantilla configurable por secret `OWNER_EVENT_TEMPLATE` (4 vars: estado/cliente/servicio/fecha-hora). **Pendiente externo:** aprobar la plantilla en Meta — la creación programática vía MCP fue auto-rechazada por el WABA (requiere revisión manual en Business Manager). Mientras tanto el fallback entrega in-window; campana/push siempre OK |
| D5 | Notificaciones/recordatorio sin nombre real ("Cliente 6589") | N1, R3 | `tool-executor.ts` no pasa `customerName`; `booking-adapter.ts` llama RPC con `p_client_name=null` | 🟢 **corregido** — se propaga el nombre real del perfil WA hasta la RPC |

---

## 10. Criterios de aceptación (verificables)

**Anti-alucinación y rutas deterministas (§3):**
- **AC-DET:** Ningún `service_id`/`date`/`time`/`appointment_id` escrito proviene del LLM; todos son trazables a una fuente determinista (catálogo, parser, disponibilidad, citas activas).
- **AC-GATE:** No existe ninguna escritura sin una propuesta `¿Confirmo…?` previa del sistema seguida de afirmación del cliente (o el camino híbrido con parámetros explícitos validados). Con la gate cerrada, `activeTools = []`.
- **AC-TIME:** Dado fecha sin hora, el agente nunca propone una hora; ofrece/lista horarios reales o informa día cerrado/lleno.
- **AC-SVC:** Un `service_id` ajeno al catálogo se rechaza antes de la RPC; la RPC valida `servicio ∈ negocio`.
- **AC-SLOT:** La hora se valida contra `workingHours` + slots ocupados en la propuesta **y** en la ejecución; un slot ocupado entre ambos momentos no produce una reserva, sino una nueva oferta de horarios.
- **AC-SANE:** El cliente nunca recibe UUIDs, `<function>`, JSON de tools, nombres de tool ni un error crudo.

**Efectos de cada operación:**
- **AC-C1:** Tras agendar/reagendar/cancelar, el cliente recibe **exactamente un** WhatsApp de acuse (contar mensajes salientes al cliente = 1 por operación).
- **AC-O1:** Tras cada operación existe **una** fila en `notifications` (idempotente), la campana del dashboard la refleja, y el dueño recibe WhatsApp + web push.
- **AC-O2:** El reagendamiento cumple AC-O1 igual que el agendamiento.
- **AC-CACHE:** Tras agendar por WhatsApp, la cita aparece en el calendario del dashboard **sin esperar expiración de caché** (invalidación inmediata).
- **AC-N1:** Un cliente nuevo creado por WhatsApp queda con su nombre de perfil real; el recordatorio y las notificaciones lo usan (no `Cliente <n>`).
- **AC-R1:** Para un negocio en una timezone dada, el recordatorio se dispara a las 20:00 locales de ESE negocio; un negocio en otra timezone se dispara a su propia 20:00.
- **AC-R2:** Si el cliente responde "reagendar/cancelar" al recordatorio, el agente ejecuta el flujo determinista correspondiente y emite §5 y §6.

---

## 11. Trazabilidad

Este documento gobierna las correcciones de D1–D5. Cada PR que toque la superficie WhatsApp de cara al cliente/dueño debe citar la invariante concreta (C1/O1/O2/N1/R1–R3) que respeta o restaura.
