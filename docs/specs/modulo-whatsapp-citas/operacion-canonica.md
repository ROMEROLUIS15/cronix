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

## 3. Rutas deterministas y anti-alucinación (NORMATIVO)

El camino de **escritura** no depende del LLM 8B para ningún valor vinculante. Reglas innegociables:

1. **Servicio:** SIEMPRE resuelto contra el catálogo cargado (`p.services`). Un `service_id` con forma de UUID que no pertenezca al catálogo se rechaza **antes** de tocar la base de datos (`INVALID_ARGS`), nunca llega a la RPC.
2. **Fecha:** resuelta por el parser determinista (`parseDateExpression`); el modelo nunca calcula fechas.
3. **Hora:** el agente **jamás** propone una hora que el cliente no dijo. Si el cliente da fecha sin hora, el sistema calcula los horarios libres reales (`computeAvailableSlots`) y los ofrece/lista; si da fecha+hora, la valida contra el horario y los slots ocupados antes de proponer la confirmación.
4. **Confirmación de 2 turnos:** la escritura solo ocurre tras una propuesta `¿Confirmo…?` del propio sistema seguida de una afirmación inequívoca del cliente. La ejecución reconstruye los datos de forma determinista de esa propuesta y los re-valida en el momento de escribir.
5. **Gate cerrada = sin tools:** si no hay confirmación, el LLM no recibe los esquemas de tools (`activeTools = []`).

> Detalle de implementación (descriptivo, no normativo): `process-whatsapp/booking-flow.ts` (`resolveBookingTurn`), `availability.ts`, `date-parser.ts`, `confirmation-gate.ts`, `_shared/booking-adapter.ts`, y la RPC `fn_book_appointment_wa` (valida servicio∈negocio). Ver §6 del `manifest.md`.

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
| D1 | Doble mensaje de confirmación al cliente | C1 | Dos rutas escriben al cliente: respuesta del agente + `notifications.ts: sendClientBookingConfirmation` | 🔴 a corregir |
| D2 | La cita no aparece en calendario/campana al instante | O1 | `_shared/booking-adapter.ts` no invalida la caché del dashboard | 🔴 a corregir |
| D3 | El dueño no recibe notificación de reagendamiento | O2 | Por verificar (emisión de `appointment.rescheduled` / canal WA dueño) | 🔴 a verificar+corregir |
| D4 | Notificaciones "con error" | O1 | Encadenado a D2/D5; verificar errores de Meta API en `sendOwnerWhatsApp` | 🟡 a verificar |
| D5 | Notificaciones/recordatorio sin nombre real ("Cliente 6589") | N1, R3 | `tool-executor.ts` no pasa `customerName`; `booking-adapter.ts` llama RPC con `p_client_name=null` | 🔴 a corregir |

---

## 10. Criterios de aceptación (verificables)

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
