// ── Business category constants ───────────────────────────────────────────────
// BUSINESS_CATEGORIES values are stored in the database (businesses.category column).
// They MUST NOT change — altering them would corrupt existing data without a migration.
//
// For i18n display, use BUSINESS_CATEGORY_TRANSLATION_KEYS to map each DB value
// to a translation key in the 'businessCategories' namespace.
// Example: t(BUSINESS_CATEGORY_TRANSLATION_KEYS["Barbería"]) → "Barbershop" (en)

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

// Maps DB value → translation key in messages/*.json 'businessCategories' namespace
export const BUSINESS_CATEGORY_TRANSLATION_KEYS: Record<BusinessCategory, string> = {
  "Barbería":              "barbershop",
  "Estética / Belleza":    "beautySalon",
  "Salón de belleza":      "hairSalon",
  "Clínica":               "clinic",
  "Consultorio médico":    "medicalOffice",
  "Spa":                   "spa",
  "Entrenador personal":   "personalTrainer",
  "Restaurante":           "restaurant",
  "Consultoría":           "consulting",
  "Salud / Medicina":      "healthMedicine",
  "Deportes / Gimnasio":   "sportsGym",
  "Tech":                  "tech",
  "Electrodomésticos":     "appliances",
  "Otros":                 "other",
}
