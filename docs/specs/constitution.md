# 📜 Constitución Arquitectónica de Cronix (Reglas Globales de IA)

Este documento contiene las reglas de oro innegociables para el desarrollo de software en este repositorio. Cualquier agente de IA que genere o refactorice código DEBE cumplir estrictamente con estos lineamientos.

## 1. Patrones de Diseño y Estructura de Capas (DDD)
*   **Separación de Conceptos:** El sistema se divide estrictamente en Dominio, Infraestructura y Aplicación.
*   **Regla de las Dos Capas de Casos de Uso:**
    - `lib/domain/use-cases/`: Reservado para clases orquestadoras con efectos secundarios (Comandos). Deben depender de interfaces, no de implementaciones (DIP).
    - `lib/use-cases/`: Reservado para funciones de dominio puras, libres de dependencias, encargadas de cálculos lógicos y matemáticos (Consultas/Validaciones).
*   **Contenedor de Dependencias (DI):** Toda infraestructura, servicio o repositorio debe inyectarse a través de `lib/container.ts`. Queda prohibido instanciar clientes de base de datos directamente en la lógica de negocio.

## 2. Gestión de Errores y Tipado Estricto
*   **Patrón Result (Next.js):** Está prohibido lanzar excepciones abiertas para lógica de negocio en el runtime de Next.js. Todo flujo debe retornar la estructura `Result<T>` (`Result.ok()` o `Result.fail()`).
*   **Patrón Result (Deno Edge Functions):** En el contexto de Supabase/Deno Edge Functions, donde no se pueden importar módulos Next.js, el contrato equivalente es `{ success: boolean, error?: string }` serializado como JSON. Este es el patrón canónico para los resultados de tool calls en el agente conversacional.
*   **TypeScript Estricto:** No se permite el uso del tipo `any` (salvo excepciones justificadas y documentadas explícitamente, como mapeos de respuestas RPC externas). Todo parámetro debe estar fuertemente tipado.

## 3. Ciclo de Vida y Asincronía en Edge Functions
*   **Patrón Fire-and-Forget con `void`:** Las tareas secundarias no bloqueantes (notificaciones, eventos de auditoría) que deben ejecutarse después de la respuesta principal se despachan con el operador `void` de TypeScript: `void asyncFn(args)`. Este patrón es el estándar del sistema para operaciones de notificación.
    ```typescript
    // ✅ Patrón correcto en este sistema
    void emitCreatedEvent(business, clientName, svcName, date, time, appointmentId)
    void sendClientBookingConfirmation(sender, 'created', ...)
    ```
*   **Uso de `ctx.waitUntil()`:** Aplica exclusivamente cuando el handler de la Edge Function recibe el objeto `ctx` (Deno `FetchEvent`) como segundo argumento y se necesita garantizar la ejecución hasta completar antes del garbage collection del isolate. En todos los demás casos, usar el patrón `void`.
*   **`Promise.all` para operaciones paralelas:** Cuando dos o más operaciones asíncronas independientes deben completarse antes de continuar (ej: verificar cuota de mensajes y cuota de tokens), deben ejecutarse en paralelo con `await Promise.all([...])`.

## 4. Multi-Tenant y Seguridad Estricta
*   **Aislamiento de Negocios:** Toda consulta o mutación a la base de datos debe estar blindada obligatoriamente por el parámetro `business_id` y validar la propiedad mediante el filtro `.eq('business_id', businessId)`.

## 5. Patrones de Agentes IA y Pipeline
*   **Orquestación del Bot:** Toda interacción con el LLM en flujos conversacionales debe estructurarse mediante el pipeline canónico del sistema (`buildWhatsAppPipeline`) y respetar el ciclo ReAct administrado por `runAgentLoop`.
*   **Capa Obligatoria de Guards:** Antes de procesar cualquier mensaje o llamada a las APIs de IA, se deben invocar estrictamente los middlewares de control de cuotas y flujo: `checkMessageRateLimit` y `checkTokenQuota`.
*   **Procesamiento Asíncrono de Tareas:** Los flujos que requieran desacoplamiento (como el procesamiento de pagos diferidos o tareas pesadas de fondo) deben utilizar el bus de mensajes del sistema basado en webhooks → QStash → workers, asegurando la idempotencia en el consumidor final.
*   **Persistencia Compleja:** Se prefiere el uso de Supabase RPC encapsulados sobre consultas REST directas para operaciones que involucren mutaciones críticas de estado.

## 6. Resiliencia y Dead Letter Queue (DLQ)
*   **Errores Fatales No Reintentables:** Cuando un Edge Function encuentra un error fatal de lógica (un bug, un crash de parsing, una excepción no controlada) que NO debe ser reintentado por QStash, debe retornar HTTP `202 Accepted` (no `500`). El error se persiste en la Dead Letter Queue vía `logToDLQ(rawBody, error, 'nombre-funcion')` para auditoría.
    ```typescript
    // ✅ Patrón correcto para errores fatales en Edge Functions
    captureException(error, { stage: 'webhook_post_handler' })
    await logToDLQ(rawBody, error, 'process-whatsapp')
    return json({ error: 'Internal logic failed, safely isolated to DLQ' }, 202)
    ```
*   **Justificación:** Retornar `500` haría que QStash reintente infinitamente un error no recuperable, amplificando el daño. El `202` confirma recepción al llamador y sella el mensaje en la DLQ para revisión manual.
*   **Errores Transitorios Reintentables:** Para errores de rate-limiting de LLM o circuit breaker abierto, retornar `503` con header `Retry-After: N` para que QStash reintente automáticamente tras el período indicado.

## 7. Documentación y Trazabilidad (SDD)
*   **Cierre documental obligatorio:** Ninguna tarea de código (feature nueva, fix de bug, refactor, cambio de config) se considera terminada hasta actualizar la documentación que describe ese comportamiento — al menos el `manifest.md` del módulo tocado (si cambió un contrato, invariante, cobertura o flujo) y, cuando el cambio sea relevante para el sistema en general, la tabla "Historial de Versiones" de `docs/specs/INDEX.md`.
*   **Alcance:** aplica también a docs fuera de `docs/specs/` que describan ese mismo comportamiento (README, ADRs, `docs/architecture/*`) si la afirmación queda desactualizada por el cambio.
*   **Registro de trade-offs:** Todo trade-off tomado durante la implementación (ej. alcance reducido por tiempo, simplicidad vs. cobertura, performance vs. legibilidad, librería X sobre Y) debe documentarse en su archivo correspondiente — un ADR en `docs/architecture/adr/` si es arquitectónico o cross-cutting, o el `manifest.md` del módulo si es local a un módulo. Cada trade-off documentado debe reflejar que la decisión surge de la combinación de sugerencias del agente y decisiones del usuario/equipo, no de una elección unilateral y silenciosa del agente.
*   **Justificación:** un spec o doc desactualizado es tan peligroso como código sin tests — rompe la LEY CERO para la siguiente tarea, que partirá de una descripción falsa del sistema. Los trade-offs no documentados se repiten o se revierten a ciegas porque nadie recuerda por qué se eligieron.
