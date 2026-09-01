# ADR-0009: Upgrade a Next.js 16 + fijar el build a webpack

**Fecha:** 2026-09-01
**Estado:** Implementado ✅
**Sucede a:** [ADR-0002](./0002-nextjs-upgrade-deferral.md) (upgrade 14 → 15, mismo disparador)
**Disparador:** el gate de `npm audit` del pre-push empezó a fallar solo

---

## Contexto

El hook `pre-push` corre 4 etapas y la última es `npm audit --audit-level=high --omit=dev`. Empezó a fallar **sin que nadie tocara nada**: se publicaron 4 CVEs de libvips (CVE-2026-33327, -33328, -35590, -35591) que llegan por `sharp`.

`sharp` entraba por dos caminos a la vez:

- dependencia **directa** del proyecto (`^0.34.5`), y
- `next@15.5.23`, que fija `sharp ^0.34.3` en sus `optionalDependencies`.

Por eso **subir solo el `sharp` raíz no limpiaba el árbol**: npm le habría instalado a `next` su propia copia `0.34.x` anidada, y el hallazgo seguiría ahí. La primera versión de Next que declara `sharp ^0.35.4` es la **16**.

Con el gate rojo, *ningún* push pasaba — incluidos cambios sin relación con dependencias. Se evaluó saltarlo con `--no-verify`; el dueño eligió arreglar la causa (2026-09-01).

## Decisión

1. `next` `^15.5.15` → **`^16.3.4`**
2. `sharp` `^0.34.5` → **`^0.35.4`** (la directa; la de `next` ya viene en 0.35.4)
3. **`npm run build` pasa a `next build --webpack`**

## El hallazgo que obliga al punto 3

**Next 16 usa Turbopack por defecto en el build de producción, y Turbopack no ejecuta plugins de webpack.** `@ducanh2912/next-pwa` es un plugin de webpack, así que con el build por defecto **el service worker deja de generarse en silencio**: el build termina en exit 0 y no avisa de nada.

No es una sospecha, se verificó empíricamente: se borró `public/sw.js`, se reconstruyó, y **no reapareció**. Con `--webpack` sí reaparece (regenerado y con distinto tamaño, 17325 vs 17031 bytes), junto a `workbox-*.js`.

Es la clase de fallo más cara posible: no rompe el build, rompe la PWA en producción, y solo se nota cuando un usuario tiene cacheada una versión vieja de la app.

## Consecuencias

**Se conserva** todo lo que dependía de webpack: service worker de la PWA, `customWorkerDir`, y el plugin de Sentry (subida de source maps, `treeshake`).

**Se acepta** quedarse en el bundler que Next está dejando atrás. `--webpack` sigue existiendo en 16.3.4, pero es una salida con fecha de caducidad: **esto compra tiempo, no resuelve**. La deuda real es sacar la PWA de un plugin de webpack — el candidato es [Serwist](https://serwist.pages.dev/), sucesor mantenido de `next-pwa` y compatible con Turbopack. Sentry v10 ya expone opciones separadas para webpack y Turbopack, así que **el único bloqueante para adoptar Turbopack es la PWA.**

**No cambia** el desarrollo: `next dev --turbo` sigue siendo válido en 16, así que `npm run dev` queda igual y el ciclo local mantiene la velocidad de Turbopack. La penalización de webpack se paga solo en el build.

## Cambios de configuración

Se eliminaron de `next.config.js` los bloques vacíos `typescript: {}` y `eslint: {}` (solo contenían comentarios). Next 16 **rechaza** la clave `eslint`: `Unrecognized key(s) in object: 'eslint'`. Los comentarios que explicaban por qué no se suprimen errores de tipo/lint se conservaron como comentarios sueltos.

**Cambios que hizo Next solo, durante el primer build** (no son ediciones nuestras, pero quedan en el commit y conviene que el siguiente lector no los tome por accidentales):

- `tsconfig.json`: **`"jsx": "preserve"` → `"jsx": "react-jsx"`**. Es semántico, no cosmético: el typechecker pasa a validar el JSX contra `react/jsx-runtime` en vez de dejarlo intacto para el bundler. Se aceptó porque `tsc --noEmit` da 0 y la suite de componentes sigue en 389 verdes — y porque revertirlo solo haría que el siguiente build lo reescribiera. También se añadió `.next/dev/types/**/*.ts` a `include`, y el archivo quedó reformateado (arrays expandidos) por el reescritor de Next.
- `next-env.d.ts`: la referencia `/// <reference path="./.next/types/routes.d.ts" />` pasó a `import`, más un `root-params.d.ts` nuevo. El archivo está marcado como no editable a mano.

## Diferido deliberadamente

| Pendiente | Por qué no ahora |
|---|---|
| `eslint-config-next` 15 → 16 | La 16 exige `eslint >= 9` y el repo está en ESLint 8.57.1 con `.eslintrc.json` legacy → arrastra migración a flat config. **Next 16 no lo requiere**, y el gate de audit corre con `--omit=dev`, así que ni ve las devDeps. Se probó, rompió el lint (`Converting circular structure to JSON`) y se revirtió. |
| `middleware.ts` → `proxy.ts` | Next 16 lo marca **deprecado, no eliminado**; el build sigue resolviéndolo (`ƒ Proxy (Middleware)`). Toca `modulo-auth`, que es zona con spec, así que merece su propio cambio con su lectura de gate. Hay codemod oficial: `npx @next/codemod@canary middleware-to-proxy .` |
| Migrar la PWA a Serwist | Es lo que permitiría soltar `--webpack`. Cambio de plataforma de la capa PWA, no una tarea de dependencias. |

## Verificación

`npm audit --omit=dev --audit-level=high` → **0 vulnerabilidades** (era 2 high).
`tsc --noEmit` 0 · `lint` 0 errores · `npm test` 1659 · `test:components` 389 · `knip` exit 0 · spec-drift OK · `npm run build` exit 0 con `sw.js`, `workbox-*.js` y `.next/standalone/server.js` regenerados.

Avisos que quedan y son esperados: la deprecación de `middleware`, y un `process.cwd` en Edge Runtime que emite el propio `node_modules/next` — no es código nuestro.

**Sin verificar:** no se ejecutó la suite E2E de Playwright ni se desplegó. La verificación en runtime de la PWA (que el `sw.js` nuevo registre y cachee bien en un navegador) queda pendiente del despliegue.

## Trade-off registrado

> Sugerencia del agente + decisión del dueño (2026-09-01). Ante el gate rojo se plantearon dos salidas: **(a)** saltar el hook con `--no-verify` y dejar sharp/Next como el pendiente que ya era, o **(b)** migrar a Next 16. El dueño eligió **(b)**. Durante la ejecución apareció la regresión de la PWA, no prevista en el planteamiento inicial; se resolvió fijando el build a webpack en vez de abandonar la migración, porque el objetivo —cerrar los CVEs— sí se cumple y la deuda de bundler queda acotada y documentada arriba.
