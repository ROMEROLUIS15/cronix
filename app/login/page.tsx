'use client'

import Link from 'next/link'
import { Scissors, AlertCircle } from 'lucide-react'
import { useState, useTransition } from 'react'
import { login } from './actions'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    
    startTransition(async () => {
      const res = await login(formData)
      if (res?.error) {
        setError(res.error)
      }
    })
  }
  return (
    <div className="min-h-screen flex">
      {/* Left: Brand panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-brand-600 relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute -top-24 -right-24 h-96 w-96 rounded-full bg-brand-500/40" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-brand-700/40" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-48 w-48 rounded-full bg-brand-500/20 blur-3xl" />

        <div className="relative z-10 flex flex-col justify-center px-16 py-12 text-white">
          <div className="flex items-center gap-3 mb-10">
            <div className="h-12 w-12 rounded-2xl bg-white/20 flex items-center justify-center">
              <Scissors size={24} className="rotate-45" />
            </div>
            <span className="text-2xl font-bold">Agendo</span>
          </div>

          <h2 className="text-4xl font-bold leading-tight mb-4">
            Tu negocio en control,<br />
            tus clientes en orden.
          </h2>
          <p className="text-brand-100 text-lg leading-relaxed mb-10">
            Gestiona citas, clientes y finanzas desde un panel moderno y accesible desde cualquier dispositivo.
          </p>

          <div className="space-y-4">
            {[
              { icon: '📅', title: 'Doble Agenda', desc: 'Múltiples citas por cliente en el mismo día' },
              { icon: '💬', title: 'Recordatorios', desc: 'WhatsApp y Email automáticos' },
              { icon: '📊', title: 'Reportes PDF', desc: 'Balance financiero con un clic' },
            ].map((feat) => (
              <div key={feat.title} className="flex items-start gap-3">
                <span className="text-2xl">{feat.icon}</span>
                <div>
                  <p className="font-semibold">{feat.title}</p>
                  <p className="text-sm text-brand-100">{feat.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-background">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="h-9 w-9 rounded-xl bg-brand-600 flex items-center justify-center">
              <Scissors size={18} className="text-white rotate-45" />
            </div>
            <span className="text-xl font-bold text-foreground">Agendo</span>
          </div>

          <h1 className="text-3xl font-bold text-foreground mb-2">Bienvenido de nuevo</h1>
          <p className="text-muted-foreground mb-8">Inicia sesión para gestionar tu negocio</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="p-3 bg-red-50 text-red-600 text-sm rounded-xl flex items-start gap-2 animate-fade-in border border-red-100">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <p>{error}</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="hola@tuempresa.com"
                defaultValue="demo@agendo.app"
                className="input-base"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5" htmlFor="password">
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                defaultValue="demo1234"
                className="input-base"
              />
              <div className="text-right mt-1.5">
                <a href="#" className="text-xs text-brand-600 hover:underline">
                  ¿Olvidaste tu contraseña?
                </a>
              </div>
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="btn-primary w-full py-3 text-base rounded-2xl flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Iniciando sesión...</span>
                </>
              ) : (
                'Iniciar sesión'
              )}
            </button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs text-muted-foreground">
                <span className="bg-background px-3">o continúa con</span>
              </div>
            </div>

            <button
              type="button"
              className="btn-secondary w-full py-3 rounded-2xl gap-2"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Ingresar con Google
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-8">
            ¿No tienes cuenta?{' '}
            <Link href="/register" className="text-brand-600 font-medium hover:underline">
              Regístrate gratis
            </Link>
          </p>

          <p className="text-center text-xs text-muted-foreground mt-6 p-3 rounded-xl bg-brand-50 dark:bg-brand-900/20">
            🎉 <strong className="text-foreground">Demo:</strong> usa <code className="text-brand-600">demo@agendo.app</code> — haz clic en &quot;Iniciar sesión&quot;
          </p>
        </div>
      </div>
    </div>
  )
}
