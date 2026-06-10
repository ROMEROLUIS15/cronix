# Manifiesto de Dominio: Agente de Voz (Voice Worker)

## 1. Propósito y Diferencia con el Bot de WhatsApp

El Voice Agent es una Edge Function (`supabase/functions/voice-worker/`) diseñada exclusivamente para el **DUEÑO / STAFF del negocio**. A diferencia del bot de WhatsApp (orientado a clientes que agendan sus propias citas), el Voice Agent permite al dueño **gestionar su negocio por voz**: consultar agenda, agendar clientes, cancelar/reagendar citas, buscar clientes, listar servicios, entre otras operaciones.

El agente recibe audio o texto, transcribe, ejecuta intenciones vía LLM o fast path, sintetiza respuesta de voz y retorna un objeto `VoiceWorkerResponse`.

## 2. Contrato HTTP

### Request
- `POST /functions/v1/voice-worker`
- Autenticación: JWT vía header `Authorization: Bearer <token>` (verificado por `verify_jwt=true` en `supabase/config.toml`)
- Dos modos de entrada:
  - **Multipart form-data**: campo `audio` (Blob) + `timezone`
  - **JSON**: `{ text: string, timezone: string, history?: Array<{role, content}> }`
- Rate limit: 30 requests/min por usuario

### Response (`VoiceWorkerResponse`)

```ts
{
  text:            string       // Texto final para TTS
  audioUrl:        string | null // data: URL con mp3 base64, o null si TTS falló
  actionPerformed: boolean      // True si una herramienta de escritura se ejecutó
  transcription:   string       // Transcripción STT del input
  modelUsed:       string       // Proveedor LLM usado (para logging)
}
```

## 3. Pipeline: STT → Agent Loop → TTS

```
[Audio/Texto] → STT (Deepgram Nova-2) → Agent Loop → TTS (Deepgram) → Response
```

### STT
- Deepgram Nova-2 (modelo `nova-2-general`)
- Si el input es texto, se salta STT

### Agent Loop (máximo 3 pasos)

1. **Fast Path detection**: recorre las 11 capabilities en orden de prioridad. Si una matchea el texto del usuario, ejecuta la tool directamente sin LLM.
2. **Date Override**: `detectTemporalIntent()` analiza el texto del usuario buscando "hoy", "mañana", "pasado mañana". Si encuentra uno, calcula la fecha ISO real y la fuerza en cualquier tool call del LLM que tenga parámetro `date`. Esto protege contra alucinaciones de fecha del LLM.
3. **LLM Loop** (stepLlmLoop, máx 3 iteraciones):
   - Envía historial + tool definitions al proveedor LLM
   - Ejecuta tool calls secuencialmente con **dedup por fingerprint**: `buildToolFingerprint()` produce un hash determinista de los argumentos; si el mismo fingerprint aparece dos veces en el mismo turno, el segundo se bloquea con mensaje `"Esta acción ya fue ejecutada en este turno con los mismos datos."`
   - Si hay un solo tool call exitoso con `bypassLLM=true`, salta la síntesis del LLM y usa el resultado directo de la tool como respuesta
   - Si no hay tool calls, usa el texto generado por el LLM

### Output fallbacks (en stepLlmLoop)
- Sin texto final pero `actionPerformed=true` → `"Listo."`
- Sin texto final y sin acción → `"No te entendí bien, ¿puedes repetir?"`

### TTS
- Deepgram TTS (modelo `aura-2-athena-en-es` para español latinoamericano)
- Retorna `data: URL` con mp3 base64

## 4. Capacidades (Tools)

### Registro central (`_shared/registry.ts`)

Las 11 capabilities se registran en orden de prioridad en el array `CAPABILITIES`:

| Capability | Directorio | WRITE / READ | bypassLLM |
|---|---|---|---|
| `nextAppointment` | `next-appointment/` | READ | Sí |
| `listAppointments` | `list-appointments/` | READ | Sí |
| `reschedule` | `reschedule/` | WRITE | Sí |
| `cancel` | `cancel/` | WRITE | Sí |
| `deleteClient` | `delete-client/` | WRITE | Sí |
| `schedule` | `schedule/` | WRITE | Sí |
| `lastVisit` | `last-visit/` | READ | Sí |
| `searchClients` | `search-clients/` | READ | Sí |
| `getServices` | `get-services/` | READ | Sí |
| `createClient` | `create-client/` | WRITE | Sí |
| `availableSlots` | `available-slots/` | READ | Sí |

**Clasificación:**
- **WRITE (5)**: schedule, cancel, reschedule, create-client, delete-client
- **READ (6)**: list-appointments, next-appointment, search-clients, last-visit, get-services, available-slots

**Shared infra** en `_shared/`: `Capability.ts` (interface `ICapability`) y `registry.ts` (registro, dispatch, fast path detection).

Cada capability implementa `detectFastPath()` (regex determinista) y `execute()` (lógica de negocio). `bypassLLM=true` en todas — cuando es la única tool call exitosa, el `result` de la tool se usa directamente como respuesta hablada.

## 5. Regla de lastRef (Anáfora)

El agente mantiene una referencia a la última cita modificada (`lastRef`) dentro de la sesión. Esto permite resolver expresiones anafóricas como "reagéndala" o "cancélala" sin que el usuario repita el nombre del cliente.

### Contrato
```ts
lastRef?: {
  appointmentId: string
  clientName:    string
  serviceName:   string
  date:          string
  time:          string
} | null
```

### Flujo
1. Cuando un write tool (schedule, reschedule) se ejecuta con éxito, `buildNotificationFromWrite()` produce un `lastRefCandidate` con los datos de la cita.
2. `agent.ts` persiste `lastRefCandidate` en el output del agente.
3. `index.ts` lo almacena en la sesión (Redis) para el siguiente turno.
4. En el turno siguiente, el fast path de `reschedule` y `cancel` usa `input.lastRef` para inferir el `appointmentId` sin preguntar al usuario.
5. Si la acción fue `cancelled`, `lastRefCandidate` se setea a `null` (la cita ya no existe).

## 6. Criterios de Aceptación

### AC-1 — Date Override protege contra alucinaciones de fecha
- DADO un usuario que dice "agenda para mañana",
- CUANDO el LLM alucina y pasa `date=2026-12-25` en lugar de la fecha real de "mañana",
- ENTONCES `applyDateOverride()` reemplaza el valor con la fecha ISO calculada por `detectTemporalIntent()` y emite un warning en consola.

### AC-2 — Tool call duplicado en el mismo turno se bloquea
- DADO un LLM que genera dos tool calls con el mismo nombre y argumentos idénticos en un mismo turno,
- CUANDO `stepLlmLoop` itera sobre ellos,
- ENTONCES el segundo tool call se bloquea (no se ejecuta), no cuenta como `successfulCallCount` y retorna mensaje "Esta acción ya fue ejecutada en este turno con los mismos datos."

### AC-3 — Sin respuesta final del LLM pero con acción exitosa → retorna "Listo."
- DADO un LLM loop que ejecuta tool calls exitosas pero no produce `finalText` (content vacío o nulo),
- CUANDO `actionPerformed=true` y `finalText.trim()` está vacío,
- ENTONCES el pipeline retorna `finalText = "Listo."`.

### AC-4 — Sin texto de usuario entendible → retorna "No te entendí bien"
- DADO un LLM loop que no ejecuta tool calls y no produce `finalText` (content vacío o nulo),
- CUANDO `actionPerformed=false` y `finalText.trim()` está vacío,
- ENTONCES el pipeline retorna `finalText = "No te entendí bien, ¿puedes repetir?"`.

## 7. Motor de Resolución de Clientes por Similitud (Fuzzy Matching)

El Voice Agent no hace búsqueda exacta de nombres. Usa un motor
fonético-fuzzy en `core/fuzzy.ts` que resiste errores de STT y
variaciones de escritura en español latinoamericano.

### Algoritmo (dos niveles)

**Nivel 1 — Token exacto o fonético** (alta prioridad):
Un candidato pasa si cualquier token del query aparece
literalmente o fonéticamente entre los tokens del candidato.

Equivalencias fonéticas aplicadas (función `phoneticKey()`):
- z / c(e,i) → s  ("Lizet" = "Lisset" = "Licet")
- h silent → Ø   ("Lisseth" = "Lisset")
- v → b           ("Vázquez" = "Bázquez")
- ll → y          ("Yolanda" = "Llolanda")
- qu → k          ("Vázquez" → "Bázquez" → "baskes")
- dobles → simple ("Lisseth" = "Liseth")

**Nivel 2 — Prefijo compartido** (fallback):
Si no hay token exacto, se acepta un candidato si comparte un
prefijo de ≥4 caracteres (literal o fonético) con algún token
del query. Protege contra STT que recorta nombres.

### Umbrales de Confianza

| Constante | Valor | Significado |
|---|---|---|
| `FUZZY_THRESHOLD` | 0.72 | Similitud mínima para ser candidato |
| `WRITE_CONFIDENCE_THRESHOLD` | 0.80 | Mínimo para operar sin confirmar (writes) |
| `FUZZY_EXACT_TOKEN_CONFIDENCE` | 0.90 | Floor para matches de token exacto |
| `FUZZY_AMBIGUOUS_GAP` | 0.10 | Diferencia mínima para que el top gane |

### Resultados posibles de `fuzzyFind()`

| Status | Cuándo | Respuesta del agente |
|---|---|---|
| `found` + confidence ≥ 0.80 | Match claro | Procede directamente |
| `found` + confidence < 0.80 | Match débil | `needsConfirmation()` → pregunta al usuario |
| `ambiguous` | Dos candidatos similares | Lista nombres: "¿Cuál es: Ana Torres o Ana Ruiz?" |
| `not_found` | Sin match | Ofrece registrar como cliente nuevo |

### Regla de Seguridad para Operaciones de Escritura

Las capabilities de WRITE (`schedule`, `reschedule`, `cancel`,
`delete-client`) NUNCA actúan con confianza < 0.80.
Las capabilities de READ (`search-clients`, `last-visit`) sí
pueden operar con confianza baja — son inofensivas.

### AC adicional — AC-5 — Fuzzy matching resuelve errores de STT

- DADO un dueño que dice "agenda a Maryori" y STT transcribe "Maria Yori",
- CUANDO `resolveClient(ctx, "Maria Yori")` ejecuta `fuzzyFind()`,
- ENTONCES si existe "Maryori González" con token fonético match,
  retorna `status: 'found'` con `confidence ≥ 0.90`,
  y la cita se agenda sin preguntar de nuevo al usuario.

- DADO que existen "María Torres" y "María Ruiz" en el roster,
- CUANDO el dueño dice "agenda a María",
- ENTONCES `fuzzyFind()` retorna `status: 'ambiguous'`
  y el agente pregunta "¿Cuál María: Torres o Ruiz?"
  sin ejecutar ninguna escritura.
