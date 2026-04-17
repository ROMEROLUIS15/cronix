# Arquitectura del Sistema de IA para WhatsApp (Backend)

Este documento detalla exhaustivamente el funcionamiento "de principio a fin" de la Inteligencia Artificial desplegada en las Edge Functions de Supabase para atender mensajes de WhatsApp. 

Esta arquitectura está completamente desacoplada del frontend (Next.js) y opera de forma asíncrona, robusta y escalable.

---

## 1. El Flujo de Llamadas (De Principio a Fin)

Cuando un cliente envía un mensaje por WhatsApp, el flujo atraviesa múltiples capas de defensa y procesamiento:

### Fase 1: Recepción y Encolado (El Webhook)
**Archivo:** `supabase/functions/whatsapp-webhook/index.ts`
1. Meta (WhatsApp) dispara un evento HTTP POST a este webhook.
2. **Seguridad (Capa 1):** Valida la firma `HMAC-SHA256` enviada por Meta asegurando que el mensaje es genuino y no un ataque.
3. **Desacoplamiento:** En lugar de procesar la IA aquí mismo (lo que causaría que Meta corte la conexión por timeout de red de la nube), la función simplemente atrapa el cuerpo del mensaje y se lo inyecta a una cola en la nube externa administrada por **QStash (Upstash)**.
4. Responde inmediatamente con un `200 OK` (Accepted) a Meta, finalizando la primera fase en pocos milisegundos.

### Fase 2: Procesamiento y Orquestación
**Archivos principales:** `process-whatsapp/index.ts` y `message-handler.ts`
1. QStash extrae el mensaje de su cola y hace la llamada autónoma al orquestador real: `process-whatsapp`.
2. **Seguridad (Capa 2):** Se verifica la firma criptográfica en el header de QStash (`security.ts`) para evitar inyecciones e independientemente de un inicio de sesión (`verify_jwt: false` en Supabase).
3. **Manejo de Errores (Dead Letter Queue):** Toda ejecución aquí dentro está envuelta en un control de errores (try/catch). Si el servidor falla gravemente, el paquete original mandado por Meta se almacena integro en la tabla `wa_dead_letter_queue` para reintentos posteriores o depuración en frío.
4. **Voz a Texto:** Si se recibió un audio (Voice Note), el `message-handler` utiliza una función auxiliar `downloadMediaBuffer` extrayendo el binario de Meta y llamando a la función especializada `transcribeAudio()`. Esta utiliza la API súper veloz de **Groq Whisper** para convertir el audio en texto limpio antes de que la IA lo sepa.

### Fase 3: Enrutamiento y Memoria (El Contexto RAG)
Para que la IA no invente datos ("alucinaciones"), se inyecta en todo su prompt información rigurosa del cliente.
1. **Business Router (`business-router.ts`):** 
   - Analiza si el mensaje viene de un enlace de landing (ej: `#estetica-bella`). De ser así, ata directamente la sesión del número celular a ese Tenant (`business_id`).
   - Si no hay un `hash/slug`, consulta qué sesión está anclada (`wa_sessions`) a ese teléfono en particular.
2. **Control de Cuotas y Límites (`guards.ts`):** 
   - Para frenar bots, se invocan Controles de Límites (Rate Limits y Token Quotas). El negocio tiene límites de tokens facturables que impiden quiebras sorpresas si hay ataques masivos.
   - Aplica el patrón "Circuit Breaker". Si existe un bajón de red del proveedor de Inteligencia Artificial (ej., Groq/OpenAI reportando error 500 por doquier), se activa el circuito y devuelve automáticos al cliente avisando de un "mantenimiento rápido", salvando llamadas inválidas.
3. **Context Fetcher (`context-fetcher.ts`):** Extrae al instante de la base de datos de PostgreSQL toda la memoria conversacional y fáctica:
   - Extrae el perfil base (nombre del cliente, negocio aplicable).
   - Extrae **`getActiveAppointments` y `getBookedSlots`**: Información temporal para nutrir la IA con los "HUECOS Y SALIDAS" en tiempo real que tiene cada calendario para sugerir.
   - **Módulo de Memoria Corta (`getConversationHistory`)**: Filtra `wa_audit_logs` trayendo solo "los últimos 4 mensajes del usuario vs Agente", lo suficiente para guardar la coherencia del chat de hoy sin ahogar los limites de tokens totales del LLM.

Toda esta compilación crea el objeto **`BusinessRagContext`**, es el conocimiento divino temporal inyectado a los asistentes virtuales.

### Fase 4: Bucle ReAct y Resolución Final
**Archivos principales:** `ai-agent.ts` y `tool-executor.ts`
Con toda el RAG asimilado, despierta el agente impulsado por el patrón de Inteligencia Artificial "Reasoning + Acting" (Razonar y Actuar).

1. **El Cerebro Interno Lógico (Llama-3.1-8b):**
   - Una IA optimizada, pequeña y muy barata se enciende. Revisa el mensaje y dice *"El cliente dice 'Ok confirmado'. En el turno pasado yo le propuse las 3PM. Esto significa: REAGENDAR PARA LAS 3PM"*.
   - Inicia el "Bucle de herramientas", llama la firma de control `confirm_booking` definida en el `tool-executor.ts`.
2. **Ejecución de Backend Mutacional (`tool-executor.ts`):**
   - Funciona sin que la IA toque Bases de Datos directamente con SQL. El executor recibe el formato en JSON, sanitiza parámetros (UUID puro, Tiempo ISO), chequea cuotas, dueñazgos y muta el backend real de citas (insertando o actualizando una). Retorna al LLM con un simple `{success: true}` (O en contra: `{success: false, error: "SLOT_CONFLICT"}` forzando al LLM pequeño a sugerirle otra hora a su humano).
3. **Cerebro Externo y Envío Final (Llama-3.3-70b):**
   - Habiendo validado de forma robótica cada herramienta técnica, la cadena pasa al modelo gigante "Vibes", una bestia con 70 Billones de parámetros y capacidad increíble de redacción que toma el dictamen del paso anterior y modela una respuesta en español, encantadora, humana y sin detalles UUID para mandarse por la API asincrona externa `sendWhatsAppMessage` de vuelta directamente al cliente.


---

## 2. Aciertos y Ventajas Inmensas (PROS)

* **Segregación Completa Frontend/Backend**
  Al funcionar totalmente con *Edge Computing*, no importa que tan duro se le exija a la aplicación web (Next.js), todo el flujo gigante de WhatsApp es balanceado independientemente, asincrónicamente por la nube. Es decir, tus paneles del SAAS no van a sufrir lentitud si un negocio está procesando 3.000 citas al mismo tiempo en fin de mes.
* **Modelo RAG Conservador (Manejo Maestro de los Tokens LLM)**
  Usar `getConversationHistory` en los límites justos y usar un modelo 8B para el motor lógico interno versus un 70B para la estética evita "sangrados" de facturas. Una petición normal que pudo costar 10 mil tokens por analizar un libro, gasta únicamente dos o tres centavos por request al enfocarse de manera conservadora solo en los objetos críticos RAG.
* **Control Absoluto Anti-Alucinatorio (Tool Orchestration)**
  Los LLMs son conocidos por inventar. Pero en tu plataforma (como en toda industria crítica), no pueden. Tu capa *tool-executor.ts* ejerce una arquitectura de Desconfianza (Zero-Trust) con la IA. Cada vez que la IA pide mover una cita, en vez de moverla en una base de datos sin control, la función TS lo maneja y si el LLM se equivoca lo frena a la mitad del camino mediante un "Circuito abierto / Fallback" sin que el cliente se dé cuenta.
* **Tolerancia de Fallo 100% de QStash (DLQ)**
  Gracias a la Cola QStash y a cómo manejan el JSON, en caso de caídas de AWS/Facebook o la misma Supabase, el mensaje del usuario no se destruye ni desaparece sin dejar rastro de lectura; se queda suspendido en memoria listos para reactivar la cadena cuando el sistema vuelva. 

---

## 3. Puntos de Atención Potenciales (CONTRAS)

Toda herramienta y arquitectura hiper avanzada paga pequeños peajes que son necesarios contemplar:

* **Sincronización en "La Cola Fantasma" y "Race Conditions":** 
  Dado que la mensajería es distribuída por QStash, en un evento altamente masivo donde dos teléfonos envían una reserva para exactamente el mismo bloque de tiempo en exactamente el mismo de milisegundo de margen, ambas invocarán la herramienta en paralelo. Aunque se confía en los locks (transacciones) de PostgreSQL de Supabase en tu capa `lib/`, al ser llamadas de funciones que corren por separado existe un micro-riesgo del típico Deadlock.
* **Largas dependencias con Proveedores / Vendor Lock-in Sensibles:**
  Al usar APIs tan potentes (Upstash, Groq, Whisper, Meta WhatsApp Business API Cloud Native, Deno Edge de Supabase) si alguna de estas cinco compañías emite en algún futuro lejano y distópico un deprecio de API que eliminen, por ejemplo los UUID por otra tecnología obligatoria, causaría horas valiosas de adaptabilidades estrictas, ya que todo tu árbol pende del parseo de Meta v19.x y Headers que pueden ser removibles.
* **Testing Automatizado End-to-End Complicadísimo:** 
  Las pruebas con software Playwright es genial para testing del Frontend SAAS (Next.js UI). Pero probar (testear) el flujo completo "en vivo" de la IA requiere un "teléfono celular Falso simulando escribir WhatsApp". Esto es extremadamente díficil de lograr para Unit-Testing automatizados porque envuelve LLMs aleatorios.  
