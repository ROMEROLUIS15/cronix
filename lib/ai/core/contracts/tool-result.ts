/**
 * tool-result.ts — Contrato unificado de salida para todos los tools de IA.
 *
 * Reemplaza:
 *   - string crudo (appointment.tools.ts legacy)
 *   - { success, result, data?, error? } del RealToolExecutor
 *   - JSON.stringify({ success, error }) del WhatsApp tool-executor
 *
 * Regla: todos los tools retornan ToolResult<T>.
 * Los channel adapters convierten ToolResult al formato de su canal.
 */

// ── Códigos de error semánticos ───────────────────────────────────────────────
// Tipados como string literal union: exhaustivos en switch, legibles en logs.

export type ToolErrorCode =
  | 'SLOT_CONFLICT'
  | 'CLIENT_NOT_FOUND'
  | 'CLIENT_AMBIGUOUS'
  | 'CLIENT_MULTIPLE'
  | 'SERVICE_NOT_FOUND'
  | 'APPOINTMENT_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'BOOKING_RATE_LIMIT'
  | 'PLAN_LIMIT_REACHED'
  | 'INVALID_ARGS'
  | 'DB_ERROR'

// ── Payload estructurado de acciones de escritura ─────────────────────────────
// Presente en el resultado de tools que mutan la BD.
// Permite que el channel adapter construya notificaciones sin parsear strings.

export type BookingData = {
  appointmentId: string
  clientName:    string
  serviceName:   string
  date:          string  // YYYY-MM-DD en timezone local del negocio
  time:          string  // HH:mm en timezone local del negocio
  action:        'created' | 'cancelled' | 'rescheduled'
}

// ── Tipo discriminado principal ────────────────────────────────────────────────

export type ToolResult<T = void> =
  | ToolSuccess<T>
  | ToolFailure

export type ToolSuccess<T = void> = {
  success:  true
  data:     T
  message:  string  // texto listo para mostrar al usuario (español)
}

export type ToolFailure = {
  success:  false
  error:    ToolErrorCode
  message:  string  // texto listo para mostrar al usuario (español)
  /** Candidatos para errores ambiguos — el adapter decide cómo presentarlos */
  candidates?: string[]
}

// ── Constructores helper ──────────────────────────────────────────────────────

export function toolOk<T>(data: T, message: string): ToolSuccess<T> {
  return { success: true, data, message }
}

export function toolFail(error: ToolErrorCode, message: string, candidates?: string[]): ToolFailure {
  return { success: false, error, message, ...(candidates ? { candidates } : {}) }
}

// ── Serialización para el LLM ─────────────────────────────────────────────────
// El LLM recibe el resultado del tool como string (mensaje de rol 'tool').
// Usamos el message directamente — nunca exponemos campos internos al LLM.

export function serializeForLlm(result: ToolResult<unknown>): string {
  if (result.success) return result.message
  return result.message
}
