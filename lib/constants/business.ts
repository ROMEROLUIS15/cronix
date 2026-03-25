/**
 * Shared business constants used across registration, setup, and settings.
 */

export const BUSINESS_CATEGORIES = [
  "Barbería",
  "Estética / Belleza",
  "Salón de belleza",
  "Clínica",
  "Consultorio médico",
  "Spa",
  "Entrenador personal",
  "Restaurante",
  "Consultoría",
  "Salud / Medicina",
  "Deportes / Gimnasio",
  "Tech",
  "Electrodomésticos",
  "Otros",
] as const

export type BusinessCategory = typeof BUSINESS_CATEGORIES[number]
