# 📋 Manifiesto de Dominio: Módulo de Autenticación

Este documento define el contrato de autenticación y autorización de Cronix. El sistema usa Supabase Auth como proveedor de identidad, con soporte de Passkey/WebAuthn como método primario sin contraseña.

## 1. Flujo de Autenticación

```
Usuario
  │
  ├─ Passkey / WebAuthn  ─────────────────┐
  ├─ Magic Link (email)                   ├─► Supabase Auth
  └─ OAuth (Google, etc.)                 │       │
                                          ┘       │ JWT firmado
                                                  ▼
                                          middleware.ts
                                                  │
                                          ¿Sesión válida?
                                            │         │
                                           No        Sí
                                            │         │
                                        Redirect   getSession()
                                        /login          │
                                                        ▼
                                                  SessionUser {
                                                    id, email,
                                                    business_id,  ← tenant ID
                                                    dbUser { role, status, ... }
                                                  }
```

## 2. Los Dos Accesores de Identidad (NO son intercambiables)

El runtime Next.js tiene **dos** accesores de identidad con garantías de seguridad distintas. Elegir el equivocado abre un bypass de autenticación o desperdicia ~150 ms por navegación. La regla es: **¿la superficie está detrás del middleware?**

| Accesor | Archivo | Primitiva Supabase | Garantía | Cuándo usar |
|---|---|---|---|---|
| `getVerifiedSession()` | `lib/auth/get-session.ts` | `auth.getUser()` (round-trip al servidor) | **Valida el JWT server-side.** Retorna `SessionUser` (con `dbUser` embebido) o `null`. Seguro de forma autónoma. | Superficies **NO** cubiertas por el middleware. |
| `getCachedSessionUser()` + `getCachedUserProfile()` | `lib/supabase/server-cache.ts` | `auth.getSession()` (decode local de cookie) | **NO valida** — confía en que el middleware (`lib/middleware/with-session.ts`) ya ejecutó `getUser()`. Envuelto en `React.cache()` (dedup por request). | Hot-path del dashboard (`/dashboard/**`), donde el middleware ya validó. |

> ⚠️ **Inversión histórica de nombres (corregida):** los nombres de Cronix NO siguen las primitivas de Supabase de forma intuitiva. `getVerifiedSession()` es el que valida (`auth.getUser()`); `getCachedSessionUser()` es el que solo decodifica local (`auth.getSession()`). El portón real del dashboard (`app/[locale]/dashboard/layout.tsx`) usa `getCachedSessionUser` + `getCachedUserProfile`, NO `getVerifiedSession`. Este último se usa hoy solo en `app/[locale]/dashboard/clients/[id]/page.tsx`.

`getVerifiedSession()` retorna `SessionUser | null`.

```typescript
interface SessionUser {
  id:          string       // UUID del usuario en Supabase Auth
  email?:      string | null
  business_id: string | null // UUID del tenant — puede ser null si incompleto
  dbUser: {
    id:         string
    name:       string | null
    role:       string | null   // 'owner' | 'staff' | etc.
    status:     string | null
    business_id: string | null
    is_active:  boolean | null
    // ... otros campos no sensibles
  } | null
}
```

**Regla crítica:** `getVerifiedSession()` usa `supabase.auth.getUser()` — NO `auth.getSession()` de Supabase. `getUser()` valida el JWT contra el servidor (no confía en la cookie local sin verificar). Esto previene ataques de manipulación de sesión local. El accesor del hot-path, `getCachedSessionUser()`, SÍ usa `auth.getSession()` (decode local) **por diseño**: es seguro únicamente porque el middleware ya ejecutó `getUser()` antes de que corra el RSC. Si el middleware dejara de validar, `getCachedSessionUser()` debe migrar a `getUser()`.

## 3. Reglas de Autorización

### Acceso a recursos de negocio
- **Toda** operación sobre datos de un negocio requiere que `session.business_id` sea el mismo `business_id` del recurso
- El `business_id` del `SessionUser` es la fuente autoritativa del tenant — no se acepta `business_id` desde el body de la request
- Si `session.business_id` es `null` (registro incompleto), el sistema trata al usuario como no autorizado

### Roles
- `'owner'`: Acceso completo a todos los datos de su negocio
- `'staff'`: Acceso restringido — no puede modificar configuración del negocio ni ver datos financieros completos
- Sin rol definido (`null`): Sin acceso a dashboard

### Regla del middleware (`middleware.ts`)
- Ninguna ruta bajo `/dashboard/**` es accesible sin sesión válida
- El middleware verifica la sesión en CADA request — no cachea autorización
- En caso de error de DB durante verificación → retorna `null` (falla cerrada, no abierta)

## 4. Passkey / WebAuthn

- Los Passkeys se registran y validan vía Supabase Auth (que usa WebAuthn internamente)
- No existe lógica de Passkey custom en el codebase de Cronix — todo se delega a Supabase
- Los dispositivos vinculados se gestionan desde el perfil del usuario en el dashboard
- Fallback disponible: magic link por email si el dispositivo no soporta Passkey

## 5. Extracción del `business_id` en Edge Functions

Las Edge Functions de Supabase NO tienen acceso a la sesión Next.js. El `business_id` llega de dos formas:

1. **Via slug (WhatsApp):** `#slug` → `getBusinessBySlug()` → `business_id`
2. **Via header interno (crons/workers):** El secret `x-internal-secret` autentica llamadas server-to-server; el `business_id` va en el body de la request

**Prohibido:** Pasar `business_id` como parámetro de query string en endpoints públicos.

## 6. Criterios de Aceptación

**AC-1 — Fallo de DB no expone sesión parcial:**
- DADO un error de DB al consultar la tabla `users` durante `getVerifiedSession()`,
- CUANDO ocurre el error de DB,
- ENTONCES `getVerifiedSession()` retorna `null` — no retorna un `SessionUser` sin `business_id`.

**AC-2 — Tenant isolation en server actions:**
- DADO un usuario autenticado con `business_id: 'A'`,
- CUANDO ejecuta una server action que modifica datos,
- ENTONCES la query usa `businessId = session.business_id` (de la sesión del servidor), no un parámetro del cliente.

**AC-3 — Rutas protegidas sin bypass:**
- DADO un request a `/dashboard/appointments` sin sesión,
- CUANDO el middleware procesa el request,
- ENTONCES retorna redirect a `/login` — nunca retorna datos del dashboard.
