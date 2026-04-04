# WhatsApp AI Agent - Postmortem (Abril 2026)

## Contexto e Incidente
El Asistente de IA de WhatsApp (Luis IA) dejó de responder a todos los mensajes entrantes de los usuarios. 
Las quejas iniciales indicaban que los mensajes entraban, pero el bot devolvía el error de fallback o simplemente se quedaba en estado "Sin Respuesta".

## Diagnóstico y Cadena de Fallas

Durante la sesión intensiva de debugging y observabilidad con **Cronix Pulse (Sentry + Logs de Supabase)**, se descubrió una cascada triple de errores en la infraestructura de producción.

### 1. Bloqueo 401 por Verificación JWT Inadecuada
* **Causa Raíz:** Las Supabase Edge Functions (`whatsapp-webhook` y `process-whatsapp`) se estaban desplegando con la política de seguridad estandar de Supabase (`verify_jwt: true`).
* **El Problema:** Meta Webhooks y Upstash (QStash) **no envían tokens JWT**, ellos usan firmas personalizadas (`x-hub-signature-256` HMAC y Tokens al Portador respectivamente). Al exigir JWT a nivel de red, Supabase rechazaba el 100% del tráfico antes de que nuestro código de seguridad pudiera siquiera leer las firmas de Meta/QStash.
* **Resolución Categórica:**
  > **LECCIÓN DE ARQUITECTURA CRÍTICA:** Toda función que reciba webhooks de terceros o microservicios que no sean de front-end, **debe ser desplegada con la bandera `--no-verify-jwt`** de lo contrario, Supabase asume automáticamente que debe bloquearlas protegiendo a los usuarios locales.
  Ejecutamos:
  `npx supabase functions deploy whatsapp-webhook --no-verify-jwt`
  `npx supabase functions deploy process-whatsapp --no-verify-jwt`

### 2. Sincronización Fallida de Supabase Secrets ("Amnesia" de Producción)
* **Causa Raíz:** Las variables de entorno de producción para el procesamiento de IA no estaban activas.
* **El Problema:** Mientras que en `.env.local` el desarrollador poseía `WHATSAPP_ACCESS_TOKEN`, `LLM_API_KEY` (Groq), etc., el panel de Supabase Secrets estaba en blanco.
* **Resolución:** Recarga y sincronización generalizada en Supabase Dashboard de todas las llaves foráneas (`LLM`, `DEEPGRAM`, `WHATSAPP`, `QSTASH`, `SENTRY`).

### 3. Falla Silenciosa Capturada por Sentry (ReferenceError en Node/Deno)
* **Causa Raíz:** Cuando los mensajes por fin entraron a `process-whatsapp`, el código falló durante la verificación del limitador Anti-Spam (Rate Limit).
* **El Problema:** En el archivo `database.ts`, el argumento de la función era camelCase (`businessId`, `serviceName`), pero se pasaron parámetros en formato snake_case a la llamada RPC (`business_id`, `service_name`). Esto lanzó un bloqueante estricto de Javascript `ReferenceError`.
* **Lo Positivo de la Arquitectura (Observabilidad):**
  A pesar del fallo mortal crítico, el sistema manejó todo con gracia.
  1. El Catch Global envolvió el error.
  2. Sentry reportó asincrónicamente el `ReferenceError` marcando exactamente qué línea del código falló.
  3. Nuestro código devolvió un mensaje de emergencia amigable para el usuario: *"Lo siento, tuve un problema técnico al procesar tu mensaje. Por favor intenta de nuevo..."*, protegiendo la reputación del negocio.
* **Resolución:** Corrección tipográfica de variables a formato `camelCase` dentro del cliente Supabase TypeScript, y redespliegue de actualización final.

## Conclusión Ejecutiva (Foco para Reclutadores / Ingeniería)
Este incidente fue el caso de estudio perfecto de **Resiliencia de Código y Observabilidad de Microservicios**. 
A pesar de que el código base y la infraestructura de Supabase cayeron ante una barrera de seguridad inadvertida (`JWT`) y un error pos-compilación:

1. El sistema no derramó tokens ni detalles de programación ante los usuarios.
2. Sentry documentó exactamente en menos de 1 minuto un fallo en tiempo real en una Edge Function serverless.
3. El fix se aplicó en caliente mediante integración continua.

*Este es el verdadero valor de **Cronix Pulse**: saber dónde duele exactamente el sistema y poder curarlo antes de perder clientes orgánicos.*
