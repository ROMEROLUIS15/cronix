import { z } from 'zod'
import { BUSINESS_CATEGORIES } from '@/lib/constants/business'

// ── Schema factories ──────────────────────────────────────────────────────────
// Each factory accepts translated error messages so validation errors are
// displayed in the active locale. Call with `useMemo(() => createXSchema(t), [t])`.
//
// Zod validation runs server-side (locale-agnostic) for server actions.
// For client-side display, pass t() from useTranslations('validation').

export type ValidationMessages = {
  passwordMin: string
  passwordUppercase: string
  passwordLowercase: string
  passwordNumber: string
  passwordSpecial: string
  passwordRequired: string
  emailInvalid: string
  firstNameShort: string
  lastNameShort: string
  bizNameShort: string
  selectBizCategory: string
  passwordsMismatch: string
}

function buildPasswordSchema(msgs: ValidationMessages) {
  return z
    .string()
    .min(8, msgs.passwordMin)
    .regex(/[A-Z]/, msgs.passwordUppercase)
    .regex(/[a-z]/, msgs.passwordLowercase)
    .regex(/[0-9]/, msgs.passwordNumber)
    .regex(/[^A-Za-z0-9]/, msgs.passwordSpecial)
}

export function createLoginSchema(msgs: Pick<ValidationMessages, 'emailInvalid' | 'passwordRequired'>) {
  return z.object({
    email:    z.string().email(msgs.emailInvalid),
    password: z.string().min(1, msgs.passwordRequired),
  })
}

export function createRegisterSchema(msgs: ValidationMessages) {
  return z.object({
    firstName:       z.string().min(2, msgs.firstNameShort),
    lastName:        z.string().min(2, msgs.lastNameShort),
    bizName:         z.string().min(2, msgs.bizNameShort),
    bizCategory:     z.enum(BUSINESS_CATEGORIES, { errorMap: () => ({ message: msgs.selectBizCategory }) }),
    email:           z.string().email(msgs.emailInvalid),
    password:        buildPasswordSchema(msgs),
    confirmPassword: z.string(),
  }).refine(data => data.password === data.confirmPassword, {
    message: msgs.passwordsMismatch,
    path: ['confirmPassword'],
  })
}

export function createForgotPasswordSchema(msgs: Pick<ValidationMessages, 'emailInvalid'>) {
  return z.object({
    email: z.string().email(msgs.emailInvalid),
  })
}

export function createResetPasswordSchema(msgs: Pick<ValidationMessages, 'passwordsMismatch'> & ValidationMessages) {
  return z.object({
    password:        buildPasswordSchema(msgs),
    confirmPassword: z.string(),
  }).refine(data => data.password === data.confirmPassword, {
    message: msgs.passwordsMismatch,
    path: ['confirmPassword'],
  })
}

// ── Static schemas (server actions / non-locale contexts) ─────────────────────
// Used in server actions where no t() is available.
// Errors are caught server-side and returned as generic error codes.

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .regex(/[A-Z]/, 'Debe contener al menos una letra mayúscula')
  .regex(/[a-z]/, 'Debe contener al menos una letra minúscula')
  .regex(/[0-9]/, 'Debe contener al menos un número')
  .regex(/[^A-Za-z0-9]/, 'Debe contener al menos un carácter especial')

export const loginSchema = z.object({
  email:    z.string().email('Email inválido'),
  password: z.string().min(1, 'La contraseña es requerida'),
})

export const registerSchema = z.object({
  firstName:       z.string().min(2, 'El nombre es muy corto'),
  lastName:        z.string().min(2, 'El apellido es muy corto'),
  bizName:         z.string().min(2, 'El nombre del negocio es muy corto'),
  bizCategory:     z.enum(BUSINESS_CATEGORIES, { errorMap: () => ({ message: 'Selecciona un tipo de negocio' }) }),
  email:           z.string().email('Email inválido'),
  password:        passwordSchema,
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Las contraseñas no coinciden',
  path: ['confirmPassword'],
})

export const forgotPasswordSchema = z.object({
  email: z.string().email('Email inválido'),
})

export const resetPasswordSchema = z.object({
  password:        passwordSchema,
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Las contraseñas no coinciden',
  path: ['confirmPassword'],
})
