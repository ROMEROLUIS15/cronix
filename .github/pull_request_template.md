<!--
  Plantilla de PR de Cronix. La sección "Declaración SDD" es obligatoria para
  cualquier PR que toque código. Ver el Gate de Arranque en docs/specs/INDEX.md.
-->

## Qué cambia

<!-- Descripción breve del cambio y su motivación. -->

## 🚦 Declaración SDD (obligatoria para cambios de código)

> No basta con nombrar el spec: **cita la cláusula/invariante concreta** que gobierna el cambio. Citar una invariante exacta es la evidencia de que leíste el manifest (el revisor verifica que corresponda al módulo tocado).

- **Specs leídos:** <!-- ej: constitution + modulo-pagos -->
- **Invariante/cláusula que gobierna el cambio:** <!-- ej: modulo-pagos §4 — el bono se aplica solo en la primera factura 'finished' -->
- [ ] El cambio respeta las cláusulas **normativas** del/los manifest(s) citado(s).
- [ ] Si el spec y el código divergían, lo reporté y actualicé el spec **descriptivo** (o el código si la violación era normativa).
- [ ] Si toqué un área **sin spec (🔴)**, lo declaré en la descripción.

## Validación

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] (si aplica) E2E / migración verificada

## Notas para el revisor

<!-- Riesgos, decisiones de diseño, áreas que requieren atención. -->
