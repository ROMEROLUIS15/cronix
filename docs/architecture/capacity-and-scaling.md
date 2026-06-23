# Capacidad y Escalado — Cronix

> Estado vivo del experimento de capacidad. Responde: ¿hasta cuántos negocios /
> usuarios aguanta el sistema, dónde está el cuello de botella, y qué se hace
> cuando se satura?

## TL;DR (al 2026-06-22)

- **El código y la base de datos NO son el cuello de botella** para el objetivo
  de 100–500 negocios / <100 usuarios. Probado localmente con 500 negocios /
  75.000 clientes / 600.000 citas: las queries del dashboard corren **<17ms** en
  estado estable, y la concurrencia **degrada en latencia sin errores** (0 fallos
  hasta 100 peticiones simultáneas).
- **El límite real es el tier de Supabase** (compute + pool de conexiones), no la
  arquitectura. Es una **perilla** (subir compute), no una reescritura.
- Pendiente (mañana): medir el techo **exacto del free tier** contra un proyecto
  desechable, y dejar listo el "menú" de escalado con trade-offs.

---

## 1. Método — por qué local primero

Toda la prueba de hoy corrió contra el **stack local de Docker** (`supabase start`),
que es Postgres + PostgREST + el mismo esquema/RLS/RPC/índices que producción.
**Cero consumo del free tier** (nada toca `*.supabase.co`). El harness vive en
`scripts/loadtest/` (ver su `README.md`):

```bash
supabase start
npm run loadtest:seed        # siembra set-based (LT_BUSINESSES, LT_CLIENTS_PER, …)
npm run loadtest:explain     # EXPLAIN ANALYZE de las queries calientes + Seq Scans
npm run loadtest:load        # rampa de concurrencia → curva p50/p95/p99
npm run loadtest:seed -- --reset
```

**Qué transfiere de local a prod:** la *forma* del escalado (qué query se vuelve
lenta, qué índice falta, dónde está el codo de concurrencia). **Qué no transfiere:**
los números absolutos atados al hardware — el box local es más potente que el
compute del free tier, así que el free satura *antes*.

---

## 2. Resultados — volumen de datos

500 negocios × 150 clientes × 8 citas (600k citas, 375k transacciones), estado
estable (tras `ANALYZE`):

| query | exec |
|---|---|
| `get_clients_debts` (agregación) | ~16 ms |
| dashboard · citas del mes (joins) | ~5 ms |
| metrics · cobrado / prestado | 1–2 ms |
| clientes · listado / gastos | <1 ms |

**Veredicto:** el esquema escala a 500 negocios sin problema. Los índices por
`business_id` aíslan bien — las queries por-tenant no se degradan con el total.

### ⚠️ Hallazgo: fragilidad por estadísticas obsoletas
Medido **justo tras la carga masiva, antes de `ANALYZE`**, `get_clients_debts`
explotó a **~6 minutos** (swing ~20.000×). No era índice faltante
(`appointment_services` sí tiene índice en `appointment_id`) — era el planner con
estimaciones erróneas eligiendo un plan catastrófico hasta que el autoanalyze se
puso al día. **Lección de operación:** correr `ANALYZE` tras todo import masivo,
restore de backup o migración con backfill; no esperar al autovacuum. (El seeder
ya lo hace.)

---

## 3. Resultados — concurrencia (local)

Rampa de VUs concurrentes contra `fn_get_monthly_metrics` vía PostgREST
(`service_role`, sin overhead RLS):

| VUs | req/s | err% | p50 | p95 | p99 |
|---|---|---|---|---|---|
| 10 | 837 | 0% | 10 ms | 18 ms | 28 ms |
| 25 | **1024** | 0% | 21 ms | 44 ms | 60 ms |
| 50 | 642 | 0% | 67 ms | 164 ms | 285 ms |
| 100 | 709 | 0% | 135 ms | 208 ms | 282 ms |

**Lectura:**
- **0 errores** en todos los niveles → el sistema degrada latencia, no se rompe;
  no hubo agotamiento de pool.
- **Codo ~25 concurrentes** (throughput tope ~1024 req/s). Más allá, añadir carga
  no sube throughput, solo latencia → saturación entre 25 y 50 concurrentes.
- **Para <100 usuarios:** son *usuarios*, no peticiones simultáneas. Con clics
  esporádicos + caché (React Query + Upstash), los golpes concurrentes a la DB son
  una fracción mínima del número de usuarios. Hay margen amplio.

---

## 4. Próxima prueba (mañana) — techo EXACTO del free tier

Objetivo: saber a qué capacidad real tolera el free tier y qué límite se toca
primero (compute, conexiones, tamaño de DB o egress).

### Runbook
1. **Crear un proyecto Supabase DESECHABLE** (segundo proyecto free) — **NUNCA**
   correr esto contra el proyecto de producción (tiene datos reales y está vivo).
2. Aplicar el esquema: `supabase link` al proyecto desechable + `supabase db push`
   (las migraciones del repo).
3. Sembrar el volumen objetivo (apuntar el seeder al proyecto desechable — requiere
   un opt-in deliberado; ver "Seguridad" abajo).
4. Correr `explain` (tiempos de query con el compute REAL del free tier) y `load`
   (rampa de concurrencia contra la URL cloud del desechable).
5. **Vigilar el dashboard de Supabase** durante la carga: CPU, número de conexiones,
   saturación del pooler (Supavisor), I/O. El primer recurso que se clave es tu
   techo.

### Qué límites del free tier verificar (valores actuales en el pricing/dashboard — cambian)
- **Compute:** instancia Nano compartida (CPU/RAM chicos) — satura en CPU mucho
  antes que el box local.
- **Conexiones:** tope de conexiones directas bajo + pooler (Supavisor, modo
  transacción) para más clientes. El serverless/edge debe ir por el **pooler
  (6543)**, no conexión directa.
- **Tamaño de DB** (límite de almacenamiento), **egress mensual**, **invocaciones
  de Edge Functions**, **MAU de Auth**.
- **Pausa por inactividad:** los proyectos free se pausan tras ~1 semana sin uso.

### Seguridad para la prueba cloud
El harness está **hard-guardado a 127.0.0.1** (`scripts/loadtest/db.ts`) para que
sea imposible apuntarlo a prod por accidente. Para la prueba del desechable hay que
añadir un opt-in EXPLÍCITO (ej. `LOADTEST_ALLOW_REMOTE=1` + el ref del proyecto
desechable verificado), nunca relajar el guard a ciegas. (Pendiente de implementar
mañana, antes de la prueba.)

---

## 5. Después de saturar el free tier — el "menú" de escalado

Orden recomendado: **del lever más barato/simple al más complejo.** Medir primero,
escalar después; no pre-optimizar.

| # | Palanca | Cuándo | Trade-off |
|---|---|---|---|
| 1 | **Subir compute tier** (Nano→Micro→Small…) | Primer recurso saturado = CPU/RAM | Lo más simple (una perilla, sin código); costo lineal. Sube CPU + tope de conexiones. Suele resolver el primer techo. |
| 2 | **Pooler bien usado** (Supavisor, modo transacción, 6543) | El serverless/edge agota conexiones directas | Modo transacción prohíbe features de sesión (prepared statements de sesión, LISTEN/NOTIFY). Verificar que toda ruta serverless use el pooler. |
| 3 | **Ampliar caché** (Upstash, ya en uso para dashboard) | Lectura-pesado; mismas queries repetidas | Complejidad de invalidación (ya hay un seam `_shared/cache-invalidation.ts`) + ventana de staleness. |
| 4 | **Pre-agregación / rollups** (tabla `*_daily_stats` actualizada en cada escritura o por cron) | Métricas del dashboard calculadas en vivo y caras a escala | Amplificación de escritura + consistencia vs velocidad de lectura. Ideal cuando lecturas >> escrituras. |
| 5 | **Optimizar queries frágiles** (ej. `get_clients_debts`) + índices | EXPLAIN muestra planes malos a escala | Esfuerzo puntual; bajo riesgo. |
| 6 | **Backpressure / tuning de polling** (el dashboard refetch cada 20s × N usuarios = carga sostenida) | Muchos usuarios con pestañas abiertas | Frescura vs carga. Subir `staleTime`/intervalo, o realtime selectivo. |
| 7 | **Read replicas** (add-on Pro+) | Lectura del dashboard domina y el tier ya no alcanza | Lag de réplica, costo, routing read/write. |
| 8 | **Postgres dedicado / self-host** | Escala real, fuera del rango managed económico | Carga operativa alta. Solo a escala grande. |

**Marco de decisión:** medir cuál recurso satura primero → atacar ESE con la
palanca más barata. Para Cronix (lectura-pesado en el dashboard, escritura por
agente WhatsApp/voz), el camino probable es **1 → 2 → 3 → 4**: subir compute,
asegurar pooler, exprimir caché, y solo si las métricas en vivo duelen, pre-agregar
los rollups del dashboard. Réplicas y dedicado quedan para mucho más arriba.

---

## 6. Caveats

- Los números locales son **optimistas** (hardware > free tier). La forma de las
  curvas es fiel; los absolutos no.
- El probe de concurrencia usa `service_role` → **no** incluye overhead de RLS (un
  costo constante por query, no cambia el punto de saturación).
- El seed local **no sobrevive un reinicio del stack** (el contenedor se recrea sin
  esos datos) — re-sembrar si pasa.
