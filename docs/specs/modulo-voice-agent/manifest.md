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

1. **Fast Path detection**: recorre las 12 capabilities en orden de prioridad. Si una matchea el texto del usuario, ejecuta la tool directamente sin LLM.
2. **Date Override**: `detectTemporalIntent()` analiza el texto del usuario buscando "hoy", "mañana", "pasado mañana". Si encuentra uno, calcula la fecha ISO real y la fuerza en cualquier tool call del LLM que tenga parámetro `date`. Esto protege contra alucinaciones de fecha del LLM.
   - **Resolución de año en fechas sin año (`core/date-parser.ts`, `parseDateExpression`)**: para referencias como "el 9 de mayo" sin año explícito, el parámetro `prefer` decide cuál año se asume:
     - `'future'` (default): la próxima ocurrencia futura — usado por `schedule`, `reschedule`, `cancel`, que nunca operan sobre fechas pasadas.
     - `'nearest'`: la ocurrencia más cercana a hoy (año previo/actual/siguiente) — usado por `listAppointments` para consultas de agenda ("qué citas tuve el 9 de junio"), donde una fecha pasada debe resolver al pasado más cercano y no rodar al año siguiente.
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

Las 12 capabilities se registran en orden de prioridad en el array `CAPABILITIES`:

| Capability | Directorio | WRITE / READ | bypassLLM |
|---|---|---|---|
| `nextAppointment` | `next-appointment/` | READ | Sí |
| `listAppointments` | `list-appointments/` | READ | Sí |
| `clientAppointments` | `client-appointments/` | READ | Sí |
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
- **READ (7)**: list-appointments, next-appointment, client-appointments, search-clients, last-visit, get-services, available-slots

`clientAppointments` (`get_client_appointments`) lista las citas futuras
activas (pending/confirmed, máx. 5) de UN cliente — "¿qué citas tiene Ana?",
"¿cuándo viene Lisset?". Antes de existir, el LLM respondía esa pregunta
desde el extracto "CITAS DE HOY" del prompt o inventaba. Su detector cede
ante fechas ("citas de mañana" → list-appointments), intención pasada
("última cita de Ana" → last-visit), nombres de servicio del catálogo y
cualquier verbo de escritura.

`getServices` (`detectGetServices` en `get-services/fast-path.ts`) intercepta
preguntas de catálogo ("qué servicios tienes", "servicios disponibles", "qué
ofreces", "menú"/"catálogo") de forma determinista y read-only. Antes de
existir, estas frases se filtraban al LLM como nombre de cliente hacia
`search_clients`, y el agente respondía "no encontré a 'servicios
disponibles' entre tus clientes". El detector es conservador: frases con
verbo de escritura ("agéndale el servicio de manicure a Ana") nunca matchean.

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

### AC-6 — `listAppointments` resuelve fechas pasadas sin año al año más cercano
- DADO un dueño que dice "¿qué citas tuve el 9 de junio?" en una fecha posterior (ej. 13 de junio del mismo año),
- CUANDO `listAppointments` invoca `parseDateExpression(text, today, 'nearest')`,
- ENTONCES la fecha resuelve al 9 de junio del año actual (el pasado más cercano), no al 9 de junio del año siguiente.
- Contraste: `schedule`/`reschedule`/`cancel` llaman `parseDateExpression(text, today)` (default `'future'`), por lo que la misma frase en un flujo de agendamiento resuelve a la próxima ocurrencia futura.

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
- gu+vocal → g    ("Guardiana" = "Gardiana" — STT encaja nombres raros en palabras de diccionario)
- dobles → simple ("Lisseth" = "Liseth")

**Equivalencia de clase vocal (`vowelClassKey()`)** — segunda capa sobre la
clave fonética, para la confusión vocal que el STT en español produce más:
- i ↔ e  ("Marielis" = "Marieles")
- o ↔ u  ("Yuseli" = "Yoseli", "Yusmary" = "Yosmary")
- `a` se mantiene distinta (NO se fusiona con o/u)
- TODAS las consonantes se preservan intactas

Es general para cualquier nombre, no una lista. Resuelve la clase de bug
"digo Yuseli y me da Joselyn/Yoselin": con la clave de clase vocal, el nombre
correcto SIEMPRE entra como candidato. Como solo mueve vocales, la precisión
por consonante se mantiene: Lisbeth≠Lizeth (b), Cardi≠Sardi (c dura),
Pedro≠Petro (d/t), Marcelo≠Marcela (a≠o). Se aplica con los MISMOS gates de
longitud (≥4 para prefijo) que la clave fonética, así no introduce colisiones
cortas. Si DOS clientes reales son variantes vocálicas entre sí (p.ej. existen
"Yuseli" y "Yoseli" como personas distintas), el resultado es `ambiguous` →
el agente pregunta, nunca elige en silencio.

Además, los tokens descriptores del lado del query ("cliente", "clienta", "señora", "sr", etc.) se excluyen antes de matchear: nunca otorgan el tier de token exacto (rosters importados contienen apellidos literales "Cliente" y un descriptor suelto daría 0.90 de confianza sobre la persona equivocada).

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

### Regla de Seguridad: Writes y Reads que nombran a una persona

Las capabilities de WRITE (`schedule`, `reschedule`, `cancel`,
`delete-client`) NUNCA actúan con confianza < 0.80: con `found` débil
confirman vía `needsConfirmation()` + `formatConfirmationPrompt()`.

`last-visit` es un **read sensible**: aunque no muta datos, lee el historial
de UNA persona nombrada, y leer el de la persona equivocada es un fallo de
correctitud (y de privacidad). Por eso aplica el MISMO gate de confianza que
los writes — con `found` + confianza < 0.80 vuelve a preguntar
("Entendí … ¿confirmas?" / "¿a quién te refieres?") en vez de responder.
La invariante que evita el nag: los matches de token exacto/fonético/clase
vocal pisan a 0.90 (`FUZZY_EXACT_TOKEN_CONFIDENCE`), así que un cliente
nombrado con claridad responde directo al 100% y solo los matches realmente
débiles (similitud/prefijo recortado) disparan la confirmación. El prompt es
determinista sobre una capability `bypassLLM` → no consume tokens de LLM.

Los reads de bajo riesgo que NO exponen el registro de una sola persona
(`list-appointments`, `get-services`, `available-slots`, y `search-clients`
que ya lista varios candidatos) sí pueden operar con confianza baja — son
inofensivos y confirmar cada consulta destruiría la UX.

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

## 8. Capa Antialucinación: Corpus de Frame + Mention Guards

Complementa el Date Override y el dedup del §3. Vive en
`core/conversation/frame.ts` y `core/conversation/slot-extractor.ts`.

### Corpus de usuario por frame

`buildUserCorpus()` concatena el input actual + los turnos de usuario desde
el último **frame boundary** (máx. 4000 chars). Un frame cierra en mensajes
asistente terminales: `Listo…`, `Cancelado…`, `Reagendado…`, `Agendado…`,
`No encontré…`, `No pude…`, `No hay…`, `…ya está ocupado`, y
`Cliente … eliminado` (un cliente borrado no tiene anáfora legítima).

**Invariante de apertura:** los listados READ ("Tienes 3 citas…",
"Horarios libres…", "Sí, X está entre tus clientes…"), el alta
("Cliente X registrado.") y el rechazo de borrado ("No se puede eliminar…")
NO cierran el frame — su turno de usuario alimenta el write siguiente
("busca el teléfono de Ana" → "agéndala mañana"). Cerrar ahí evicta el
nombre del corpus y los guards rechazarían el follow-up legítimo.

### Mention guards (anti-sustitución)

Toda capability que reciba un nombre del LLM verifica que ese nombre
provenga del corpus mediante `nameMentionedInCorpus()`:

- Matching por **fronteras de token** (nunca substring): igualdad literal,
  igualdad fonética (`phoneticKey`), o prefijo ≥4 chars (`shareToken`,
  el mismo puente del resolver fuzzy).
- Los conectores ("de", "la", "del"…) del lado del nombre nunca otorgan
  match — "Corte de cabello" no pasa por el "de" de cualquier frase.
- Corpus vacío ⇒ fail-open (sin contexto no se puede verificar).
- `smart_schedule` verifica además hora y fecha (`timeMentionedInCorpus`,
  `dateMentionedInCorpus`) y, si registra cliente nuevo con `phone`, los
  dígitos deben aparecer en el corpus (número inventado ⇒ se descarta).

### Frontera LLM→tool: solo args declarados

`stepLlmLoop` filtra los args de cada tool call contra las `properties` del
JSON Schema declarado (`stripUndeclaredArgs`). Args internos del fast path
(`appointment_id` resuelto desde `lastRef`) son **inalcanzables desde el
LLM** — un `appointment_id` fabricado ya no rutea cancel/reschedule a la
rama anafórica que salta los guards.

Antes de `stripUndeclaredArgs`, `coerceToolArgs` (`core/tool-args.ts`)
normaliza el `arguments` parseado del tool call a un objeto plano: Llama 3.3
emite `arguments: "null"` (y a veces `"[]"`) para tools sin parámetros como
`get_services`, y un `null`/array/primitivo hacía crashear
`buildToolFingerprint`'s `Object.keys()` con un `TypeError` no capturado —
esto tumbaba el turno completo (`HTTP 500` / `LLM_EXCEPTION`). Cualquier valor
que no sea un objeto plano se convierte en `{}`, y la tool corre con args
vacíos.

### Write-guard constitucional

`schedule`, `cancel`, `reschedule` y `delete-client` invocan
`ctx.runWriteGuard` (ConstitutionalReviewer, fail-open) antes del SQL.

**Autoridad de veto acotada al radio de daño (voz):** el reviewer corre para
las 4 writes, pero su **hard-block solo aplica a `delete_client`** — el único
write genuinamente destructivo (borra un cliente). `REVIEWER_HARD_BLOCK_TOOLS`
en `agent.ts` contiene únicamente `delete_client`. `book_appointment`,
`cancel_appointment` y `reschedule_appointment` son estado de cita reversible
(crean o cambian un status) y sus riesgos reales (cliente equivocado,
doble-booking, slots/nombres alucinados) ya están cubiertos de forma
determinista por los mention guards, el umbral fuzzy + confirmación, la
resolución de la cita por cliente y `findConflicts`. Para esas, un veredicto
distinto de `allow` se **degrada a warn**: se registra en consola y en el trace
(`REVIEWER_BLOCKED` como errorCode de observabilidad) pero **no rompe la
operación**. Motivo: el reviewer (llama-3.1-8b) producía falsos positivos en
flujos legítimos —"crear cliente → agendarlo" y "agendar → luego cancelar/
reagendar" (cambio de planes)— al leer el episodio reciente en `recentMemory`
y disparar `DUPLICATE_INTENT`/`CONTRADICTS_MEMORY`. La rúbrica v4 refuerza
además que un `create_client` reciente no implica duplicado/contradicción para
un booking (regla 7) y que rectificar una cita recién creada es legítimo
(regla 8).

- **Memoria episódica desde voz**: todo write exitoso (fast path y LLM
  path) registra `"<lo que dijo el usuario> → <resultado hablado>"` con
  scope `{businessId, user, userId}` y TTL 180 días (`recordWriteEpisode`,
  fire-and-forget per constitución §3). Sin esto, `recentMemory` llegaba
  siempre vacía en voz y la regla 5 de la rúbrica reducía al reviewer a
  `UNSAFE_ARGS`.
- **Rúbrica v2 + `conversationWindow`**: el `ReviewRequest` lleva los
  últimos 6 turnos del historial (300 chars c/u), y la rúbrica instruye
  resolver confirmaciones cortas ("sí", "dale") contra la acción que el
  asistente propuso. Los espejos Node/Deno del supervisor se mantienen en
  paridad byte-a-byte (test `contracts-parity`).
- Pendiente: el call-site de WhatsApp aún no pasa `conversationWindow`
  (campo opcional; requiere gate de `modulo-whatsapp-citas`).

### Invalidación de caché del dashboard (escritura cross-canal)

El dashboard (Next.js) lee `clients`/`appointments`/`dashboard` desde un caché
Upstash (`lib/cache.ts`, TTL 120–180s). El agente de voz (Edge Function Deno)
escribe directo a Postgres y **no** pasa por el repositorio Node que invalida
ese caché, así que toda escritura por voz quedaba invisible en el dashboard
hasta que expiraba el TTL. Por eso, tras CUALQUIER write exitoso, los canales Deno invalidan ese caché vía
el seam compartido `invalidateDashboardCache(businessId)`
(`_shared/cache-invalidation.ts`, fire-and-forget per §3) que borra las claves
`v1:cache:{businessId}:{clients|appointments|dashboard}:*` del MISMO Upstash.
Lo usan **voz** (`agent.ts`, fast path y LLM path) y **WhatsApp**
(`process-whatsapp/appointment-repo.ts`, en book/reschedule/cancel) — un solo
dueño del concern, no copiado por canal. Debe mantener en sync el formato de
clave y `CACHE_VERSION` con `lib/cache.ts`.

### Observabilidad de guards

Toda denegación de guard retorna `error: 'GUARD_REJECTED'` (y las del
reviewer `REVIEWER_BLOCKED`); el trace las registra con ese `errorCode`,
distinguible de `TOOL_FAILURE`, para medir tasa de captura y falsos
positivos en `/dashboard/observability`.

### Invariantes adicionales de capabilities

- `available-slots`: un slot solo se ofrece si `inicio + duración ≤ cierre`
  (recorrido por minutos; cierres fraccionarios como 18:30 ofrecen el
  último slot completo).
- `delete_client`: con match único, `any_duplicate` NUNCA salta la
  confirmación de baja confianza; solo un `phone` que coincida con el del
  candidato cuenta como pick deliberado. `getActiveClients` ordena por
  `created_at` para que los picks ordinales ("el primero") sean
  deterministas entre turnos.
- `smart_schedule` acepta `phone` opcional para el cliente nuevo
  (`register_new_client=true`); sin él, el cliente queda sin teléfono.

## 9. Dimensión de Staff (terreno para el sprint multi-empleado)

Decisión de producto tomada (2026-06-12): **una cita por voz se asigna al
miembro del equipo que el dueño NOMBRE** ("con Marielys", "conmigo"). Si no
nombra a nadie, la cita queda **sin asignar** (`assigned_user_id = NULL`) —
la política de auto-asignación para negocios multi-staff se decidirá en el
sprint multi-empleado, no aquí.

### Implementado (groundwork)

- `core/repos/staff.ts`: roster activo (`users` con `business_id`,
  `is_active=true`, roles owner/admin/employee), `resolveStaffByName()` con
  la misma barra de confianza de writes (≥0.80; débil/ambiguo → pregunta,
  nunca adivina) y `extractStaffFromCorpus()` ("con <nombre>" / "conmigo"),
  que ignora candidatos que solapen tokens con el CLIENTE agendado
  ("agenda una cita con Ana" nombra al cliente, no al staff).
- `smart_schedule`: arg opcional `staff_name` (mention guard incluido; si
  no se puede trazar al corpus se descarta, no bloquea el booking), insert
  con `assigned_user_id`, y confirmación hablada "… con Marielys".
- `findConflicts(…, staffId?)`: cuando la cita tiene staff, el conflicto se
  evalúa SOLO contra la agenda de ese miembro; sin staff se mantiene el
  chequeo a nivel negocio (comportamiento histórico, correcto para negocios
  single-staff, que son los que no nombran a nadie). `reschedule` hereda el
  scope del `assigned_user_id` de la fila.

### Contexto de datos (verificado en prod 2026-06-12)

`appointments` tiene `assigned_user_id` e `is_dual_booking`; existen miles
de solapes activos legítimos a nivel negocio (multi-staff). Por eso
cualquier exclusion constraint anti double-booking debe ser **por
`assigned_user_id`** y respetar `is_dual_booking` — nunca por negocio.

### Pendiente para el sprint multi-empleado

- Política de asignación por defecto cuando no se nombra staff.
- RPC transaccional de booking + exclusion constraint per-staff (decidir
  semántica de `is_dual_booking` y de filas con staff NULL).
- `available-slots` por staff (requiere horarios laborales por empleado).
- Semántica de `is_dual_booking` en `findConflicts`.
