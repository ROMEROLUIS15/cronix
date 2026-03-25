import { z } from 'zod'

export const CreateClientSchema = z.object({
  business_id: z.string().uuid(),
  name:       z.string().min(2, 'El nombre es muy corto').max(100),
  phone:      z
    .string()
    .regex(/^\+?[1-9]\d{7,14}$/, 'Número inválido')
    .optional()
    .or(z.literal('')),
  email:    z.string().email('Email inválido').nullable().optional().or(z.literal('')),
  notes:    z.string().max(1000).optional(),
  tags:     z.array(z.string().min(1).max(30)).max(10, 'Máximo 10 etiquetas').default([]),
})

export const UpdateClientSchema = CreateClientSchema.partial().omit({ business_id: true })

export type CreateClientInput = z.infer<typeof CreateClientSchema>
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>
