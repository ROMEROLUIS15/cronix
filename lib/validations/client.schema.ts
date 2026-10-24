import { z } from 'zod'

const ClientTagsSchema = z.array(z.string().min(1).max(30)).max(10, 'Máximo 10 etiquetas')

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
  tags:     ClientTagsSchema.default([]),
})

// Updates must not inherit create-time defaults: zod 4 applies .default() inside
// .partial(), so every update would carry tags: [] and wipe the client's tags.
export const UpdateClientSchema = CreateClientSchema
  .extend({ tags: ClientTagsSchema })
  .partial()
  .omit({ business_id: true })

export type CreateClientInput = z.infer<typeof CreateClientSchema>
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>
