# Arquitectura del Agente de IA para WhatsApp en Cronix

Este documento detalla los cambios técnicos y la arquitectura implementada para profesionalizar y escalar el Agente de IA de WhatsApp de Cronix. Los cambios recientes introducen sistemas de colas (message queues), observabilidad de IA y un sistema multicanal de notificaciones.

---

## 1. Desacoplamiento de Flujos con Upstash QStash

### El Problema
Meta (WhatsApp) exige que cada webhook lanzado desde su plataforma reciba un código de respuesta HTTP `200 OK` en menos de **3 segundos**. Sin embargo, procesar una nota de voz (Groq Whisper), obtener contexto de base de datos y hacer una inferencia compleja con Llama-3.3-70B puede tomar hasta 4 o 5 segundos en casos de alta demanda. Esto provocaba que Meta descartara los mensajes, causando falsas interrupciones.

### La Solución
Se adoptó una arquitectura asíncrona usando **Upstash QStash**.
Se dividió la lógica monolítica en dos *Edge Functions* de Supabase:

1. **`whatsapp-webhook` (El Receiver):** Su única función es recibir el payload de Meta, validar la firma HMAC-SHA256 por seguridad, empujar el mensaje crudo a la cola de QStash, y devolver inmediatamente un `200 OK` a Meta (usualmente en `< 50ms`).
2. **`process-whatsapp` (El Worker):** Es invocado en segundo plano por QStash con reintentos automáticos. Contiene toda la lógica pesada: transcripción de audio, fetching de contexto RAG, llamada al LLM y mutaciones en la base de datos.

### Beneficios
- **Cero mensajes perdidos:** Si Groq o Supabase experimentan lentitud, QStash automáticamente reintentará el procesamiento mediante estrategias de "Exponential Backoff".
- **Aprobación de Meta:** La respuesta ultra-rápida del Receiver asegura que el endpoint siempre esté saludable para Meta.

---

## 2. Inyección Explicita de Horarios Ocupados (RAG Refinamiento)

### El Problema
La IA estaba proponiendo a los clientes horarios que ya estaban ocupados, devolviendo un error de base de datos "Slot no disponible" que cortaba el flujo conversacional.

### La Solución
La función `process-whatsapp` ahora ejecuta `getBookedSlots()` antes de llamar al LLM:
- Obtiene todos los horarios ya reservados (start_at, end_at) de los próximos 14 días.
- Formatea estos horarios a la zona horaria del negocio.
- Inyecta la lista explícitamente en el prompt del sistema bajo una directiva crítica: `⚠️ HORARIOS YA OCUPADOS (PRÓXIMOS 14 DÍAS)`.

### Beneficios
- La IA tiene **visibilidad total de la agenda real**. Si un cliente pide las 10 AM y ese espacio está en la lista de ocupados, la IA naturalmente pide disculpas y sugiere la siguiente hora disponible, mejorando drásticamente el UX en lugar de chocar contra reglas duras de base de datos.

---

## 3. Notificaciones Proactivas y Multicanal al Dueño

El sistema de creación, reagendamiento y cancelación de citas se mejoró para dar tranquilidad y visibilidad en tiempo real a los dueños de los negocios sin que deban estar mirando el dashboard (PWA).

Cuando el cliente desencadena una acción confirmada que emite los tokens `[CONFIRM_BOOKING]`, `[RESCHEDULE_BOOKING]`, o `[CANCEL_BOOKING]`:
1. El sistema recupera los detalles de la cita afectada (Nombre del servicio, Nombre real del cliente, start_at) **antes** de mutar el estado.
2. Ejecuta el procedimiento SQL asociado de forma atómica.
3. Se envían dos canales de notificación en paralelo (Fire-and-forget, no bloqueante):
   - **Notificación Push (PWA):** Usada principalmente para confirmaciones de reservas (usando Web Crypto API nativa).
   - **Alerta por WhatsApp Directa:** Envia mensajes pre-formateados desde el Bot principal directo al número guardado como administrador del negocio.

### Ejemplos de Mensajes Transaccionales en WhatsApp:

#### Al Reagendar:
> ¡Hola equipo de **D'Barbers**! 👋🤖
> El cliente **Juan Pérez** ha **reagendado** su cita de **Corte Clásico**.
> ❌ Espacio liberado: 12/04/2026 a las 2:00 pm
> ✅ Nuevo espacio reservado: 14/04/2026 a las 4:30 pm
> ¡Tu agenda ha sido actualizada correctamente! 💪🚀

#### Al Cancelar:
> ¡Hola equipo de **D'Barbers**! 👋🤖
> El cliente **Juan Pérez** ha **cancelado** su cita, por lo que tienes un nuevo espacio libre el día 12/04/2026 a las 2:00 pm para el servicio: **Corte Clásico**.
> ¡Sigo activo para atender y asignarle este nuevo espacio libre a otro cliente! 💪🚀

---

## 4. Observabilidad Profesional con Helicone Proxy Gateway

Integración nativa con [Helicone.ai](https://helicone.ai/) para monitorizar todo lo que ocurre dentro de la "Caja Negra" del modelo de Groq.

Mediante la función inyectora `heliconeHeaders()`, Edge Functions re-enrutan las peticiones por la capa proxy en lugar de llamar a `api.groq.com` directamente.

### Capacidades Agregadas (Custom Properties):
- **Aislamiento de Costos Multi-tenant (`tenant: business.slug`):** Permite en el dashboard de Helicone ver exactamente cuántos tokens y cuantos céntimos le consume cada negocio particular a la infraestructura principal.
- **Rastreo por Usuario (`customer: <phone>`):** Para poder depurar conversaciones anómalas sin tener que leer bases de datos directamente.
- **Identificación de Canal (`type: audio-transcription` vs `chat`):** Permite diferenciar entre los costos generados por `whisper-large-v3` (audios) vs `llama-3.3-70b` (textos).

Helicone no interrumpe el flujo si se cae; si la variable `HELICONE_API_KEY` falla o se deshabilita, el sistema regresa a usar el modelo de llamadas directas a Groq.
