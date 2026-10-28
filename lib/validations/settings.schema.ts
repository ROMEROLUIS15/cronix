import { z } from 'zod'
import { PRICE_CURRENCIES } from '@/lib/constants/business'

/**
 * Schema for the JSON `settings` column in `businesses` table.
 * Eliminates `as any` casts when reading/writing business settings.
 */
export const BusinessSettingsSchema = z.object({
  workingHours: z.record(
    z.string(),
    z.union([
      z.tuple([z.string(), z.string()]),
      z.null(),
    ])
  ).optional(),
  // True once the owner explicitly set their schedule (setup form or Settings save).
  // Absent/false = system default seeded at signup → dashboard nudges them to confirm.
  workingHoursConfirmed: z.boolean().optional(),
  // Currency of the services' prices (ISO 4217); absent = USD.
  currency: z.enum(PRICE_CURRENCIES).optional(),
  notifications: z.object({
    whatsapp:       z.boolean().default(false),
    email:          z.boolean().default(false),
    reminderHours:  z.array(z.number()).optional(),  // legacy — no longer editable in UI
  }).optional(),
  // No .default(2): zod 4 applies defaults inside .optional(), which would inject
  // the field into every parsed settings object (zod 3 never applied it here).
  maxDailyBookingsPerClient: z.number().int().positive().optional(),
})

export type BusinessSettingsInput = z.infer<typeof BusinessSettingsSchema>

/**
 * Schema for updating business profile (name, category, phone, address).
 */
export const UpdateBusinessProfileSchema = z.object({
  name:     z.string().min(1, 'El nombre es obligatorio').max(100),
  category: z.string().min(1, 'La categoría es requerida'),
  phone:    z.string().nullable().optional(),
  address:  z.string().max(200).nullable().optional(),
})

export type UpdateBusinessProfileInput = z.infer<typeof UpdateBusinessProfileSchema>
