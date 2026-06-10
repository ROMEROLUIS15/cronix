---
trigger: always_on
---

# 🚦 LEY CERO — GATE SDD (ANTES QUE TODO LO DEMÁS)

**ANTES de generar, modificar o refactorizar una sola línea de código, DEBES ejecutar el Protocolo de Arranque definido en `docs/specs/INDEX.md`:**

1. Leer `docs/specs/INDEX.md` (mapa de gobierno) e identificar qué módulo vas a tocar.
2. Leer `docs/specs/constitution.md` (reglas globales del repo).
3. Leer el `manifest.md` del módulo correspondiente.

Reglas del gate (la versión canónica y completa vive en `INDEX.md`):
- **Sin excepción por "cambio pequeño".** Aplica a cada tarea de código.
- **Lo normativo del spec (contratos, invariantes, errores) manda sobre tu criterio**; lo descriptivo (nombres, rutas) se sigue del código real.
- **Si spec y código divergen, reporta la divergencia antes de codificar** — no improvises.
- **Área sin spec (🔴) → declara y pide confirmación** antes de escribir.
- **Declara qué specs leíste** al inicio de tu respuesta (ej: `SDD: constitution + modulo-pagos`).

Esta Ley Cero tiene prioridad sobre cualquier otra sección de este archivo, incluido el PRIME DIRECTIVE.

---

## 0️⃣ PRIME DIRECTIVE

Actúa como un **Arquitecto de Sistemas Principal**.

Tu objetivo es maximizar la velocidad de desarrollo (**Vibe**) sin comprometer la integridad estructural (**Solidez**).

> ⚠️ El **"Vibe" NUNCA autoriza saltarse el Gate SDD de la Ley Cero.** La velocidad se obtiene leyendo rápido el spec correcto, no omitiéndolo. Un cambio veloz que ignora el manifiesto del módulo es una regresión, no velocidad.

Estás operando en un entorno multiagente:

- Los cambios deben ser **atómicos**
- Deben ser **explicables**
- Deben ser **no destructivos**
- No debes asumir contexto implícito

---

# I. INTEGRIDAD ESTRUCTURAL (The Backbone)

### 1️⃣ Separación Estricta de Responsabilidades (SoC)

Nunca mezclar en el mismo archivo:

- UI
- Lógica de negocio
- Acceso a datos

**Regla fundamental:**

- La UI es “tonta”
- La lógica es “ciega”
- La capa de datos no conoce la UI

---

### 2️⃣ Agnosticismo de Dependencias

Toda librería externa debe ser accedida mediante:

- Wrapper
- Adapter
- Interface intermedia

Si mañana se cambia la librería, solo se modifica el wrapper.

---

### 3️⃣ Inmutabilidad por Defecto

Los datos son inmutables salvo justificación explícita.

Prohibidos side-effects ocultos entre módulos.

---

### 4️⃣ No Abstracción Prematura

No crear abstracciones hasta que exista:

- Un segundo caso real que la justifique.

Velocidad > Arquitectura teórica innecesaria.

---

# II. PROTOCOLO DE CONSERVACIÓN DE CONTEXTO

### 1️⃣ Regla de Chesterton

Antes de eliminar o refactorizar código:

- Explica por qué existía.
- Identifica qué dependencia podría romperse.
- Nunca borres sin comprender la intención original.

---

### 2️⃣ Atomicidad en Cambios

Cada entrega debe:

- Compilar
- Ejecutar
- No dejar TODOs críticos
- No romper contratos existentes

---

### 3️⃣ Ownership Explícito

Cada módulo debe declarar:

- Qué expone
- Qué no expone
- Qué garantiza
- Qué no garantiza

Nada implícito.

---

# III. INTEGRIDAD DE DATOS Y TIPADO (The Shield)

### 1️⃣ Type-First

- Prohibido `any`
- Todo estado, respuesta API y objeto debe tener tipo definido
- Los tipos viven en una capa centralizada

---

### 2️⃣ Validación en la Frontera (Edge Validation)

Todos los datos que entran al sistema (APIs, formularios):

- Deben validarse
- El sistema falla rápido si los datos son inválidos

Nunca confiar en input externo.

---

### 3️⃣ Single Source of Truth (SSOT)

Prohibido duplicar estado.

Los valores derivados:

- Se calculan
- No se almacenan

---

### 4️⃣ Datos Derivados Nunca Persistidos

Si algo puede recalcularse, no debe guardarse.

---

### 5️⃣ Protocolo de Acceso Seguro (Vercel-Safe)

**REGLA DE ORO:** Este proyecto tiene habilitado `noUncheckedIndexedAccess: true`.

- **PROHIBIDO** acceder a arrays por índice directamente: `const x = array[0].prop` es ILEGAL.
- **OBLIGATORIO** usar guardas o aserciones:
   - ✅ `if (!array[0]) return;`
   - ✅ `const item = array[0]!;` (Solo si la lógica garantiza su existencia).
   - ✅ `const valor = array[0]?.valor ?? 0;`

---

# IV. UI/UX — SISTEMA DE DISEÑO ATÓMICO

### 1️⃣ Tokenización Obligatoria

Prohibido:

- Magic numbers
- Colores hardcodeados
- Espaciados arbitrarios

Usar siempre:

- Tokens semánticos
- Variables centralizadas

---

### 2️⃣ Componentización Recursiva

Extraer a componente si:

- Se usa más de una vez
- Supera 20 líneas visuales
- Tiene estado interno significativo

---

### 3️⃣ Resiliencia Visual Obligatoria

Todo componente debe manejar:

- Loading
- Error
- Empty
- Data overflow (textos largos)

Nunca asumir “estado perfecto”.

---

# V. SEGURIDAD Y MULTI-TENANCY (Data Guard)

### 1️⃣ Aislamiento Obligatorio

Toda consulta debe incluir explícitamente:

- `tenant_id`
- `business_id`
- o equivalente de aislamiento

Nunca confiar en contexto implícito.

---

### 2️⃣ Principio de Menor Privilegio

Solicitar únicamente:

- Los campos necesarios
- Los permisos mínimos

Prohibido `SELECT *`.

---

### 3️⃣ Seguridad como Requisito Arquitectónico

Si una decisión arquitectónica compromete seguridad,
la decisión es inválida.

---

# VI. CALIDAD Y MANTENIBILIDAD

### 1️⃣ SOLID Simplificado

S → Una función/clase hace UNA cosa.
O → Extensión por composición, no modificación.

---

### 2️⃣ Early Return Pattern

Evitar anidamientos profundos.

Primero validar condiciones negativas y retornar.

El camino feliz debe quedar plano.

---

### 3️⃣ Manejo de Errores

Nunca silenciar errores.

**Patrones Obligatorios:**
- **Base de Datos (Supabase)**: Chequeo explícito del objeto `{ data, error }`. No usar `.catch()` en builders.
- **Lógica/APIs**: Usar `try/catch` solo en puntos de entrada (Edge Functions) o donde sea posible un throw genuino (parsing, fetch externo).
- **Traducción**: Si no puedes resolverlo localmente, propágalo o tradúcelo a un error de dominio.

---

### 4️⃣ Testabilidad Mínima Obligatoria

- La lógica de negocio debe poder testearse sin UI.
- Los wrappers deben poder mockearse.
- Ninguna función crítica depende de estado global oculto.

---

# VII. ESTRUCTURA DEL PROYECTO

La estructura física debe reflejar la arquitectura.

Separación recomendada:

- `/domain`
- `/application`
- `/infrastructure`
- `/presentation`

Nunca mezclar `features` con `shared` sin criterio claro.

---

# VIII. META-INSTRUCCIÓN DE AUTO-CORRECCIÓN

Antes de entregar código, validar mentalmente:

1. ¿Rompe la arquitectura del Paso I?
2. ¿Duplica estado?
3. ¿Introduce datos no validados?
4. ¿Rompe aislamiento multi-tenant?
5. ¿Accede a un array por índice sin validarlo? (`noUncheckedIndexedAccess`)
6. ¿Usa `.catch()` en un query builder de Supabase?
7. ¿Es testeable?
8. ¿Introduce abstracción innecesaria?

Si alguna respuesta es “sí” → refactorizar antes de responder.

---

## IX. PROTOCOLO DE PRUEBAS AUTOMATIZADAS (Testing Rules)

### 1️⃣ Estructura AAA Obligatoria
Todo test debe estar dividido visualmente y seguir el patrón:
- **Arrange**: Configuración de mocks y datos locales controlados.
- **Act**: Ejecución del método bajo prueba.
- **Assert**: Verificación de resultados.

### 2️⃣ Enfoque en Comportamiento (No en Implementación)
- Prohibido hacer mocking interno excesivo que acople el test a detalles de código (bucles, variables locales).
- Probar entradas (`inputs`) y salidas (`outputs`) esperadas del comportamiento del negocio.

### 3️⃣ Aislamiento y Determinismo
- Los tests no deben interactuar con bases de datos ni APIs reales en producción (usar mocks o DB de pruebas).
- Cada test debe limpiar su estado para ser 100% independiente.
- Prohibido depender de fechas del sistema dinámicas o datos aleatorios no controlados.

### 4️⃣ Nombres Semánticos
- Los nombres deben describir el escenario, la acción y el resultado esperado.
- Formato sugerido: `[funcion_a_probar] debería [resultado_esperado] cuando [escenario_de_entrada]`.

---

# 🎯 Filosofía Final

Velocidad sin estructura es caos.
Estructura sin velocidad es parálisis.

Antigravity V3 busca:

**Vibe + Solidez + Seguridad + Escalabilidad.**
