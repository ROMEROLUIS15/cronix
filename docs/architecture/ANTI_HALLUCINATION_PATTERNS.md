# Anti-Hallucination Patterns in Cronix

This document centralizes the architectural philosophy and defensive mechanisms implemented in the Cronix AI Agent ecosystem (Voice and WhatsApp).

The fundamental principle of the system is: **"Transactional precision kills creativity"**. Large Language Models (LLMs) are excellent at understanding natural intent but inherently poor at performing mathematical calculations, reasoning relative dates, or confirming transactions without hallucinating parameters.

To guarantee `100%` deterministic operations and prevent harmful hallucinations (e.g., booking at incorrect times or inventing clients), Cronix utilizes a **5-Pillar Defensive Architecture**.

---

## 1. Template-Based Response (Response Bypass)

LLMs often "hallucinate" details when asked to rewrite and confirm a transaction that just occurred. To avoid this, we remove the responsibility of the final response from them.

### Implementation
- **WhatsApp Agent**: `process-whatsapp/prompt-builder.ts → renderBookingSuccessTemplate()` intercepta el flujo tras un `confirm_booking` exitoso y emite la confirmación sin re-llamar al LLM.
- **Voice Agent (dashboard)**: cada `ICapability` declara `bypassLLM: true`. En `voice-worker/agent.ts` el set `BYPASS_CAPABILITIES` hace que la prosa devuelta por la tool se entregue tal cual como respuesta del turno — la segunda pasada del LLM nunca ocurre. El bypass aplica incluso en fallo (`"¿A qué hora?"`, `"Hay varios clientes similares…"`) para preservar las preguntas de desambiguación de la tool.

**Benefit:** Imposibilidad matemática de que el LLM se equivoque en la hora/fecha confirmada; además, 1 llamada LLM menos por turno (latencia y costo).

---

## 2. Input Bypass (Fast Paths)

For exclusive **deterministic read** operations, calling an LLM is unnecessarily slow and error-prone.

### Implementation
En `voice-worker/agent.ts`, antes de construir el prompt se evalúa la intención del usuario contra el registro de capabilities:
- `registry.detectFastPath({ text, today, timezone, history, lastRef, services })` itera por orden de prioridad (list → reschedule → cancel → delete-client → schedule → last-visit → search-clients → get-services → create-client → available-slots).
- Cada capability owna su propio `fast-path.ts` con detectores deterministas (regex word-boundary, parser de fechas ES en `core/date-parser.ts`, parser de horas en `core/time-parser.ts`, fuzzy en `core/fuzzy.ts`).
- Si hay match: `executeByName()` consulta Supabase → texto → Deepgram TTS. **Cero llamadas al LLM**.
- Resolución anafórica ("reagéndala", "cancélala") usa `lastRef` persistido en Redis para no exigir al usuario repetir el nombre del cliente.

**Benefit:** Latencia <500 ms para lecturas y escrituras inequívocas; riesgo cero de alucinación de parámetros o de fecha.

---

## 3. Transactional RAG (Grounding vs Long-Term Memory)

Unlike a general knowledge chatbot, a transactional agent needs **immediate precision**, not a "Long-Term Memory" of past conversations stored in vector databases.

### Implementation (Context Injection)
En lugar de buscar en tablas `ai_memories` con embeddings (>500 ms de latencia), usamos **Direct Grounding**:
- WhatsApp: `process-whatsapp/context-fetcher.ts` carga servicios + slots reservados + `aiRules`.
- Voice worker: `index.ts → loadBusinessContext()` ejecuta tres queries paralelas (`businesses.settings`, `services WHERE is_active=true`, `appointments` del día) y las inyecta en `BusinessContext` → `buildSystemPrompt()`.
- Todo el inventario relevante para este segundo va al system prompt como texto crudo, no embeddings.

**Benefit:** The LLM has perfect "RAM memory" of what is available at this exact second, eliminating "availability hallucination" (offering already booked slots).

---

## 4. Context Audit

"Context Injection" can become a double-edged sword if we inject too much irrelevant information, contaminating the model's attention (Lost in the middle).

### Implementation
1. **Filtrado temporal en DB**: al cargar citas del día las queries usan `.gte('start_at', ...).lte('start_at', ...)` en zona horaria del negocio, descartando ya las citas pasadas o de otros días.
2. **Frame-boundary corpus cutoff** (voice-worker `index.ts`): el "corpus de usuario" que alimenta a los guards anti-alucinación se corta en el último turno de asistente que NO sea pregunta. Es decir, un mensaje de cierre ("Listo. Agendé…", "No encontré cita activa…") delimita un *frame* y los tokens previos quedan fuera. Las preguntas abiertas ("¿Para qué servicio?") mantienen el frame abierto para que la recolección multi-turno funcione.

**Benefit:** Prompt liviano (ahorro de tokens) y, sobre todo, los guards no se contaminan con tokens de intents pasados — el bug previo de "el corpus recordaba el sábado 5pm de una reagendación fallida" desaparece.

---

## 5. Date Guards and Strict Prompting (Negative Constraints)

LLMs frequently fail when calculating date jumps (e.g., "the day after tomorrow").

### Date Guards (Argument Interceptors)
Si el usuario dice "pasado mañana" en el audio, el LLM puede inventar la fecha en `get_available_slots` o `smart_schedule`. Solución: `detectTemporalIntent()` en `voice-worker/agent.ts` corre regex con word-boundary sobre el texto del usuario y, para toda tool del set `DATE_TOOLS` (`get_appointments_by_date`, `get_available_slots`, `smart_schedule`, `cancel_booking`, `reschedule_booking`), sobre-escribe `args.date` con el ISO determinista antes de enviarlo a DB. El LLM propone la intención, el código dispone la fecha.

### Negative Constraints (Prompt Engineering)
En `voice-worker/prompt.ts` y `process-whatsapp/prompt-builder.ts` se aplican directivas imperativas:
- *"Hoy es {dayName} {today}. NO calcules, copia textualmente."*
- *"Si no llamaste a `search_clients`, NO SABES si el cliente existe."*
- *"Bajo ninguna circunstancia inventes horarios. Sólo ofrece los que la DB retornó."*

### Per-Turn Deduplication (capa extra)
`agent.ts` mantiene `executedFingerprints = Set<"tool::sortedArgsJSON">`. Si el modelo intenta repetir el mismo write en el mismo turno, se rechaza con un mensaje que fuerza la síntesis. Evita doble booking si Llama entra en bucle.

**Benefit:** Última línea de defensa. Si el LLM no tiene info verificada por una tool, está obligado a pedir aclaración en lugar de inventar para complacer al usuario.
