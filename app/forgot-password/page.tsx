'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { AlertCircle, CheckCircle2, ArrowLeft } from 'lucide-react'
import { forgotPassword } from './actions'
import { forgotPasswordSchema } from '@/lib/validations/auth'
import { cn } from '@/lib/utils'

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    
    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    
    const result = forgotPasswordSchema.safeParse({ email })
    if (!result.success) {
      setError(result.error?.errors?.[0]?.message || 'Email inválido')
      return
    }
    
    startTransition(async () => {
      const res = await forgotPassword(formData)
      if (res?.error) {
        setError(res.error)
      } else if (res?.success) {
        setSuccess(res.success)
      }
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: "#060608" }}>
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
              unoptimized
            />
          </div>
          <div className="relative h-7 w-28 sm:h-8 sm:w-32">
            <Image
              src="/cronix-letras.jpg"
              alt="Cronix"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
        </div>

        <h1 className="text-2xl font-black text-center mb-2 text-white relative z-10" style={{ letterSpacing: "-0.035em" }}>
          Recuperar contraseña
        </h1>
        <p className="text-center mb-8 text-sm relative z-10" style={{ color: "#6A6A7A" }}>
          Ingresa tu correo y te enviaremos un enlace para restablecer tu cuenta
        </p>

        {success ? (
          <div className="space-y-6 relative z-10">
            <div 
              className="p-5 rounded-xl flex flex-col items-center gap-3 text-center" 
              style={{
                  background: "rgba(48,209,88,0.1)",
                  border: "1px solid rgba(48,209,88,0.2)"
              }}
            >
              <CheckCircle2 size={32} style={{ color: "#30D158" }} />
              <p className="text-sm font-medium text-white">{success}</p>
            </div>
            <Link 
              href="/login" 
              className="w-full py-3 flex items-center justify-center gap-2 font-medium rounded-xl transition-all hover:bg-white/5"
              style={{
                  color: "#D0D0DC",
                  border: "1px solid #22222E",
                  background: "#13131A"
              }}
            >
              <ArrowLeft size={16} />
              Volver al inicio de sesión
            </Link>
          </div>
        ) : (
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
                Correo electrónico
              </label>
              <input 
                name="email" 
                type="email" 
                placeholder="tu@email.com" 
                className="w-full transition-colors"
                style={{
                  background: "#13131A",
                  border: "1px solid #22222E",
                  color: "#F2F2F2",
                  borderRadius: "10px",
                  padding: "0.75rem 1rem",
                  fontSize: "14px",
                  outline: "none",
                }}
                required 
              />
            </div>

            <button 
              disabled={isPending} 
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
              {isPending ? 'Enviando...' : 'Enviar enlace de recuperación'}
            </button>

            <Link 
              href="/login" 
              className="flex items-center justify-center gap-2 text-sm font-medium pt-2 transition-opacity hover:opacity-70"
              style={{ color: "#3884FF" }}
            >
              <ArrowLeft size={16} />
              Volver al inicio de sesión
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}
