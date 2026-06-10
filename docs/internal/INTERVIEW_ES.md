# Cronix — Prep de Entrevista (ES)

> Movido desde `docs/architecture/TECHNICAL_DOCUMENTATION_ES.md` §28–29.
> Espejo exacto: `INTERVIEW.md` (EN).

---

## 1. Decisiones arquitectónicas (FAQ)

### ¿Por qué dos runtimes en lugar de monorepo unificado?

Las Edge Functions de Supabase corren en Deno. Deno tiene su propio resolver de módulos (`.ts` explícito en imports), no entiende paths `@/`, y usa `Deno.env`. Forzar un solo runtime me obligaría a:
- Bundlear Node → Edge con esbuild → latencia de deploy alta + debug doloroso.
- O abandonar Edge Functions y usar Vercel Cron (más caro y latencia mayor al hacer fetch hacia Postgres).

La opción que tomé (dos runtimes con `_shared/` duplicado + parity tests) es el balance entre simplicidad y reutilización.

### ¿Por qué RLS como base estructural?

Un `businessId: string` es indistinguible de "cualquier string" para TypeScript, así que la compuerta real es la BD: RLS (`current_business_id()` derivado del JWT) bloquea reads/writes cross-tenant sin importar el código de aplicación, y cada repo además filtra por `business_id`. Se prototiparon dos guards a nivel de tipos / por tool para hacer el check más difícil de olvidar (un `TenantContext` phantom-typed, y un `tenantGuard.verify()` por tool en los tools de IA Node), pero la capa de tools de IA nunca se cableó a producción y se eliminó (ver ADR-0006). `tenantGuard.verify()` sobrevive solo en el único tool de IA vivo de lectura, `get_today_summary`.

### ¿Por qué fail-open en el reviewer?

El reviewer es la capa 5 — las primeras 4 ya son suficientes para garantizar correctness. Si el reviewer falla (timeout Groq, JSON malformado, etc.), bloquear bookings legítimos es un costo mayor que dejar pasar un edge case anómalo. Las trazas registran cada fail-open para auditoría.

### ¿Por qué `PAYPAL_ENV=live` opt-in explícito?

Vercel inyecta `NODE_ENV=production` en TODOS los deploys, incluyendo previews de PR. Si confiáramos en `NODE_ENV` como señal, cada PR que un colaborador suba **cobraría dinero real** al desplegar su preview.

### ¿Por qué template determinista en WA success path en lugar de LLM?

Histórico: cuando el 70B tenía que sintetizar la respuesta final tras una tool exitosa, a veces respondía con 400 (rate-limit) → circuit-breaker abría → 503 → cliente sin respuesta. El template determinista (`renderBookingSuccessTemplate`) elimina ese punto de falla.

### ¿Por qué Zod como single source of truth?

Cada tool tiene un schema Zod. Ese schema sirve **simultáneamente** como:
1. Validador runtime del payload (`safeParse` antes de la DB).
2. Definición `function.parameters` para el LLM.

Si cambias un campo del schema, **ambos consumidores se actualizan automáticamente**.

### ¿Por qué confirmation gate pasa tools vacías en lugar de sanitizar la salida?

Sanitizar la salida es reactivo: el modelo ya pensó la tool, la emitió como texto, y nosotros la borramos. Pasar `tools=[]` es preventivo: el modelo **no ve** los schemas → no puede "alucinarlos". Eliminas la superficie de alucinación.

### ¿Por qué `recall` es obligatorio y lanza si falta?

El reviewer requiere `recentMemory` como input para juicio. Pasar `undefined` accidentalmente significaría que el reviewer juzga sin contexto y podría bloquear booking legítimos. La regla "siempre recall una vez por turno" garantiza que **el reviewer siempre vea la memoria real (o array vacío explícito)**.

### ¿Por qué `FOR UPDATE` en lugar de `INSERT ... ON CONFLICT`?

`ON CONFLICT` resolvería el caso "insertar la misma fila dos veces", pero aquí el problema es distinto: ya existe la fila (`saas_invoices` con `paypal_order_id`), y dos callers quieren **actualizarla** simultáneamente. `FOR UPDATE` es la primitiva correcta.

### ¿Por qué `business_id` en cada repository, si RLS ya filtra?

Defensa en profundidad. Si por error se desactiva RLS en una migración futura, el repositorio sigue filtrando. Si por error un repositorio se llama con service_role (que bypassa RLS), el filtro explícito en código sigue protegiendo.

### ¿Por qué memoria episódica + observabilidad separadas en lugar de una sola tabla?

Diferentes ciclos de vida:
- **Memoria** es input al modelo → debe ser fácilmente "recallable" por similitud + scope. Tabla compacta, indexada por `(business_id, actor_kind, actor_key)` + IVFFLAT vector.
- **Trazas** son output del modelo → metadata estructurada para BI + training.

### ¿Por qué zero-PII en el training export?

Una promesa contractual a los negocios: "tus datos de cliente no salen de tu tenant". La transformación pura a `TrainingSample` está restringida por TypeScript a campos estructurales — ni siquiera por accidente puede filtrar PII.

### ¿Por qué dos versiones del agente WhatsApp (8B decisor + 70B síntesis)?

- El 8B es más rápido y más barato para el bucle ReAct.
- El 70B genera respuestas más naturales.
- Hoy el 70B está mayormente saltado (template determinista) en success.

### ¿Por qué key rotation en `LLM_API_KEY` (CSV)?

El free tier de Groq se mide por key. Tener varias keys ($0 cada una) permite saturar gradualmente sin tocar plan paid.

### ¿Por qué Deepgram en lugar de Whisper de OpenAI?

- **Latencia**: Deepgram Nova-2 ~300-700ms vs Whisper ~1-2s.
- **Keywords boost**: Deepgram acepta lista de palabras a sesgar.
- **Free tier $200**: muchos minutos.
- **TTS Aura-2 en español neutral**: voz competitiva, latencia <500ms.

---

## 2. Guion de defensa por nivel

### Junior

"Cronix es un SaaS multi-tenant para agendar citas vía WhatsApp y un dashboard con asistente de voz. Está hecho con Next.js 15, React 19, TypeScript, Tailwind, Supabase (Postgres + Edge Functions + RLS) y Upstash (Redis + QStash). Yo escribí el frontend del dashboard, las server actions de pagos, los repositorios contra Supabase y los tests unitarios. Lo más interesante que aprendí: cómo aislar tenants con RLS de Postgres más un tenant guard por tool, y cómo evitar duplicar bookings con un fingerprint por turno."

### Middle

"El stack es Next.js 15 (App Router + RSC) sobre Vercel para el dashboard y Server Actions, y Edge Functions de Deno sobre Supabase para los agentes de IA (voice-worker, process-whatsapp) y los webhooks. La separación de runtimes es física — Node y Deno no se importan entre sí — y compartimos lógica duplicando byte-by-byte bajo `supabase/functions/_shared/` con parity tests que fallan al menor drift.

La IA usa Groq (Llama 3.3-70B + 3.1-8B con key rotation) y Gemini opcional como cadena de fallback. Embeddings con `gte-small` corriendo dentro del Edge runtime de Supabase. STT/TTS con Deepgram Nova-2/Aura-2. Todo en free tiers — el stack productivo cuesta $0/mes.

El aislamiento multi-tenant es de 3 capas: filtros `.eq('business_id', X)` + ownership asserts en cada repositorio, RLS en Postgres (`current_business_id()` del JWT), y un `ConstitutionalReviewer` semántico que revisa la coherencia de cada escritura de IA.

Pagos con tres pasarelas convergiendo a `saas_invoices`: PayPal con webhook async + RPC atómico `fn_finalize_paypal_payment` con `FOR UPDATE` (idempotencia atómica en Postgres), NOWPayments cripto vía QStash con back-pressure, y manual con aprobación admin. El sistema de referidos suma 30 días al referrer cuando su referido cierra el primer pago `finished`.

Tests: 114 archivos entre unit (Vitest), integration (contra Supabase local), components (RTL) y E2E (Playwright). Tests adversariales contra prompt injection y cross-tenant. Pre-push corre lint + tsc + vitest + npm audit; sin `--no-verify`."

### Senior

"El proyecto resuelve dos problemas de scale: alucinaciones de LLM en operaciones con efectos secundarios (booking), y aislamiento de datos en SaaS multi-tenant.

Para alucinaciones, implementé **10 mecanismos verificables** combinados: corpus mention guards (servicio/cliente/fecha/hora deben rastrearse al usuario), fast-paths totales sin LLM, date-guard determinista, frame-cutoff del corpus, per-turn fingerprint dedup, response bypass (`return_direct`), confirmation gate 2-turn que pasa `tools=[]` al modelo, embedded `<function>` recovery, router semántico con embeddings precalculados, y un constitutional reviewer fail-open con rubric versionada en código.

Para aislamiento, combiné 3 capas: repositorios filtrados + ownership asserts, RLS con `current_business_id()` derivado del JWT, y el constitutional reviewer sobre writes de IA detectando `TENANT_MISMATCH` semántico.

Decisiones notables que justifico:
- Duplicación byte-by-byte de `lib/ai/{memory,router,supervisor,training,observability}` bajo `supabase/functions/_shared/` con parity tests porque Deno y Node no se pueden importar y bundlear era más caro.
- Cero llamadas al LLM de síntesis en WhatsApp cuando la tool tuvo éxito: usar template determinista cierra el loop `400→circuit-breaker→503` que sufríamos.
- `PAYPAL_ENV=live` opt-in explícito porque Vercel pone `NODE_ENV=production` en previews — sin opt-in cada PR cobraría dinero real.
- Fail-open en el reviewer porque las capas estructurales (repos filtrados + RLS) son suficientes y bloquear bookings legítimos por flakiness del reviewer es peor que dejar pasar un edge case anómalo.
- Memoria episódica con TTL en lugar de retención eterna porque el reviewer solo necesita contexto reciente (10 min) para detectar `DUPLICATE_INTENT`.

Observabilidad: cada turno genera un `ai_traces` row con latencia, tokens, tool sequence (sin args), outcome y query_hash (SHA-256 truncado). Un cron diario muestrea hasta 500 trazas por negocio, las bucketiza y las exporta a `ai_training_exports` con `schema_version`. Cero PII garantizado por tipos.

Pagos idempotentes con RPC `fn_finalize_paypal_payment` usando `SELECT ... FOR UPDATE` — Postgres bloquea el segundo caller hasta que el primero commit, y el segundo ve `status='finished'` → retorna `already_processed`. Atómico a nivel DB, sin claim distribuido ni locks en aplicación.

Stack que cabe en $0/mes: Groq free tier + Gemini free + Deepgram $200 créditos + Supabase free + Upstash free + Vercel free. Latencia end-to-end voz: 1.2-2.0s. WhatsApp con QStash retry ladder absorbe los rate-limits del LLM transparentemente al cliente.

La suite cubre 114 archivos: tests adversariales contra prompt-injection, parity Node-Deno, fast-paths, RPC idempotency, RLS audit, E2E con Playwright. Pre-push corre lint + tsc + vitest + npm audit."
