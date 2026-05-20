# Password Rate Limiting — 3 Intentos Máximos

## Overview

Implementación de protección contra ataques de fuerza bruta (brute-force) en login. Después de **3 intentos fallidos de contraseña**, el usuario es **bloqueado por 15 minutos** y **redirigido a reset de contraseña**.

---

## Arquitectura

### Doble Capa de Rate Limiting

| Capa | Tecnología | Propósito | TTL |
|---|---|---|---|
| **Cache** | Upstash Redis | Rápido (ms) | 5 min (por defecto) |
| **Persistent** | PostgreSQL | Auditoría + recuperación | Indefinido (con reset manual) |

**Por qué dos capas?**
- Redis es ultrarrápido pero volátil (reinicio = pérdida)
- PostgreSQL es persistente, auditable, y resiliente
- Si Redis falla, PostgreSQL lo respaldo
- Si PostgreSQL falla, Redis puede continuar

---

## Implementación

### 1. Migration: `20260520120000_password_attempt_rate_limit.sql`

**Tabla: `failed_password_attempts`**

```sql
CREATE TABLE public.failed_password_attempts (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  business_id UUID,
  attempt_count INT NOT NULL,
  last_attempt_at TIMESTAMPTZ NOT NULL,
  locked_until TIMESTAMPTZ,  -- NULL = no locked, timestamp = locked until
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);

-- Índice para búsquedas rápidas
CREATE UNIQUE INDEX idx_failed_password_attempts_email
  ON failed_password_attempts(email)
  WHERE locked_until IS NULL OR locked_until > NOW();
```

**3 funciones RPC:**

#### `fn_check_password_attempts(p_email, max_attempts=3, lockout_minutes=15)`

Verifica el estado del usuario sin modificar nada.

**Retorna:**
```jsonb
{
  "allowed": true,           -- ¿Puede intentar login?
  "attempt_count": 0,        -- Intentos fallidos actuales
  "is_locked": false,        -- ¿Bloqueado?
  "locked_until": null,      -- Timestamp de desbloqueo (si aplica)
  "max_attempts": 3
}
```

**Lógica:**
1. Si no hay registro → `allowed: true` (usuario limpio)
2. Si `locked_until > NOW()` → `allowed: false` (bloqueado activo)
3. Si `attempt_count < max_attempts` → `allowed: true` (aún tiene intentos)
4. Si `attempt_count >= max_attempts` → `allowed: false` (bloqueado)

#### `fn_record_failed_password_attempt(p_email, p_business_id=NULL)`

Registra un intento fallido e incrementa el contador. **Automáticamente bloquea después del 3er intento**.

**Retorna:**
```jsonb
{
  "recorded": true,
  "attempt_count": 1,
  "locked_after_this": false,  -- ¿Se bloqueó con este intento?
  "locked_until": null
}
```

**Lógica:**
1. INSERT o UPDATE el contador
2. Si `attempt_count >= 3` → set `locked_until = NOW() + 15 minutes`
3. Retorna estado actual

#### `fn_reset_password_attempts(p_email)`

Elimina el registro de intentos fallidos (llamada después de login exitoso o reset de contraseña).

**Retorna:**
```jsonb
{
  "reset": true,
  "email": "user@example.com"
}
```

---

### 2. Actualización: `lib/actions/auth.ts`

Integración en el servidor action de login:

```typescript
export async function login(formData: FormData): Promise<LoginResult> {
  const email = formData.get('email');
  const password = formData.get('password');

  const supabase = await createClient();

  // 1. Check Redis (fast cache layer)
  const existing = await getLoginFailures(email);
  if (existing?.count >= MAX_ATTEMPTS_BEFORE_LOCK) {
    // Record in PostgreSQL for audit
    await supabase.rpc('fn_record_failed_password_attempt', { p_email: email });
    
    return {
      error: 'locked',
      failedAttempts: existing.count,
      lockoutEndsAt: existing.lastFailAt + LOCKOUT_DURATION_MS,
    };
  }

  // 2. Check PostgreSQL (persistent validation)
  const { data: dbCheck } = await supabase.rpc(
    'fn_check_password_attempts',
    { p_email: email }
  );

  if (dbCheck && !dbCheck.allowed) {
    return {
      error: 'locked',
      failedAttempts: dbCheck.attempt_count,
      lockoutEndsAt: new Date(dbCheck.locked_until).getTime(),
    };
  }

  // 3. Attempt password auth
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // 4. Credential failure — increment BOTH Redis + PostgreSQL
    const redisState = await incrementLoginFailures(email);
    await supabase.rpc('fn_record_failed_password_attempt', { p_email: email });

    return {
      error: redisState.count >= MAX_ATTEMPTS_BEFORE_LOCK ? 'locked' : 'invalid_credentials',
      failedAttempts: redisState.count,
      lockoutEndsAt: /* ... */,
    };
  }

  // 5. Success — reset BOTH counters
  await resetLoginFailures(email);
  await supabase.rpc('fn_reset_password_attempts', { p_email: email });

  redirect('/dashboard');
}
```

---

## UX Flow

```
┌─────────────────────────────────────┐
│ Usuario intenta login con password  │
└────────────┬────────────────────────┘
             │
             ▼
    ┌─────────────────┐
    │ Check Redis +   │
    │ PostgreSQL      │
    └────────┬────────┘
             │
        ┌────┴────┐
        │ locked? │
        └────┬────┘
             ├─────────────────────────────────┐
             ▼                                 ▼
        NO (allowed)                      YES (blocked)
             │                                 │
             ▼                                 ▼
    ┌─────────────────┐              ┌──────────────────────┐
    │ Try password    │              │ Error: "locked"      │
    └────────┬────────┘              │ Redirect to:         │
             │                       │ /auth/reset-password │
        ┌────┴────┐                  └──────────────────────┘
        │ valid?  │
        └────┬────┘
             │
        ┌────┴──────┐
        ▼           ▼
       YES          NO
        │           │
        │           ▼
        │    ┌─────────────────────┐
        │    │ Increment counter   │
        │    │ (Redis + PostgreSQL)│
        │    └────────┬────────────┘
        │             │
        │        ┌────┴─────────┐
        │        │ count >= 3?  │
        │        └────┬─────────┘
        │             │
        │        ┌────┴───────┐
        │        ▼            ▼
        │       YES           NO
        │        │            │
        │        ▼            ▼
        │    LOCKED      INVALID_CREDENTIALS
        │    (15 min)    (error message)
        │                (show attempts left)
        │
        ▼
    ┌──────────────────┐
    │ Reset counters   │
    │ Redirect /       │
    │ dashboard        │
    └──────────────────┘
```

---

## Casos de Uso

### Caso 1: Login exitoso
```
Usuario: juan@example.com
Intento 1: Contraseña incorrecta → Count=1, allowed
Intento 2: Contraseña correcta → Reset counters, redirect /dashboard
```

### Caso 2: 3 intentos fallidos
```
Usuario: hacker@example.com
Intento 1: Wrong password → Count=1, allowed
Intento 2: Wrong password → Count=2, allowed
Intento 3: Wrong password → Count=3, LOCKED, locked_until=NOW()+15min
            Redirect to /auth/reset-password
Intento 4 (2 min después): ERROR "locked" (locked_until no ha expirado)
Intento 5 (17 min después): allowed (locked_until expiró)
```

### Caso 3: Reset de contraseña exitoso
```
Usuario: juan@example.com
Intento 1: Wrong password → Count=1
Intento 2: Wrong password → Count=2
Intento 3: Wrong password → Count=3, LOCKED
            Redirect to /auth/reset-password
Usuario: Verifica email → Token válido → Cambia contraseña
Sistema: fn_reset_password_attempts() → count=0, locked_until=NULL
Intento 4: Login con nueva password → exitoso ✓
```

---

## Protecciones

| Ataque | Protección | Cómo funciona |
|---|---|---|
| Brute-force (10 password/sec) | Rate limit 3 intentos | Después de 3: bloqueado 15 min |
| Distributed brute-force (múltiples IPs) | Identificador = email | Aunque cambies IP, el email se bloquea |
| Bypass desde Redis crash | PostgreSQL fallback | Si Redis se cae, PostgreSQL valida |
| Bypass desde PostgreSQL crash | Redis fallback | Si PostgreSQL se cae, Redis valida |
| Account takeover después del reset | Confirmation gate | Reset password requiere email verification |

---

## Configuración

### Parámetros personalizables

Ambas funciones aceptan parámetros:

```sql
-- Parámetro de máximo intentos (default 3)
SELECT fn_check_password_attempts('user@example.com', 5, 30)

-- 5 intentos máximos, 30 minutos de lockout
```

En `lib/actions/auth.ts`:

```typescript
const MAX_ATTEMPTS_BEFORE_LOCK = 3;        // cambiar a 5 para ser más leniente
const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // Redis: 5 min
const EXTENDED_LOCKOUT_MS  = 15 * 60 * 1000; // PostgreSQL: 15 min
```

---

## Testing (pgTAP)

Tests pendientes (cuando migración se aplique):

```sql
-- 1. New user allowed
SELECT fn_check_password_attempts('newuser@test.com').allowed
-- → true

-- 2. Record 1st failed attempt
fn_record_failed_password_attempt('test@test.com')
SELECT fn_check_password_attempts('test@test.com').attempt_count
-- → 1

-- 3. Record 2nd failed attempt
fn_record_failed_password_attempt('test@test.com')
SELECT fn_check_password_attempts('test@test.com').attempt_count
-- → 2

-- 4. 3rd attempt locks user
fn_record_failed_password_attempt('test@test.com')
SELECT fn_check_password_attempts('test@test.com').is_locked
-- → true

-- 5. Locked user cannot login
SELECT fn_check_password_attempts('test@test.com').allowed
-- → false

-- 6. Reset clears lockout
fn_reset_password_attempts('test@test.com')
SELECT fn_check_password_attempts('test@test.com').allowed
-- → true
```

---

## Auditoría

Toda la información está en `public.failed_password_attempts`:

```sql
-- Ver intentos fallidos de un usuario
SELECT email, attempt_count, locked_until, last_attempt_at
FROM public.failed_password_attempts
WHERE email = 'user@example.com';

-- Ver usuarios bloqueados actualmente
SELECT email, attempt_count, locked_until
FROM public.failed_password_attempts
WHERE locked_until > NOW();

-- Desbloquear un usuario manualmente (admin)
UPDATE public.failed_password_attempts
SET locked_until = NULL
WHERE email = 'hacker@example.com';
```

---

## Próximos pasos

1. **Aplicar migración:** `npx supabase db push`
2. **Ejecutar tests:** `npx supabase test db` (cuando pgTAP tests se agreguen)
3. **E2E testing:** Verificar que UI muestra "Bloqueado, intenta en 15 minutos"
4. **Alertas:** Notificar a soporte si un usuario es bloqueado 5+ veces/día

---

*Implementado 2026-05-20*
