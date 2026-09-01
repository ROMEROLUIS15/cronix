# Manifiesto de Dominio: Dashboard UI

## 1. Propósito

El Dashboard es la interfaz web exclusiva para el **DUEÑO / STAFF del negocio** (no para clientes). Permite gestionar citas, clientes, servicios, finanzas, equipo, reportes y configuración del negocio desde un navegador o PWA.

El punto de entrada es `app/[locale]/dashboard/` con un layout protegido que verifica sesión y pertenencia a negocio antes de renderizar cualquier contenido.

## 2. Estructura de Rutas

Secciones del dashboard identificadas en sidebar (`components/layout/sidebar.tsx`) y rutas reales en `app/[locale]/dashboard/`:

| Ruta | Sección | En Sidebar |
|---|---|---|
| `/dashboard` | Agenda (home) | Sí |
| `/dashboard/appointments` | Citas (listado) | No (sub-ruta de agenda) |
| `/dashboard/appointments/new` | Nueva cita | No |
| `/dashboard/appointments/[id]/edit` | Editar cita | No |
| `/dashboard/clients` | Clientes | Sí |
| `/dashboard/clients/new` | Nuevo cliente | No |
| `/dashboard/clients/[id]` | Perfil de cliente | No |
| `/dashboard/clients/[id]/edit` | Editar cliente | No |
| `/dashboard/services` | Servicios | Sí |
| `/dashboard/team` | Equipo | Sí (ownerOnly) |
| `/dashboard/finances` | Finanzas | Sí |
| `/dashboard/finances/expense` | Gasto individual | No |
| `/dashboard/finances/expenses` | Gastos | No |
| `/dashboard/finances/new` | Nuevo movimiento | No |
| `/dashboard/finances/transactions` | Transacciones | No |
| `/dashboard/reports` | Reportes | Sí |
| `/dashboard/observability` | Observabilidad | Sí (ownerOnly) |
| `/dashboard/settings` | Ajustes | Sí |
| `/dashboard/plans` | Planes | Sí |
| `/dashboard/profile` | Perfil | Sí (inline) |
| `/dashboard/referrals` | Referidos | No |
| `/dashboard/setup` | Onboarding | No |
| `/dashboard/admin/pulse` | System Pulse | Sí (adminOnly) |
| `/dashboard/admin/users` | User Management | Sí (adminOnly) |
| `/dashboard/admin/payments` | Payments | Sí (adminOnly) |

> **Onboarding (`/dashboard/setup`) captura el horario.** El formulario de creación pide hora de apertura/cierre (default 09:00–18:00) + toggle de domingos; la action `createBusiness` lo persiste en `settings.workingHours` en el formato canónico (`{ mon: [open, close] | null, … }`, claves de 3 letras) que leen los agentes WhatsApp y voz. Así ningún negocio nace sin horario usable. El editor por-día completo vive en Configuración.

## 3. Reglas de Acceso

Toda la protección se implementa en `app/[locale]/dashboard/layout.tsx`:

1. **Sin sesión**: `getAuthUser()` retorna `null` → `redirect('/login')`. Nunca se muestran datos del dashboard.
2. **Con sesión pero sin `business_id`**: si el perfil no tiene `business_id` y no es `platform_admin` y no está en `/setup` → `redirect('/dashboard/setup')`. El usuario no puede ver datos de ningún negocio.
3. **Platform Admin**: bypass de la regla de `business_id`. Puede acceder a rutas `/dashboard/admin/*`.
4. **Role-based en sidebar**:
   - `ownerOnly` (team, observability): oculto para empleados
   - `adminOnly` (admin/pulse, admin/users, admin/payments): visible solo para `platform_admin`
   - Items sin restricción: visibles para todos los roles autenticados con negocio

## 4. Patrones Obligatorios de UI

Todo componente de lista/datos debe implementar tres estados:

| Estado | Comportamiento |
|---|---|
| **Loading** | Mostrar spinner/skeleton mientras se resuelve la data asíncrona |
| **Error** | Mostrar mensaje de error con opción de reintento cuando falla la fuente de datos |
| **Empty (lista vacía)** | Mostrar mensaje informativo y CTA cuando no hay registros, ej: "No hay citas para esta fecha" |

**No se debe asumir estado perfecto.** Todo componente debe manejar los tres casos explícitamente.

Ejemplo en `appointments/page.tsx`: el hook `useAppointmentsList()` expone `loading`, `filteredApts` (que puede ser array vacío), y la UI maneja `isExpired` y otras condiciones de borde.

## 5. Integración con el Voice Agent

El dashboard monta un **Floating Action Button (FAB)** de voz (`components/dashboard/voice-assistant-fab.tsx`) en el layout:

- **Endpoint**: llama a `supabase/functions/v1/voice-worker` directamente
- **Autenticación**: envía el JWT del usuario (`Authorization: Bearer <access_token>`)
- **Input**: audio vía Web Speech API (desktop Chrome/Edge) o MediaRecorder + STT server-side del `voice-worker` (Deepgram Nova-2) en mobile/fallback; o texto si falla STT
- **Response**: recibe `{ text, audioUrl, actionPerformed, transcription }`
- **Invalidación post-acción**: si `actionPerformed=true`, invalida las queries de React Query para `appointments`, `dashboard-stats`, `clients` y `notifications`
- **Persistencia de historial**: guarda los últimos 15 turnos en `sessionStorage`
- **Visibilidad**: controlable por `business.settings.uiSettings.showLuisFab` en DB o por evento `cronix:toggle-fab`
- **Hard timeout**: 45s en estados `processing`/`speaking`, 30s en reproducción de audio

## 6. Criterios de Aceptación

### AC-1 — Usuario sin sesión → redirect a /login
- DADO un usuario no autenticado que intenta acceder a cualquier ruta `/dashboard/*`,
- CUANDO `getAuthUser()` retorna `null`,
- ENTONCES el layout ejecuta `redirect('/login')` y el navegador nunca renderiza datos del dashboard.

### AC-2 — Usuario con sesión pero sin `business_id` → no puede ver datos de negocio
- DADO un usuario autenticado cuyo perfil no tiene `business_id` y no es `platform_admin`,
- CUANDO intenta acceder a `/dashboard` (o cualquier ruta que no sea `/setup`),
- ENTONCES el layout ejecuta `redirect('/dashboard/setup')`. Los componentes de datos (page.tsx) reciben `initialStats` e `initialHasServices` con valores por defecto (cero/false).

### AC-3 — Todo componente de lista tiene estados loading, error y lista vacía
- DADO cualquier sección del dashboard que renderiza una lista (citas, clientes, servicios, etc.),
- CUANDO el componente se monta o recibe datos,
- ENTONCES debe manejar explícitamente:
  - **Loading**: indicador visual mientras se resuelve la data
  - **Empty**: mensaje informativo cuando la lista está vacía
  - **Error**: mensaje de error con opción de reintento cuando falla la fuente de datos

## 7. Internacionalización (i18n) — NORMATIVO

El dashboard es multi-idioma vía `next-intl`. Locales: `es` (fuente/default), `en`, `pt`, `fr`, `de`, `it` (única fuente de verdad: `i18n/routing.ts`). Los mensajes viven en `messages/<locale>.json` (CRLF + 2 espacios).

Reglas (innegociables):

1. **Cero texto hardcoded visible al usuario.** Todo string que ve el dueño/staff (JSX, `title`, `aria-label`, `placeholder`, `alt` no-marca) DEBE resolverse vía `t()` / `t.rich()` / `getTranslations()`. Excepciones permitidas y documentadas: nombres de marca (`Cronix`, `WhatsApp Business`, `Binance Pay ID`, `Pago Móvil`), nombres de plan (`Free`/`Pro`/`Enterprise`), y herramientas internas solo-`platform_admin` (`/dashboard/admin/*`, `components/admin/*`) que se mantienen en inglés a propósito.
2. **Server components** usan `getTranslations`/`getLocale` (async, `next-intl/server`); **client components** usan `useTranslations` (`next-intl`). El `t` debe declararse en el MISMO componente donde se renderiza (cuidado con sub-componentes y fallbacks de `<Suspense>`).
3. **Formato locale-aware.** `toLocaleString`/fechas usan el locale activo (`getLocale()`), nunca un locale fijo (`'es-CO'`).
4. **Paridad de claves obligatoria.** Cada locale expone EXACTAMENTE el mismo set de claves que `es`. Garantizado por `__tests__/i18n/parity.test.ts` (falla en CI ante claves faltantes/sobrantes). Una clave faltante = pantalla en idioma equivocado.
5. **Sin errores ortográficos** en ningún idioma (revisión nativa por locale).

> Estado: dashboard + auth/público + componentes UI/PWA + páginas legales (`privacy`, `terms`) migrados y verificados (`tsc` limpio, parity test verde, 44 namespaces ×6 locales). Toda la superficie de cara al usuario está internacionalizada; lo único hardcoded restante es marca (`Cronix`, `Free`/`Pro`/`Enterprise`), herramientas internas `platform_admin` (inglés a propósito) y la herramienta de debug `pwa-debug`. Las traducciones legales (privacy/terms) son boilerplate SaaS y conviene una revisión legal por jurisdicción. Revisión nativa de calidad por idioma COMPLETADA (DE→registro `du` unificado; FR→meses Juin/Juil; IT→concordancia de género; PT/EN limpios). Único polish opcional restante: consistencia cosmética `email`/`e-mail` (todos los locales).

## 8. Métricas financieras — fuente canónica (NORMATIVO)

Home, Finanzas y Reportes muestran cifras del mes. **Las tres consumen UNA sola fuente de verdad: el RPC `fn_get_monthly_metrics(p_business_id, p_month_start date)`** (migración `20260622000000`). Está prohibido recalcular ingresos del mes con una fórmula propia en cualquier sección — eso reintroduce la divergencia que este contrato elimina.

El RPC deriva el mes calendario completo a partir de `p_month_start` y devuelve, **atribuyendo por la fecha de la cita (`start_at`)**:

| Campo | Significado | Base |
|---|---|---|
| `billed_revenue` | **Prestado** — valor de servicios prestados | `SUM(services.price)` de citas `completed` con `start_at` en el mes |
| `collected_revenue` | **Cobrado** — caja real | `SUM(transactions.net_amount)`; se atribuye por el `start_at` de la cita vinculada. **Una transacción sin cita** (`appointment_id` nulo: pago manual/walk-in) se atribuye por su `paid_at`, porque no tiene `start_at`. |
| `total_expenses` | **Gastos** | `SUM(expenses.amount)` con `expense_date` (columna `date`) dentro del mes, comparado como `date` (incluye día 1 y último día). |

Reglas normativas:

1. **Dos métricas separadas, nunca mezcladas.** Prestado (`billed`) y Cobrado (`collected`) son universos distintos y **no tienen por qué cuadrar entre sí** (una cita completada puede no estar pagada; un pago puede llevar descuento/propina). La utilidad y los ratios (`marginPct`, `expensePct`) se calculan sobre **Cobrado**; `collectionRate = collected/billed`. La derivación vive en la función pura `buildMonthlyFinanceView` (`lib/use-cases/finances.use-case.ts`).
2. **El desglose "por servicio" de Reportes es base Prestado** (precio de lista de citas completed) — la misma base que `billed`, para que reconcilien.
3. **`fn_get_dashboard_stats.month_revenue` = `collected`** (mismo RPC). El Home muestra caja real.
4. **Cotas correctas:** rango half-open `[inicio_mes, inicio_mes_siguiente)`; jamás filtrar "del 1 en adelante" sin cota superior (bug histórico), ni comparar `date` contra timestamp ISO como string (descartaba el gasto del día 1).
5. Acceso solo vía repo: `finances.getMonthlyMetrics(businessId, monthStart)` (`IFinanceRepository`), que coacciona los `NUMERIC` (strings de PostgREST) a number.
6. **Aislamiento multi-tenant (constitution §4) — OBLIGATORIO.** `fn_get_monthly_metrics` y `fn_get_dashboard_stats` son `SECURITY DEFINER` (bypasean RLS) y ejecutables por `authenticated`. Por eso DEBEN llamar al guard `fn_assert_business_access(p_business_id)` como primera sentencia: solo pasan `service_role`, el dueño del negocio (`current_business_id()`) o un `platform_admin`; cualquier otro → `42501`. Sin el guard, un usuario podía leer las finanzas de otro negocio enumerando UUIDs (fuga cerrada en `20260622120000`, cubierta por pgTAP en `rls_policies.test.sql §27`). Toda nueva RPC `SECURITY DEFINER` que reciba `business_id` y sea ejecutable por `authenticated` debe usar este mismo guard.

## 9. Importar contactos del teléfono — dos rutas según plataforma (NORMATIVO)

Los formularios de cliente (`clients/new`, `clients/[id]/edit`) permiten traer un contacto de la agenda del dispositivo. Existen **dos rutas** y la plataforma decide cuál se ofrece; **nunca se muestran las dos a la vez**.

| Plataforma | Contact Picker API | Ruta ofrecida |
|---|---|---|
| Chrome Android 80+ | Habilitada por defecto | **A** — botón nativo, un toque |
| Safari / Chrome / Firefox en iOS y iPadOS | **No implementada por WebKit** | **B** — importar `.vcf` |
| Safari / Firefox de escritorio | No implementada | **B** — importar `.vcf` |

Como iOS obliga a todos los navegadores a usar WebKit, la fila de iOS aplica también a Chrome/Firefox en iPhone y a la PWA instalada. **No existe código que haga funcionar `navigator.contacts.select()` en iOS, ni lo habrá mientras WebKit no lo implemente.**

### 9.1 Ruta A — Contact Picker API (Android)

Cadena: `lib/services/contact-picker.service.ts` (wrapper + feature detection) → `lib/hooks/use-contact-picker.ts` (estado + `onPick`) → `components/ui/phone-input-flags.tsx` (render del botón).

`useContactPicker` expone `supported`, y las páginas pasan `onPickContact={cpSupported ? pickContact : undefined}`; con `undefined` el botón **no se renderiza**. Esto es intencional, no un bug.

### 9.2 Ruta B — importar un archivo `.vcf` (iOS y escritorio)

Cadena: `lib/services/vcard.service.ts` (parser puro) → `lib/hooks/use-vcard-import.ts` (lectura del archivo + selección) → `components/ui/vcard-import.tsx` (botón, `<input type="file">` oculto, ayuda y selector).

Flujo en iPhone: Contactos → compartir la ficha → **«Guardar en Archivos»** → en Cronix, *Importar desde archivo de contacto* → elegir el archivo. En escritorio es un `.vcf` exportado de la agenda.

**Es la única ruta que alcanza la agenda del iPhone desde una página web.** El parser acepta las tres formas que aparecen en exports reales: vCard 3.0 (lo que exporta iOS), 2.1 con quoted-printable (Android/Outlook) y 4.0 con valores URI (`tel:`, `mailto:`).

### 9.3 Invariantes (NORMATIVAS)

1. **Una sola ruta visible.** La ruta B se renderiza si y solo si `!cpSupported`. Ofrecer ambas en Android sería ruido sobre un botón que ya resuelve el caso a un toque.
2. **`isIOS()` no decide si la ruta B se muestra — solo su redacción.** Alimenta `isIos` en `useContactPicker` y de ahí `VCardImport isIos`, que elige entre `common.vcardHintIos` (pasos de exportar desde Contactos) y `common.vcardHintDesktop`. El escritorio también carece de la API pero no exporta igual; darle los pasos del iPhone sería mentirle.
3. **La importación rellena huecos, no pisa datos.** `name` y `email` solo se escriben si el campo está vacío (`prev.name || name`); el teléfono sí se sobrescribe, porque es el campo que el usuario pidió importar explícitamente. En el formulario de edición esto protege los datos ya guardados del cliente.
4. **Las dos rutas aterrizan idéntico.** El match de prefijo de país y la limpieza del número viven una sola vez en `splitContactPhone` (`lib/hooks/contact-phone.ts`), compartido por ambos hooks. Duplicar esa lógica haría que un mismo contacto entrara distinto según la puerta (constitution §1.0).
5. **Preferencia de teléfono: móvil → `PREF` → el primero.** El agente de WhatsApp necesita el móvil, así que `TYPE=CELL` gana aunque venga después del fijo.
6. **El `accept` del input debe seguir siendo permisivo** (`.vcf,.vcard,text/vcard,text/x-vcard,text/directory`). iOS mapea `accept` a UTIs y un filtro estrecho **grisea el archivo que el usuario acaba de guardar** desde Contactos.
7. **Prohibido lookbehind en el parser.** Safari solo lo soporta desde 16.4; un `SyntaxError` ahí tumbaría el chunk entero en justo las versiones de iOS que esta función existe para servir. `splitStructured` está escrito como escaneo por eso.
8. Fichas sin nombre **y** sin teléfono se descartan: no aportan nada al formulario y como opciones solo serían ruido.

### 9.4 Por qué NO se usa el AutoFill de Safari — corrección del 2026-08-20

La versión anterior de esta sección afirmaba que Safari permitía importar un contacto **arbitrario** vía «Autorrellenar contacto» → «Otro contacto», y que los tokens `autocomplete` eran el requisito para que apareciera. **Eso era falso y está retirado.**

- **Desmentido en dispositivo real** (iPhone, 2026-08-31): el flujo no aparece. Era el riesgo residual que la propia sección dejó anotado como *"no verificado en dispositivo"*.
- **Y no habría servido igual.** El AutoFill de contacto de Safari rellena desde **«Mi info»** — la ficha *del propio usuario*, configurada en Ajustes → Safari → Autorrellenar. El formulario de cliente pide los datos de **otra persona**. Aunque el menú existiera, habría rellenado al dueño del negocio, no a su cliente: el mecanismo apuntaba a un problema distinto del que la función resuelve.

Los tokens `autocomplete` (`name`, `email`, `tel-national`) **se conservan** — son buena práctica de accesibilidad y ayudan al gestor de contraseñas — pero han dejado de ser un requisito de esta función y no deben documentarse como tal.

| Campo | Token | Archivos |
|---|---|---|
| Nombre | `name` | `clients/new/page.tsx`, `clients/[id]/edit/page.tsx` |
| Teléfono | `tel-national` | `components/ui/phone-input-flags.tsx` |
| Email | `email` | `clients/new/page.tsx`, `clients/[id]/edit/page.tsx` |

### 9.5 Cobertura

`lib/services/vcard.service.test.ts` (18 casos) cubre el parser con formas de export reales: ficha de iOS 17, varias fichas en un archivo, prefijos de grupo `item1.` de Apple, plegado RFC, quoted-printable con acentos (incluido el corte por `=` final), `tel:`/`mailto:` de 4.0, reconstrucción del nombre desde `N`, comas y `;` escapados, y entradas basura.

Dos ramas están **verificadas por mutación** (romperlas hace fallar su test, no solo bajar cobertura):

- **El guard de quoted-printable en `unfoldLines`.** Tratar todo `=` final como plegado se come la línea siguiente cuando la ficha trae un `PHOTO` en base64 — y la ficha pierde el teléfono.
- **La rama de iPadOS 13+ en `isIOS()`** (`lib/services/contact-picker.service.test.ts`, 10 casos con UA reales): iPadOS se hace pasar por `Macintosh` y solo `maxTouchPoints > 1` lo distingue. Un falso negativo le daría al iPad la ayuda de escritorio.

> **Trade-off (sugerencia del agente + decisión del dueño, 2026-08-31).** Con la ruta (a) `autocomplete` + AutoFill desmentida en dispositivo, se re-evaluaron las dos restantes del menú original: **(b) importar `.vcf`** y **(c) wrapper nativo (Capacitor)**. Se eligió **(b)**. El argumento que la descartó en agosto —"3 pasos extra"— dejó de aplicar cuando la alternativa pasó a ser *ninguna ruta*; y (c) sigue implicando publicar en App Store, desproporcionado para este hueco. **Consecuencia aceptada: la paridad es funcional, no idéntica** — Android resuelve en un toque, iOS en cuatro (compartir, guardar en Archivos, abrir el importador, elegir). **Ventaja no prevista:** un `.vcf` puede traer varias fichas, así que iOS y escritorio ganan selección múltiple —`ContactChooser`— que el picker de Android no tiene (`multiple: false`). **Riesgo residual:** la ruta B está verificada por tests unitarios del parser y por el flujo de `<input type="file">`, que es HTML estándar, pero **el flujo completo en un iPhone real sigue sin ejecutarse end-to-end**; si Contactos cambiara el formato de export, lo atraparía el parser, no un test de dispositivo. Se descartó de nuevo el emulador por las razones de agosto (DevTools con UA de iPhone sigue siendo Blink; Playwright WebKit no es Safari iOS; `ios-simulator-mcp` exige macOS+Xcode y el equipo es Windows).
