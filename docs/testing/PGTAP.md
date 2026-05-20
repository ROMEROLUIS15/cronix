# pgTAP: PostgreSQL Testing Framework

## ¿Qué es pgTAP?

**pgTAP** (PostgreSQL Test Anything Protocol) es un framework de testing nativo de PostgreSQL que permite escribir y ejecutar tests directamente en SQL dentro de la base de datos. Implementa el estándar **TAP** (Test Anything Protocol), el mismo protocolo usado por Perl, Node.js, Python y otros lenguajes.

### Características Clave

| Característica | Descripción |
|---|---|
| **Native SQL Testing** | Los tests se escriben 100% en PL/pgSQL, sin dependencias externas |
| **Database-Level Assertions** | Verifica comportamiento a nivel de base de datos: triggers, funciones RPC, políticas RLS |
| **Zero Dependencies** | No requiere npm, Python, Ruby u otros ecosistemas externos |
| **TAP Output** | Produce salida TAP estándar compatible con cualquier herramienta TAP |
| **Atomic Transactions** | Cada suite de tests se ejecuta en una transacción ROLLBACK, no contamina datos |

---

## ¿Para Qué Sirven?

pgTAP verifica **3 tipos críticos de comportamiento**:

### 1. **Row-Level Security (RLS)** 🔐
Valida que las políticas de seguridad funcionen correctamente:
- Usuarios solo ven sus propios datos
- Cross-tenant isolation funciona
- Políticas SELECT, INSERT, UPDATE, DELETE se aplican correctamente

**Ejemplo:**
```sql
SELECT ok(
  NOT EXISTS(
    SELECT 1 FROM public.appointments 
    WHERE business_id != current_business_id()
  ),
  'user cannot select appointments from other businesses'
);
```

### 2. **RPC Functions (Stored Procedures)** ⚙️
Verifica lógica de negocio crítica:
- Pagos (idempotencia, tolerancia de montos)
- Agendamiento (validación de horarios, overlaps)
- Rate limiting (protección contra abuso)
- Transacciones complejas (atomicidad, rollback)

**Ejemplo:**
```sql
SELECT is(
  (SELECT (fn_finalize_paypal_payment('pp_order_123', 99.99)).result_status),
  'completed',
  'payment finalized successfully'
);
```

### 3. **Database Constraints & Triggers** 📋
Valida:
- Unique constraints funcionan
- Índices se crean correctamente
- Triggers se disparan en el momento correcto
- Cascading deletes funcionan

---

## Implementación en Cronix

### Suite 1: RLS Policies (52 tests)
**Archivo:** `supabase/tests/rls_policies.test.sql`

Cubre **8 secciones**:
1. **Authentication & Context** (3 tests) — current_user_id(), current_business_id()
2. **Businesses Table** (3 tests) — Solo propietarios ven su business
3. **Users Table** (5 tests) — Aislamiento de usuarios por business
4. **Appointments** (6 tests) — Staff ve citas de su business, clientes solo sus citas
5. **Clients** (6 tests) — Aislamiento strict por business
6. **Notification Subscriptions** (8 tests) — Cross-tenant protection con hardening 2026-05-21
7. **Services Table** (8 tests) — Aislamiento de servicios por business
8. **Audit Logs** (8 tests) — Staff solo ve logs de su business

**Hallazgos Clave:**
- Partial unique index `uq_reminder_imminent_owner` para idempotencia de cron
- INSERT/UPDATE policies en `notification_subscriptions` validan business_id directamente desde `users` table
- RLS policies enfuerzan multi-tenant isolation a nivel de base de datos

### Suite 2: Critical Business Functions (21 tests)
**Archivo:** `supabase/tests/critical_functions.test.sql`

Cubre **4 secciones**:

#### Payments (4 tests)
- ✓ fn_finalize_paypal_payment existence
- ✓ Idempotency (segunda llamada retorna 'already_processed')
- ✓ Amount tolerance (<0.01 aceptado)
- ✓ Amount mismatch rejection (>0.01)
- ✓ Invoice not found handling

#### Appointment Booking (2 tests)
- ✓ fn_book_appointment_wa creates appointments
- ✓ fn_reschedule_appointment_wa exists

#### Rate Limiting (5 tests)
- ✓ fn_wa_check_rate_limit (WhatsApp rate limit)
- ✓ fn_web_check_rate_limit (Web rate limit)
- ✓ fn_wa_check_circuit_breaker (Protección contra cascading failures)
- ✓ fn_wa_check_token_quota (Token usage tracking)

#### Helper Functions (3 tests)
- ✓ fn_clean_phone (Phone number normalization)

---

## Cómo Ejecutar los Tests

### Ejecutar Todos los pgTAP
```bash
npx supabase test db
```

**Salida esperada:**
```
Connecting to local database...
/path/to/critical_functions.test.sql .. ok
/path/to/rls_policies.test.sql ........ ok
All tests successful.
Files=2, Tests=73, Result: PASS
```

### Ejecutar una Suite Específica
```bash
npx supabase test db --filter rls_policies
```

### Ejecutar con Debug
```bash
npx supabase test db --debug
```

---

## Estructura TAP

Cada test suite produce salida **TAP (Test Anything Protocol)**:

```
1..52                          # Plan: 52 tests total
ok 1 - current_user_id() returns auth.uid()
ok 2 - current_business_id() returns user business context
...
ok 52 - Staff cannot see audit logs from other businesses
```

pgTAP interpreta esta salida y produce resumen:
- ✓ Tests passing
- ✗ Tests failing con diff (have vs want)
- ⚠ Parse errors (plan count mismatch)

---

## Integración con CI/CD

Los pgTAP tests se ejecutan **después de migraciones**:

```yaml
# .github/workflows/test.yml (ejemplo)
jobs:
  pgtap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: npm ci
      - run: npm run start:db  # Inicia Supabase local
      - run: npx supabase test db  # Ejecuta todos los pgTAP
```

---

## Ventajas vs Unit Tests

| Aspecto | Unit Tests (Vitest) | pgTAP |
|---|---|---|
| **Ejecución** | Node.js / browser | PostgreSQL nativo |
| **Scope** | Business logic, API | Database behavior, RLS, triggers |
| **Estado** | Mocks/fixtures | Real database transactions |
| **Performance** | ~30s (1507 tests) | ~0.07s (73 tests) |
| **Testing** | Controllers, hooks, utils | RPC functions, RLS policies |

**Conclusión:** pgTAP complementa Vitest. Los unit tests validan lógica de aplicación; pgTAP valida comportamiento crítico de base de datos que **NO puede mockarse**.

---

## Próximos Pasos (Opcional)

Si necesitas expandir la cobertura pgTAP:

1. **Trigger Tests** — Validar que triggers (appointment_services, audit logging) funcionan
2. **Constraint Tests** — Unique indexes, foreign keys
3. **Performance Tests** — Índices se usan, no hay sequential scans
4. **Concurrency Tests** — Race conditions en pagos, appointments

---

## Recursos

- **Documentación oficial pgTAP:** https://pgtap.org/
- **TAP Protocol:** https://testanything.org/
- **Supabase + pgTAP:** https://supabase.com/docs/guides/database/testing
- **RFC 8291 (Web Push Encryption):** Implementado en `push-notify` function

---

*Documentation created 2026-05-20 — pgTAP suite: 73 tests passing (52 RLS policies + 21 critical functions)*
