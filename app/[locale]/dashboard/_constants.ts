/**
 * _constants.ts — Shared visual constants for the dashboard.
 * Centraliza colores de estado para evitar magic strings dispersos.
 */

export const STATUS_COLORS: Record<string, string> = {
  pending:   "#FFD60A",
  confirmed: "#0062FF",
  completed: "#30D158",
  cancelled: "#FF3B30",
  no_show:   "#8A8A90",
}

export const DEFAULT_STATUS_COLOR = "#3884FF"

/** Type-safe accessor — avoids noUncheckedIndexedAccess violations */
export function getStatusColor(status: string | null | undefined): string {
  if (!status) return DEFAULT_STATUS_COLOR
  return STATUS_COLORS[status] ?? DEFAULT_STATUS_COLOR
}
