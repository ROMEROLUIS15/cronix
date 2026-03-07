import { z } from 'zod'

export const AppointmentStatusSchema = z.enum([
  'pending', 'confirmed', 'completed', 'cancelled', 'no_show',
])

export const CreateAppointmentSchema = z.object({
  business_id:     z.string().uuid('ID de negocio inválido'),
  client_id:       z.string().uuid('Debes seleccionar un cliente'),
  service_id:      z.string().uuid('Debes seleccionar un servicio'),
  assigned_user_id: z.string().uuid().optional(),
  start_at:        z.coerce.date(),
  end_at:          z.coerce.date(),
  notes:          z.string().max(500).optional(),
  confirmDouble:  z.boolean().default(false),
}).refine(
  (d) => d.end_at > d.start_at,
  { message: 'La hora de fin debe ser posterior al inicio', path: ['end_at'] }
)

export const UpdateAppointmentSchema = z.object({
  status:       AppointmentStatusSchema.optional(),
  notes:        z.string().max(500).optional(),
  cancel_reason: z.string().max(200).optional(),
  start_at:      z.coerce.date().optional(),
  end_at:        z.coerce.date().optional(),
  assigned_user_id: z.string().uuid().optional().nullable(),
})

export type CreateAppointmentInput = z.infer<typeof CreateAppointmentSchema>
export type UpdateAppointmentInput = z.infer<typeof UpdateAppointmentSchema>
