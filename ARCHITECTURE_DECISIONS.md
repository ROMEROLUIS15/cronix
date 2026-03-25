# Decisiones Arquitectónicas — Cronix Backend

**Documento de Decisión de Arquitectura (ADR)**
**Fecha:** 2026-03-25
**Status:** PROPUESTO PARA APROBACIÓN

---

## ADR-001: Migración de Cron Jobs a Supabase pg_cron

### Contexto
Actualmente: **Vercel Cron** → Next.js `/api/cron/send-reminders` → Supabase Edge Functions

Problema: 3 capas innecesarias, acoplamiento a Vercel, latencia extra.

---

## Opción A: Mantener Vercel Cron (STATUS QUO)

### Ventajas
- ✅ Ya funciona, probado en producción
- ✅ Vercel monitorea y reintenta automáticamente
- ✅ UI clara en Vercel Dashboard

### Desventajas
- ❌ Depende de Vercel (vendor lock-in)
- ❌ Latencia extra (HTTP → Next.js → HTTP → EF)
- ❌ Requiere mantener Next.js route

### Implementación
```bash
# Mantener vercel.json como está
# Continuar usando /api/cron/send-reminders
```

---

## Opción B: Migrar a Supabase pg_cron (RECOMENDADO) ⭐

### Ventajas
- ✅ Puro Supabase, sin Vercel
- ✅ Directo: pg_cron → cron-reminders EF → whatsapp-service EF
- ✅ 1 capa menos, latencia reducida
- ✅ Sincronizado con base de datos (misma región Supabase)
- ✅ Monitoreado en PostgreSQL (pg_cron.log)

### Desventajas
- ⚠️ Requiere cambio de configuración
- ⚠️ Menos UI visual (pero CLI/SQL disponible)

### Implementación
```bash
# 1. Dashboard Supabase → SQL Editor
# Pegar SQL de: supabase/migrations/20260325_setup_pg_cron.sql

# 2. Remover cron de Vercel
# Editar vercel.json: eliminar o comentar la entrada de cron

# 3. Verificar en Supabase
SELECT * FROM cron.job;
```

---

## Decisión Recomendada

**✅ OPCIÓN B (pg_cron)** por estas razones:

1. **Arquitectura pura**: Todo en Supabase, sin vendor lock-in Vercel
2. **Menor latencia**: Una capa menos (Vercel → Next.js)
3. **Operaciones simplificadas**: Monitoreo centralizado en Supabase
4. **Escalabilidad**: pg_cron puede manejar 1000s de jobs
5. **Costo**: No requiere que Vercel despierte (aunque sea barato)

---

## Tabla Comparativa

| Aspecto | Vercel Cron | Supabase pg_cron |
|---------|------------|-----------------|
| Latencia | 200-500ms | 50-100ms |
| Vendor Lock-in | Alto (Vercel) | Bajo (PostgreSQL estándar) |
| Monitoreo | Vercel Dashboard | PostgreSQL logs |
| Reintento automático | ✅ Sí | ⚠️ Manual (pero raro) |
| Complejidad | Baja | Muy baja |
| Costo | Negligible | Incluido en Supabase |

---

## APIs que NO pueden migrar a Edge Functions

| Ruta | Razón | Solución |
|------|-------|----------|
| `/api/passkey/**` | Usa `@simplewebauthn/server` (native bindings C++) | MANTENER EN NEXT.JS (obligatorio) |
| `/api/activity/ping` | Cliente acoplado a esta ruta; middleware atado | MANTENER EN NEXT.JS (bajo costo) |

---

## Conclusión

✅ **Todas las Edge Functions críticas ya están migradas:**
- `whatsapp-service` → Envía WhatsApp
- `push-notify` → Envía Web Push
- `cron-reminders` → Procesa recordatorios

**Próximo paso:** Activar pg_cron en Supabase para eliminar dependencia de Vercel Cron.

**Status:** LISTO PARA IMPLEMENTAR OPCIÓN B
