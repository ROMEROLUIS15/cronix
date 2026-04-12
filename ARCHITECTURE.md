# Cronix - Arquitectura del Sistema

Este documento describe la arquitectura técnica de Cronix tras la refactorización a un modelo **Domain-Driven Repository**.

## 1. Capas del Sistema

Cronix sigue una arquitectura de diseño limpio separada en tres capas principales:

### Capa de Presentación (UI)
- **Tecnología**: Next.js (App Router).
- **Responsabilidad**: Renderizar la interfaz, manejar el estado local de la UI y capturar entradas del usuario.
- **Acceso a Datos**: NUNCA llama a Supabase directamente. Usa el factory `getRepos(supabase)`.

### Capa de Aplicación / Dominio
- **Contratos (Interfaces)**: Ubicados en `lib/domain/repositories/`. Definen QUÉ operaciones se pueden hacer, pero no cómo.
- **Manejo de Errores**: Se utiliza el patrón `Result<T>`: `{ data: T | null, error: string | null }`. Esto elimina la necesidad de `try/catch` dispersos por la UI.

### Capa de Infraestructura
- **Implementación**: Ubicada en `lib/repositories/`.
- **Tecnología**: Supabase (PostgreSQL).
- **Aislamiento**: Cada repositorio (ej. `SupabaseAppointmentRepository`) recibe un cliente de Supabase y asegura que todas las consultas incluyan la validación de `business_id` (Multi-tenancy).

## 2. Flujo de Datos de la IA

El **AI Assistant** utiliza una arquitectura de confianza cero para interactuar con los datos:

1. **Tool Registry**: Mapea las funciones de la IA a handlers en el servidor.
2. **ToolContext**: Provee una instancia compartida de todos los repositorios para una sola petición.
3. **Validación Zod**: Cada herramienta (`book_appointment`, `get_clients`, etc.) valida estrictamente sus argumentos contra un esquema Zod antes de tocar la base de datos.
4. **Repositorio**: La herramienta usa el repositorio correspondiente para ejecutar la operación de negocio.

## 3. Monitoreo y Hardening

- **Observabilidad**: 
  - **Sentry**: Rastreo de excepciones críticas en producción.
  - **Axiom**: Logs estructurados para auditoría y depuración de alto volumen.
- **Seguridad**:
  - **RLS (Row Level Security)**: Políticas optimizadas en Supabase para asegurar aislamiento total entre negocios.
- **Calidad**:
  - **Vitest**: Suite de pruebas unitarias para la lógica de repositorios.
  - **Playwright**: Suite de pruebas E2E para flujos críticos de usuario.

---
*Cronix - Vibe + Solidez + Seguridad*
