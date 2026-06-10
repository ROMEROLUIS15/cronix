# Cronix — Instrucciones para GitHub Copilot / VS Code

Este repositorio opera bajo **Spec-Driven Development (SDD)**. La fuente canónica del protocolo es `docs/specs/INDEX.md`. Ver también `AGENTS.md`.

## 🚦 LEY CERO — Gate SDD (antes de tocar código)

ANTES de generar, modificar o refactorizar una sola línea de código, ejecuta el Protocolo de Arranque de `docs/specs/INDEX.md`:

1. Leer `docs/specs/INDEX.md` e identificar el módulo a tocar.
2. Leer `docs/specs/constitution.md` (reglas globales del repo).
3. Leer el `manifest.md` del módulo correspondiente.

Reglas del gate (innegociables):

- **Sin excepción por "cambio pequeño":** aplica a cada tarea de código, incluidas correcciones de una línea.
- **Lo normativo del spec** (contratos, invariantes, códigos de error, flujos) manda sobre tu criterio. Lo descriptivo (nombres de función, rutas, proveedor) se sigue del código real actual.
- **Si el spec y el código divergen, reporta la divergencia antes de escribir.** No improvises.
- **Área sin spec o marcada 🔴** → decláralo y pide confirmación antes de codificar.
- **Declara qué specs leíste** al inicio de tu respuesta (ej: `SDD: constitution + modulo-pagos`).

Las reglas detalladas de estilo y arquitectura viven en `.agent/rules/good-development-practices.md` y también son vinculantes.
