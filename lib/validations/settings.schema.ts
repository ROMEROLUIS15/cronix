import { z } from 'zod'

/**
 * Schema for the JSON `settings` column in `businesses` table.
 * Eliminates `as any` casts when reading/writing business settings.
 */
export const BusinessSettingsSchema = z.object({
  workingHours: z.record(
    z.union([
      z.tuple([z.string(), z.string()]),
      z.null(),
    ])
  ).optional(),
  notifications: z.object({
    whatsapp:       z.boolean().default(false),
    email:          z.boolean().default(false),
    reminderHours:  z.array(z.number()).optional(),  // legacy — no longer editable in UI
  }).optional(),
  maxDailyBookingsPerClient: z.number().int().positive().default(2).optional(),
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
