'use client'

import { useFormState } from 'react-dom'
import { createBusiness } from './actions'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Store, ArrowRight, Scissors, Sparkles, AlertCircle } from 'lucide-react'

const CATEGORIES = [
  'Barbería',
  'Estética / Belleza',
  'Salón de belleza',
  'Clínica',
  'Consultorio médico',
  'Spa',
  'Entrenador personal',
  'Restaurante',
  'Consultoría',
  'Salud / Medicina',
  'Deportes / Gimnasio',
  'Otros',
]

export default function SetupPage() {
  const [state, formAction] = useFormState(createBusiness, null)

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="w-full max-w-lg animate-slide-up">
        <div className="text-center mb-10">
          <div className="inline-flex h-20 w-20 items-center justify-center rounded-3xl bg-brand-600 shadow-brand-lg mb-6 rotate-3 transition-transform hover:rotate-0 duration-500">
            <Scissors size={40} className="text-white rotate-45" />
          </div>
          <h1 className="text-4xl font-black text-foreground tracking-tight mb-3">
            ¡Bienvenido a Agendo!
          </h1>
          <p className="text-muted-foreground font-medium">
            Sencillez y elegancia para gestionar tu negocio.
          </p>
        </div>

        <Card className="p-10 border-t-8 border-t-brand-600 shadow-brand-lg rounded-[2.5rem] bg-card/50 backdrop-blur-sm">
          <form action={formAction} className="space-y-6">
            {state?.error && (
              <div className="p-4 bg-danger/10 text-danger text-sm font-bold rounded-2xl flex items-start gap-2 animate-fade-in border border-danger/20">
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <p>{state.error}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <Store size={16} className="text-brand-600" />
                  Nombre de tu negocio
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  placeholder="Ej. Barbería El Elegante"
                  className="input-base text-lg py-6 focus:ring-brand-600"
                />
              </div>

              <div>
                <label htmlFor="category" className="block text-sm font-semibold text-foreground mb-2 flex items-center gap-2">
                  <Sparkles size={16} className="text-brand-600" />
                  Categoría o rubro
                </label>
                <select
                  id="category"
                  name="category"
                  required
                  className="input-base text-lg py-3 focus:ring-brand-600 appearance-none bg-surface"
                >
                  <option value="">Selecciona una opción</option>
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-4">
              <Button type="submit" className="w-full py-6 text-lg group">
                Crear mi cuenta de negocio
                <ArrowRight size={20} className="ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          </form>
        </Card>

        <p className="text-center text-xs text-muted-foreground mt-8 px-8">
          Al crear tu negocio, aceptas nuestros términos de servicio y políticas de privacidad.
        </p>
      </div>
    </div>
  )
}