'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import { createSaaSCheckoutSession } from './actions';
import { Loader2, CheckCircle2, Zap, Crown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export function PlanManager({ currentPlan }: { currentPlan: string | undefined | null }) {
  const t = useTranslations('settings.plan');
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState<'pro' | 'enterprise' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!isOpen) return;
    
    // Escuchar cambios en la tabla businesses para reaccionar al pago exitoso (webhook)
    const channel = supabase.channel('business-plan-updates')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'businesses' }, (payload) => {
        if (payload.new.plan !== currentPlan && payload.new.plan !== 'free') {
           window.location.reload(); // Recargar para mostrar el nuevo plan y acceso
        }
      })
      .subscribe();
      
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, currentPlan, supabase]);

  const handleUpgrade = async (plan: 'pro' | 'enterprise') => {
    setLoading(plan);
    setError(null);
    try {
      const res = await createSaaSCheckoutSession(plan);
      if (res.error) {
        setError(res.error);
        setLoading(null);
      } else if (res.invoice_url) {
        window.location.href = res.invoice_url;
      }
    } catch (e) {
      setError('Internal Error');
      setLoading(null);
    }
  };

  return (
    <>
      <Card style={{ border: "1px solid rgba(0,98,255,0.2)" }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: "#F2F2F2" }}>
              {t('current', { plan: currentPlan ?? "free" })}
            </p>
            <p className="text-xs" style={{ color: "#909098" }}>
              {t('fullAccess')}
            </p>
          </div>
          <Button variant="secondary" className="w-full sm:w-auto flex-shrink-0" onClick={() => setIsOpen(true)}>
            {t('managePlan')}
          </Button>
        </div>
      </Card>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-200">
          <div className="bg-[#1C1C21] border border-[#2E2E33] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-[#2E2E33] flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-white">Actualizar Plan (Cripto)</h2>
                <p className="text-xs text-[#909098]">Selecciona el plan para tu negocio. Pagos globales vía NOWPayments.</p>
              </div>
              <button onClick={() => setIsOpen(false)} className="text-[#909098] hover:text-white text-2xl leading-none">&times;</button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-sm">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* PRO PLAN */}
                <div className="border border-[#2E2E33] rounded-xl p-5 flex flex-col relative overflow-hidden bg-[#212125]">
                  <div className="absolute top-0 right-0 p-3">
                    <Zap size={20} className="text-[#0062FF]" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-1">Pro</h3>
                  <div className="flex items-baseline gap-1 mb-4">
                    <span className="text-2xl font-black text-white">$6</span>
                    <span className="text-xs text-[#909098]">/ mes</span>
                  </div>
                  <ul className="space-y-2 mb-6 flex-1 text-sm text-[#F2F2F2]">
                    <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#30D158]" /> Hasta 10 Miembros</li>
                    <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#30D158]" /> Módulo de Finanzas</li>
                    <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#30D158]" /> Reportes Avanzados</li>
                  </ul>
                  <Button 
                    className="w-full bg-[#0062FF] hover:bg-[#0050CC] text-white" 
                    onClick={() => handleUpgrade('pro')}
                    disabled={loading !== null}
                  >
                    {loading === 'pro' ? <Loader2 size={16} className="animate-spin" /> : 'Pagar $6 en Cripto'}
                  </Button>
                </div>

                {/* ELITE PLAN */}
                <div className="border border-[#A855F7]/30 rounded-xl p-5 flex flex-col relative overflow-hidden" style={{ background: 'linear-gradient(180deg, rgba(168,85,247,0.1) 0%, rgba(33,33,37,1) 100%)' }}>
                  <div className="absolute top-0 right-0 p-3">
                    <Crown size={20} className="text-[#A855F7]" />
                  </div>
                  <h3 className="text-xl font-bold text-white mb-1">Elite</h3>
                  <div className="flex items-baseline gap-1 mb-4">
                    <span className="text-2xl font-black text-white">$10</span>
                    <span className="text-xs text-[#909098]">/ mes</span>
                  </div>
                  <ul className="space-y-2 mb-6 flex-1 text-sm text-[#F2F2F2]">
                    <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#30D158]" /> Miembros Ilimitados</li>
                    <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#30D158]" /> Múltiples Sucursales</li>
                    <li className="flex items-center gap-2"><CheckCircle2 size={14} className="text-[#30D158]" /> Asistente IA Dedicado</li>
                  </ul>
                  <Button 
                    className="w-full" 
                    style={{ background: '#A855F7', color: 'white' }}
                    onClick={() => handleUpgrade('enterprise')}
                    disabled={loading !== null}
                  >
                    {loading === 'enterprise' ? <Loader2 size={16} className="animate-spin" /> : 'Pagar $10 en Cripto'}
                  </Button>
                </div>
              </div>
              <p className="text-xs text-center text-[#909098]">
                Al hacer clic en pagar, serás redirigido a NOWPayments para realizar el pago de forma segura usando Binance o tu wallet preferida. La activación del plan puede tomar 1-3 minutos tras el envío.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
