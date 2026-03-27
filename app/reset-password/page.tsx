'use client'

import { useState, useTransition, useEffect } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import Image from 'next/image'
import { resetPassword } from './actions'
import { resetPasswordSchema } from '@/lib/validations/auth'
import { PasswordInput } from '@/components/ui/password-input'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isVerifying, setIsVerifying] = useState(true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    async function checkSession() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        // En un flujo real de Supabase, el usuario es autenticado automáticamente al seguir el link de reset
        // Si no hay usuario, el link podría ser inválido o haber expirado
        setError('El enlace de recuperación es inválido o ha expirado.')
      }
      setIsVerifying(false)
    }
    checkSession()
  }, [supabase])

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    
    const formData = new FormData(e.currentTarget)
    const data = Object.fromEntries(formData.entries())
    
    const result = resetPasswordSchema.safeParse(data)
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? 'Contraseña inválida')
      return
    }
    
    startTransition(async () => {
      const res = await resetPassword(formData)
      if (res?.error) {
        setError(res.error)
      }
    })
  }

  if (isVerifying) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-6 sm:p-6" style={{ backgroundColor: "#060608" }}>
        <div className="animate-spin h-8 w-8 border-4 border-t-transparent rounded-full" style={{ borderColor: "#3884FF", borderTopColor: "transparent" }} />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-6 sm:p-6" style={{ backgroundColor: "#060608" }}>
      <div 
        className="w-full max-w-md p-8 sm:p-10 rounded-[2rem]"
        style={{
            background: "linear-gradient(180deg,#0A0A0F 0%,#0D0D14 100%)",
            border: "1px solid rgba(255,255,255,0.05)",
            boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
            position: "relative",
            overflow: "hidden"
        }}
      >
        {/* ambient orb */}
        <div
          style={{
            position: "absolute",
            top: "-15%",
            right: "-15%",
            width: "200px",
            height: "200px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle,rgba(56,132,255,0.1) 0%,transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div className="flex items-center gap-3 mb-8 justify-center relative z-10">
          <div 
            className="h-10 w-10 sm:h-12 sm:w-12 rounded-2xl overflow-hidden flex-shrink-0"
            style={{ 
              border: "1px solid rgba(56,132,255,0.25)",
              boxShadow: "0 0 20px rgba(56,132,255,0.2)"
            }}
          >
            <Image
              src="/cronix-logo.jpg"
              alt="Cronix Logo"
              width={48}
              height={48}
              className="h-full w-full object-cover"
              sizes="48px"
            />
          </div>
          <div className="relative h-7 w-28 sm:h-8 sm:w-32">
            <Image
              src="/cronix-letras.jpg"
              alt="Cronix"
              fill
              className="object-contain"
              sizes="128px"
            />
          </div>
        </div>

        <h1 className="text-2xl font-black text-center mb-2 text-white relative z-10" style={{ letterSpacing: "-0.035em" }}>
          Nueva contraseña
        </h1>
        <p className="text-center mb-8 text-sm relative z-10" style={{ color: "#6A6A7A" }}>
          Crea una contraseña segura para tu cuenta
        </p>

        <form onSubmit={handleSubmit} className="space-y-4 relative z-10">
          {error && (
            <div 
              className="p-3 text-xs rounded-lg flex items-center gap-2 font-medium"
              style={{
                  background: "rgba(255,59,48,0.08)",
                  border: "1px solid rgba(255,59,48,0.2)",
                  color: "#FF6B6B"
              }}
            >
              <AlertCircle size={14} />
              <p>{error}</p>
            </div>
          )}
          
          <div className="space-y-1.5">
            <label 
              className="block"
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "#4A4A5A",
                marginBottom: "8px",
              }}
            >
              Nueva contraseña
            </label>
            <PasswordInput name="password" placeholder="••••••••" required />
          </div>

          <div className="space-y-1.5">
            <label 
              className="block"
              style={{
                fontSize: "11px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "#4A4A5A",
                marginBottom: "8px",
              }}
            >
              Confirmar nueva contraseña
            </label>
            <PasswordInput name="confirmPassword" placeholder="••••••••" required />
          </div>

          <button 
            disabled={isPending || (!!error && error.includes('enlace'))} 
            type="submit" 
            className="w-full py-3 mt-4 flex items-center justify-center gap-2 font-semibold transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
            style={{
              borderRadius: "12px",
              background: "linear-gradient(135deg,#3884FF 0%,#1A5FDB 100%)",
              color: "#fff",
              fontSize: "14px",
              boxShadow: "0 0 24px rgba(56,132,255,0.35),0 4px 12px rgba(56,132,255,0.2)",
              border: "none",
            }}
          >
            {isPending ? 'Actualizando...' : 'Actualizar contraseña'}
          </button>
        </form>
      </div>
    </div>
  )
}
