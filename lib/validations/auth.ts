import { z } from 'zod'
import { BUSINESS_CATEGORIES } from '@/lib/constants/business'

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .regex(/[A-Z]/, 'Debe contener al menos una letra mayúscula')
  .regex(/[a-z]/, 'Debe contener al menos una letra minúscula')
  .regex(/[0-9]/, 'Debe contener al menos un número')
  .regex(/[^A-Za-z0-0]/, 'Debe contener al menos un carácter especial')

export const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es requerida'),
})

export const registerSchema = z.object({
  firstName:   z.string().min(2, 'El nombre es muy corto'),
  lastName:    z.string().min(2, 'El apellido es muy corto'),
  bizName:     z.string().min(2, 'El nombre del negocio es muy corto'),
  bizCategory: z.enum(BUSINESS_CATEGORIES, { errorMap: () => ({ message: 'Selecciona un tipo de negocio' }) }),
  email:       z.string().email('Email inválido'),
  password:    passwordSchema,
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Las contraseñas no coinciden",
  path: ["confirmPassword"],
})

export const forgotPasswordSchema = z.object({
  email: z.string().email('Email inválido'),
})

export const resetPasswordSchema = z.object({
  password: passwordSchema,
  confirmPassword: z.string()
}).refine((data) => data.password === data.confirmPassword, {
  message: "Las contraseñas no coinciden",
  path: ["confirmPassword"],
})
