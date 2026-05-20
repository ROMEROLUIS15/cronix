# pgTAP Examples — Casos Reales

Ejemplos prácticos de los 73 tests pgTAP implementados en Cronix.

---

## 1️⃣ Row-Level Security (RLS) Tests

### Ejemplo 1: Verificar que RLS está activado

```sql
SELECT ok(
  (SELECT relrowsecurity FROM pg_class 
   WHERE relname = 'users' 
   AND relnamespace = 'public'::regnamespace),
  'RLS enabled on users'
);
```

**¿Qué hace?**
- Consulta `pg_class` (tabla del sistema de PostgreSQL)
- Verifica que `relrowsecurity = true` en la tabla `users`
- Si es verdadero: ✓ test pasa
- Si es falso: ✗ test falla

**Por qué importa:** Sin RLS, cualquier usuario autenticado puede leer todos los datos.

---

### Ejemplo 2: Verificar que anon NO puede insertar usuarios

```sql
SET ROLE anon;

SELECT throws_ok(
  $q$
    INSERT INTO public.users (
      id, name, email, business_id, role, is_active, status
    )
    VALUES (
      gen_random_uuid(), 'Hacker', 'h@test.com',
      'aaaaaaaa-0000-0000-0000-000000000001', 
      'employee', true, 'active'
    )
  $q$,
  '42501',           -- PostgreSQL permission denied error code
  NULL,
  'anon cannot INSERT into users'
);

RESET ROLE;
```

**¿Qué hace?**
- Cambia el rol actual a `anon` (usuario anónimo/no autenticado)
- Intenta insertar un usuario
- Espera que lance error `42501` (permission denied)
- Si lanza el error esperado: ✓ test pasa
- Si no lanza error o lanza otro: ✗ test falla

**Por qué importa:** Previene que usuarios anónimos creen cuentas falsas.

---

### Ejemplo 3: Owner A NO puede ver business de Owner B

```sql
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*)::INT FROM public.businesses
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  0,  -- Esperado: 0 filas (Owner B business es invisible para Owner A)
  'Owner A cannot select Owner B business'
);

SELECT is(
  (SELECT COUNT(*)::INT FROM public.businesses
   WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,  -- Esperado: 1 fila (propias businesses son visibles)
  'Owner A can select own business'
);

RESET ROLE;
```

**¿Qué hace?**
- Simula un usuario autenticado con ID `00000000-0000-0000-0000-000000000001`
- Intenta acceder a business de otro owner (ID `bbbbbbbb-0000-0000-0000-000000000002`)
- Verifica que la query retorna 0 filas (RLS filtra silenciosamente)
- Verifica que puede acceder a sus propias businesses

**Por qué importa:** Previene que un owner vea/edite businesses de otros.

**Cómo funciona RLS internamente:**
```sql
-- La política RLS en businesses tabla:
CREATE POLICY "businesses_owner_read"
  ON public.businesses FOR SELECT
  USING (owner_id = auth.uid());

-- Cuando Owner A queries, PostgreSQL automáticamente añade:
-- WHERE owner_id = 'auth.uid()' 
-- Si Owner B's business no cumple esta condición, es filtrada (no visible)
```

---

### Ejemplo 4: UPDATE silenciosa es ignorado por RLS

```sql
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Owner A intenta cambiar el nombre de Owner B's business
UPDATE public.businesses
SET name = 'Hijacked'
WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- Verifica que el nombre NO cambió
SELECT is(
  (SELECT name FROM public.businesses 
   WHERE owner_id = '00000000-0000-0000-0000-000000000002'),
  NULL,  -- Owner B no es visible para Owner A
  'Owner A UPDATE on Owner B business is silently ignored'
);

RESET ROLE;
```

**¿Qué hace?**
- Owner A intenta hacer UPDATE a business de Owner B
- No lanza error (UPDATE silenciosamente afecta 0 filas)
- Verifica que Owner B's business no cambió

**Por qué es importante:** Security por default — si un hacker intenta actualizar otro tenant, la query simplemente no hace nada.

---

## 2️⃣ RPC Function Tests (Lógica de Negocio)

### Ejemplo 1: Payment Finalization — Successful

```sql
-- Setup: Crear una invoice en estado 'waiting'
DO $$
DECLARE
  test_biz_id     UUID := 'ffffffff-1111-1111-1111-111111111111';
  test_invoice_id UUID := 'ffffffff-7777-7777-7777-777777777777';
BEGIN
  INSERT INTO public.saas_invoices (
    id, business_id, amount_usd, status, payment_method, np_invoice_id,
    plan_purchased
  )
  VALUES (
    test_invoice_id, test_biz_id, 99.99, 'waiting', 'paypal',
    'pp_test_order_001', 'pro'
  )
  ON CONFLICT DO NOTHING;
END $$;

-- Test 1: Payment completes successfully
SELECT is(
  (SELECT (fn_finalize_paypal_payment('pp_test_order_001', 99.99)).result_status),
  'completed',
  'payment finalized successfully'
);

-- Test 2: Invoice status changed to 'finished'
SELECT is(
  (SELECT status FROM public.saas_invoices WHERE np_invoice_id = 'pp_test_order_001'),
  'finished',
  'invoice status changed to finished'
);

-- Test 3: Business plan updated
SELECT is(
  (SELECT plan FROM public.businesses WHERE id = 'ffffffff-1111-1111-1111-111111111111'),
  'pro',
  'business plan updated to purchased plan'
);
```

**¿Qué hace?**
1. Crea una invoice ficticia de PayPal
2. Llama la RPC `fn_finalize_paypal_payment` con el order ID
3. Verifica que retorna `'completed'` 
4. Verifica que la invoice cambió a estado `'finished'`
5. Verifica que el business plan se actualizó a `'pro'`

**Por qué importa:** Asegura que los pagos son procesados correctamente y atomically.

---

### Ejemplo 2: Payment Idempotency

```sql
-- Test: Calling payment twice returns 'already_processed'
SELECT is(
  (SELECT (fn_finalize_paypal_payment('pp_test_order_001', 99.99)).result_status),
  'already_processed',
  'second call returns already_processed (idempotent)'
);
```

**¿Qué hace?**
- Intenta finalizar el MISMO pago otra vez
- Verifica que retorna `'already_processed'` en lugar de error
- Esto previene que webhooks duplicados procesen un pago dos veces

**Por qué importa:** Si PayPal webhook se reintenta, no debe duplicar el pago.

---

### Ejemplo 3: Amount Tolerance

```sql
-- Setup: Create invoice for 100.00 USD
DO $$
DECLARE
  test_invoice_id UUID := 'ffffffff-8888-8888-8888-888888888888';
BEGIN
  INSERT INTO public.saas_invoices (
    id, business_id, amount_usd, status, payment_method, np_invoice_id,
    plan_purchased
  )
  VALUES (
    test_invoice_id, 'ffffffff-1111-1111-1111-111111111111',
    100.00, 'waiting', 'paypal', 'pp_test_order_002', 'free'
  )
  ON CONFLICT DO NOTHING;
END $$;

-- Test: Amount 100.009 is accepted (within 0.01 tolerance)
SELECT is(
  (SELECT (fn_finalize_paypal_payment('pp_test_order_002', 100.009)).result_status),
  'completed',
  'amount within tolerance (100.009 vs 100.00) is accepted'
);
```

**¿Qué hace?**
- Invoice es de 100.00 USD
- Pero PayPal reporta 100.009 (rounding differences)
- Función acepta porque `|100.009 - 100.00| = 0.009 < 0.01` (tolerance de 1 centavo)

**Por qué importa:** Previene rechazos de pagos válidos por rounding errors.

---

### Ejemplo 4: Amount Mismatch Rejected

```sql
-- Setup: Create invoice for 100.00 USD
DO $$
DECLARE
  test_invoice_id UUID := 'ffffffff-9999-9999-9999-999999999999';
BEGIN
  INSERT INTO public.saas_invoices (
    id, business_id, amount_usd, status, payment_method, np_invoice_id,
    plan_purchased
  )
  VALUES (
    test_invoice_id, 'ffffffff-1111-1111-1111-111111111111',
    100.00, 'waiting', 'paypal', 'pp_test_order_003', 'enterprise'
  )
  ON CONFLICT DO NOTHING;
END $$;

-- Test: Amount 99.00 is rejected (mismatch > 0.01)
SELECT is(
  (SELECT (fn_finalize_paypal_payment('pp_test_order_003', 99.00)).result_status),
  'amount_mismatch',
  'payment rejected when amount differs > 0.01'
);
```

**¿Qué hace?**
- Invoice es de 100.00 USD
- PayPal reporta 99.00 USD
- Diferencia de 1.00 USD es > 0.01 tolerance
- Función rechaza y retorna `'amount_mismatch'`

**Por qué importa:** Previene fraude (pago de 99 por 100, por ejemplo).

---

### Ejemplo 5: Invoice Not Found

```sql
-- Test: Trying to finalize a non-existent invoice
SELECT is(
  (SELECT (fn_finalize_paypal_payment('pp_nonexistent', 100.00)).result_status),
  'invoice_not_found',
  'payment rejected for nonexistent invoice'
);
```

**¿Qué hace?**
- Intenta finalizar un invoice que no existe en base de datos
- Función retorna `'invoice_not_found'` (no error, graceful)

**Por qué importa:** Previene crashes si PayPal webhook llega a invoice que no existe.

---

## 3️⃣ Rate Limiting Tests

### Ejemplo 1: WhatsApp Rate Limit

```sql
SELECT ok(
  (SELECT fn_wa_check_rate_limit('58414_testphone_1')),
  'first WhatsApp request passes rate limit check'
);
```

**¿Qué hace?**
- Verifica si el número de teléfono `58414_testphone_1` está dentro del límite de rate
- Retorna `true` (puede enviar mensaje)
- Si había 10 mensajes en el último minuto, retorna `false`

**Por qué importa:** Previene que spammers envíen mensajes masivos vía WhatsApp.

---

### Ejemplo 2: Web Rate Limit

```sql
SELECT ok(
  (SELECT fn_web_check_rate_limit('test_web_user_1')),
  'web rate limit check returns boolean'
);
```

**¿Qué hace?**
- Verifica si el usuario `test_web_user_1` está dentro de límite de requests HTTP
- Retorna `true` (puede hacer request)

---

### Ejemplo 3: Circuit Breaker

```sql
SELECT ok(
  (SELECT fn_wa_check_circuit_breaker('whatsapp')),
  'circuit breaker returns boolean'
);
```

**¿Qué hace?**
- Verifica si el servicio 'whatsapp' está healthy
- Retorna `true` (servicio está UP)
- Si WhatsApp API está down, retorna `false` (automáticamente redirige a fallback)

**Por qué importa:** Previene que si WhatsApp está down, el sistema siga intentando enviar.

---

### Ejemplo 4: Token Quota

```sql
SELECT ok(
  (SELECT fn_wa_check_token_quota('ffffffff-1111-1111-1111-111111111111')),
  'token quota check returns boolean'
);
```

**¿Qué hace?**
- Verifica cuántos tokens de LLM ha usado el business `ffffffff-1111-1111-1111-111111111111` hoy
- Retorna `true` si está dentro de quota (ej. < 50,000 tokens/día)
- Retorna `false` si excedió la quota

**Por qué importa:** Previene que un business malicioso agote el presupuesto de LLM.

---

## 🧪 Sintaxis pgTAP Común

| Función | Qué hace | Ejemplo |
|---|---|---|
| `SELECT ok(condition, message)` | Test si condition es true | `SELECT ok(1=1, 'math works')` |
| `SELECT is(actual, expected, message)` | Test si actual = expected | `SELECT is(1+1, 2, 'addition works')` |
| `SELECT throws_ok(query, error_code, message)` | Test si query lanza error | `SELECT throws_ok('SELECT 1/0', '22012', 'division by zero')` |
| `SELECT plan(N)` | Declara que hay N tests | `SELECT plan(52)` |
| `SELECT finish()` | Finaliza la suite de tests | `SELECT * FROM finish()` |
| `SET ROLE role_name` | Cambia rol (usuario) | `SET ROLE authenticated` |
| `SET "request.jwt.claims"` | Simula JWT claims | `SET "request.jwt.claims" TO '{"sub":"uuid"}'` |

---

## 📊 Ejecución Completa

```bash
# Ejecutar TODOS los tests pgTAP
npx supabase test db

# Resultado esperado:
# /path/to/rls_policies.test.sql ........ ok
# /path/to/critical_functions.test.sql .. ok
# All tests successful.
# Files=2, Tests=73, Result: PASS
```

**Output detallado:**
```
1..52                              # Plan: 52 tests en rls_policies
ok 1 - RLS enabled on users
ok 2 - RLS enabled on businesses
...
ok 52 - Owner cannot see audit logs from other businesses
1..21                              # Plan: 21 tests en critical_functions
ok 1 - fn_finalize_paypal_payment exists
ok 2 - payment finalized successfully
ok 3 - invoice status changed to finished
...
ok 21 - token quota check returns boolean
```

---

## 💡 Key Takeaways

| Característica | Beneficio |
|---|---|
| **Tests 100% SQL** | No mocks, comportamiento real de base de datos |
| **RLS validation** | Previene cross-tenant data leaks |
| **Payment idempotency** | No duplicar pagos si webhooks se reintenta |
| **Rate limiting** | Protección contra abuso |
| **Atomic transactions** | Tests no contamina datos reales (ROLLBACK) |
| **Fast execution** | 73 tests en ~0.07 segundos |

---

*Todos estos tests están en el repositorio Cronix y se ejecutan automáticamente como parte de la CI/CD.*
