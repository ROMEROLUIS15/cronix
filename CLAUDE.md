# Cronix — Gobernanza para Agentes

Este repositorio opera bajo **Spec-Driven Development (SDD)**. Las especificaciones viven en `docs/specs/` y son vinculantes.

## 🚦 LEY CERO — Gate SDD (antes de tocar código)

**ANTES de generar, modificar o refactorizar una sola línea de código, ejecuta el Protocolo de Arranque** (definido de forma canónica en `docs/specs/INDEX.md`, importado al final de este archivo):

1. Leer `docs/specs/INDEX.md` e identificar el módulo a tocar.
2. Leer `docs/specs/constitution.md` (reglas globales del repo).
3. Leer el `manifest.md` del módulo correspondiente.

Reglas del gate (innegociables):

- **Sin excepción por "cambio pequeño".** Aplica a cada tarea de código, incluidas correcciones de una línea.
- **Lo normativo del spec (contratos, invariantes, códigos de error, flujos) manda sobre tu criterio.** Lo descriptivo (nombres de función, rutas, proveedor concreto) se sigue del código real actual.
- **Si el spec y el código divergen, reporta la divergencia antes de escribir.** No improvises ni elijas en silencio.
- **Área sin spec o marcada 🔴 → decláralo y pide confirmación** antes de codificar.
- **Declara qué specs leíste** al inicio de tu respuesta a una tarea de código (ej: `SDD: constitution + modulo-pagos`). Si no puedes nombrarlos, no cumpliste el gate.

## Reglas de estilo y arquitectura

Las reglas detalladas de código (capas DDD, tipado estricto, manejo de errores, multi-tenant, testing) viven en `.agent/rules/good-development-practices.md` y también son vinculantes.

---

@docs/specs/INDEX.md
