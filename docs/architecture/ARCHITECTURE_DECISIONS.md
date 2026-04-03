# Architectural Decisions — Cronix Backend

**Architecture Decision Record (ADR)**
**Date:** 2026-03-25
**Status:** PROPOSED FOR APPROVAL

---

## ADR-001: Migration of Cron Jobs to Supabase pg_cron

### Context
Currently: **Vercel Cron** → Next.js `/api/cron/send-reminders` → Supabase Edge Functions

Problem: 3 unnecessary layers, Vercel coupling, extra latency.

---

## Option A: Keep Vercel Cron (STATUS QUO)

### Advantages
- ✅ Already works, tested in production
- ✅ Vercel automatically monitors and retries
- ✅ Clear UI in Vercel Dashboard

### Disadvantages
- ❌ Depends on Vercel (vendor lock-in)
- ❌ Extra latency (HTTP → Next.js → HTTP → EF)
- ❌ Requires maintaining a Next.js route

### Implementation
```bash
# Keep vercel.json as is
# Continue using /api/cron/send-reminders
```

---

## Option B: Migrate to Supabase pg_cron (RECOMMENDED) ⭐

### Advantages
- ✅ Pure Supabase, no Vercel
- ✅ Direct: pg_cron → cron-reminders EF → whatsapp-service EF
- ✅ 1 less layer, reduced latency
- ✅ Synchronized with database (same Supabase region)
- ✅ Monitored in PostgreSQL (pg_cron.log)

### Disadvantages
- ⚠️ Requires configuration change
- ⚠️ Less visual UI (but CLI/SQL available)

### Implementation
```bash
# 1. Supabase Dashboard → SQL Editor
# Paste SQL from: supabase/migrations/20260325_setup_pg_cron.sql

# 2. Remove Vercel cron
# Edit vercel.json: remove or comment the cron entry

# 3. Verify in Supabase
SELECT * FROM cron.job;
```

---

## Recommended Decision

**✅ OPTION B (pg_cron)** for several reasons:

1. **Pure Architecture**: Everything in Supabase, no Vercel vendor lock-in
2. **Lower Latency**: One less layer (Vercel → Next.js)
3. **Simplified Operations**: Centralized monitoring in Supabase
4. **Scalability**: pg_cron can handle 1,000s of jobs
5. **Cost**: Doesn't require Vercel to wake up (though it's cheap)

---

## Comparative Table

| Aspect | Vercel Cron | Supabase pg_cron |
|---------|------------|-----------------|
| Latency | 200-500ms | 50-100ms |
| Vendor Lock-in | High (Vercel) | Low (Standard PostgreSQL) |
| Monitoring | Vercel Dashboard | PostgreSQL logs |
| Automatic Retry | ✅ Yes | ⚠️ Manual (but rare) |
| Complexity | Low | Very low |
| Cost | Negligible | Included in Supabase |

---

## APIs that CANNOT migrate to Edge Functions

| Route | Reason | Solution |
|------|-------|----------|
| `/api/passkey/**` | Uses `@simplewebauthn/server` (native C++ bindings) | KEEP IN NEXT.JS (mandatory) |
| `/api/activity/ping` | Client coupled to this route; middleware tied | KEEP IN NEXT.JS (low cost) |

---

## Conclusion

✅ **All critical Edge Functions have already migrated:**
- `whatsapp-service` → Sends WhatsApp
- `push-notify` → Sends Web Push
- `cron-reminders` → Processes reminders

**Next step:** Activate `pg_cron` in Supabase to eliminate Vercel Cron dependency.

**Status:** READY TO IMPLEMENT OPTION B
