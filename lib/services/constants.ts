/**
 * Service-related constants for the UI.
 * Standardized to maintain visual consistency and ease of maintenance.
 */

export const SERVICE_COLORS = [
  "#6366f1", // Indigo
  "#8b5cf6", // Violet
  "#ec4899", // Pink
  "#f59e0b", // Amber
  "#10b981", // Emerald
  "#3b82f6", // Blue
  "#ef4444", // Red
  "#14b8a6", // Teal
] as const;

export const SERVICE_CATEGORIES = [
  "Corte",
  "Color",
  "Tratamiento",
  "Estética",
  "Salud",
  "Consulta",
  "Entrenamiento",
  "Otro",
] as const;

export const DEFAULT_SERVICE_COLOR = SERVICE_COLORS[0];
export const DEFAULT_DURATION = 30;
