'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Wrench, X, ArrowRight, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

export function ServicesOnboardingBanner({ businessId }: { businessId: string }) {
  const [show, setShow] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    if (!businessId) return
    // Solo mostrar si no han cerrado el banner antes
    const dismissed = localStorage.getItem(`services-banner-${businessId}`)
    if (dismissed) return

    async function checkServices() {
      const { count } = await supabase
        .from('services')
        .select('id', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .eq('is_active', true)
      if ((count ?? 0) === 0) setShow(true)
    }
    checkServices()
  }, [businessId])

  const dismiss = () => {
    localStorage.setItem(`services-banner-${businessId}`, '1')
    setShow(false)
  }

  if (!show) return null

  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-r from-brand-50 to-indigo-50 dark:from-brand-900/20 dark:to-indigo-900/20 dark:border-brand-800/30 p-5">
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-xl bg-brand-600 flex items-center justify-center shrink-0">
          <Wrench size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-bold text-foreground">Configura tus servicios</h3>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-brand-600 bg-brand-100 px-2 py-0.5 rounded-full">
              <Sparkles size={10} /> Recomendado
            </span>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Aún no tienes servicios configurados. Agrégalos para poder crear citas más rápido y llevar un control de precios y tiempos.
          </p>
          <div className="flex items-center gap-3">
            <Link href="/dashboard/services"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 px-4 py-2 rounded-xl transition-colors">
              Agregar servicios <ArrowRight size={13} />
            </Link>
            <button onClick={dismiss} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Lo haré después
            </button>
          </div>
        </div>
        <button onClick={dismiss}
          className="shrink-0 p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-black/5 transition-colors">
          <X size={16} />
        </button>
      </div>
    </div>
  )
}