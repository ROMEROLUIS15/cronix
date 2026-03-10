'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Scissors, AlertCircle, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { register } from './actions'
import { PasswordInput } from '@/components/ui/password-input'
import { registerSchema } from '@/lib/validations/auth'

export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setValidationErrors({})
    const formData = new FormData(e.currentTarget)
    const data = Object.fromEntries(formData.entries())
    const result = registerSchema.safeParse(data)
    if (!result.success) {
      const errors: Record<string, string> = {}
      result.error.issues.forEach((issue) => {
        if (issue.path[0]) errors[issue.path[0].toString()] = issue.message
      })
      setValidationErrors(errors)
      return
    }
    startTransition(async () => {
      const res = await register(formData)
      if (res?.error) setError(res.error)
      else if (res?.success) setSuccess(res.success)
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-6">
      <div className="w-full max-w-md card-base p-8">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center text-white">
            <Scissors size={20} className="rotate-45" />
          </div>
          <span className="text-2xl font-bold text-foreground">Agendo</span>
        </div>

        <h1 className="text-2xl font-bold text-center mb-2">Crea tu cuenta</h1>
        <p className="text-muted-foreground text-center mb-8 text-sm">
          Empieza a gestionar tu negocio hoy mismo
        </p>

        {success ? (
          <div className="text-center py-6">
            <CheckCircle2 size={48} className="text-green-500 mx-auto mb-4" />
            <h2 className="text-lg font-bold text-foreground mb-2">¡Cuenta creada!</h2>
            <p className="text-sm text-muted-foreground mb-6">{success}</p>
            <Link href="/login" className="btn-primary inline-flex px-6 py-2.5 rounded-xl text-sm">
              Ir a iniciar sesión
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-50 text-red-600 text-xs rounded-lg flex items-center gap-2 border border-red-100">
                <AlertCircle size={14} />
                <p>{error}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <input name="firstName" placeholder="Nombre"
                  className={cn('input-base', validationErrors.firstName && 'border-red-500')} required />
                {validationErrors.firstName && (
                  <p className="text-[10px] text-red-500">{validationErrors.firstName}</p>
                )}
              </div>
              <div className="space-y-1">
                <input name="lastName" placeholder="Apellido"
                  className={cn('input-base', validationErrors.lastName && 'border-red-500')} required />
                {validationErrors.lastName && (
                  <p className="text-[10px] text-red-500">{validationErrors.lastName}</p>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <input name="bizName" placeholder="Nombre del Negocio"
                className={cn('input-base', validationErrors.bizName && 'border-red-500')} required />
              {validationErrors.bizName && (
                <p className="text-[10px] text-red-500">{validationErrors.bizName}</p>
              )}
            </div>

            <div className="space-y-1">
              <input name="email" type="email" placeholder="Email"
                className={cn('input-base', validationErrors.email && 'border-red-500')} required />
              {validationErrors.email && (
                <p className="text-[10px] text-red-500">{validationErrors.email}</p>
              )}
            </div>

            <div className="space-y-1">
              <PasswordInput name="password" placeholder="Contraseña"
                className={validationErrors.password ? 'border-red-500' : undefined} required />
              {validationErrors.password && (
                <p className="text-[10px] text-red-500">{validationErrors.password}</p>
              )}
            </div>

            <div className="space-y-1">
              <PasswordInput name="confirmPassword" placeholder="Confirmar Contraseña"
                className={validationErrors.confirmPassword ? 'border-red-500' : undefined} required />
              {validationErrors.confirmPassword && (
                <p className="text-[10px] text-red-500">{validationErrors.confirmPassword}</p>
              )}
            </div>

            <button disabled={isPending} type="submit" className="btn-primary w-full py-3 mt-4">
              {isPending ? 'Procesando...' : 'Crear cuenta gratis'}
            </button>
          </form>
        )}

        <p className="text-center mt-6 text-sm text-muted-foreground">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-brand-600 font-semibold">Inicia sesión</Link>
        </p>
      </div>
    </div>
  )
}