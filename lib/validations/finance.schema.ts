import { z } from 'zod'

export const CreateTransactionSchema = z.object({
  business_id:    z.string().uuid(),
  appointment_id: z.string().uuid().optional(),
  amount:        z.number().positive('El monto debe ser mayor a 0'),
  discount:      z.number().min(0).max(100).default(0),
  tip:           z.number().min(0).default(0),
  method:        z.enum(['cash', 'card', 'transfer', 'qr', 'other']).default('cash'),
  notes:         z.string().max(200).optional(),
})

export const CreateExpenseSchema = z.object({
  business_id:  z.string().uuid(),
  category:    z.enum(['supplies', 'rent', 'utilities', 'payroll', 'marketing', 'equipment', 'other']),
  amount:      z.number().positive('El monto debe ser mayor a 0'),
  description: z.string().max(200).optional(),
  expense_date: z.coerce.date(),
})

export type CreateTransactionInput = z.infer<typeof CreateTransactionSchema>
export type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>
