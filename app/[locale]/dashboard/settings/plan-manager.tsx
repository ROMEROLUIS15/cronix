'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import { createSaaSCheckoutSession } from './actions';
import { Loader2, Zap, Crown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

export function PlanManager({
  currentPlan,
  businessId,
}: {
  currentPlan: string | undefined | null;
  businessId?: string;
}) {
  const t = useTranslations('settings.plan');
  const [isOpen, setIsOpen]   = useState(false);
  const [loading, setLoading] = useState<'pro' | 'enterprise' | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!isOpen || !businessId) return;

    const channel = supabase.channel('business-plan-updates')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'businesses', filter: `id=eq.${businessId}` },
        (payload) => {
          if (payload.new.plan !== currentPlan && payload.new.plan !== 'free') {
            window.location.reload();
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isOpen, currentPlan, businessId, supabase]);

  const handleUpgrade = async (plan: 'pro' | 'enterprise') => {
    setLoading(plan);
    setError(null);
    try {
      const res = await createSaaSCheckoutSession(plan);
      if (res.error) {
        setError(res.error);
        setLoading(null);
      } else if (res.invoice_url) {
        window.open(res.invoice_url, '_blank', 'noopener,noreferrer');
        setLoading(null);
      }
    } catch {
      setError(t('errorInternal'));
      setLoading(null);
    }
  };

  // ── Table rows (computed outside JSX so t() calls are plain function calls) ──
  const rows = [
    { label: t('tableClients'),     free: t('tableUpTo20'),      pro: t('tableUnlimited'),      ent: t('tableUnlimited') },
    { label: t('tableEmployees'),   free: t('tableOwnerOnly'),   pro: t('tableUpTo3'),           ent: t('tableUnlimited') },
    { label: t('tableAppts'),       free: t('tableUpTo30'),      pro: t('tableUnlimitedAppts'),  ent: t('tableUnlimitedAppts') },
    { label: t('tableAiAssistant'), free: '✓',                   pro: '✓',                       ent: '✓' },
    { label: t('tableCalendar'),    free: '✓',                   pro: '✓',                       ent: '✓' },
    { label: t('tableFinance'),     free: '✓',                   pro: '✓',                       ent: '✓' },
    { label: t('tableReports'),     free: '✓',                   pro: '✓',                       ent: '✓' },
    { label: t('tableWhatsapp'),    free: '✓',                   pro: '✓',                       ent: '✓' },
    { label: t('tableBranches'),    free: '—',                   pro: '—',                       ent: t('tableComingSoon') },
  ];

  return (
    <>
      <Card style={{ border: '1px solid rgba(0,98,255,0.2)' }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: '#F2F2F2' }}>
              {t('current', { plan: currentPlan ?? 'free' })}
            </p>
            <p className="text-xs" style={{ color: '#909098' }}>
              {t('fullAccess')}
            </p>
          </div>
          <Button variant="secondary" className="w-full sm:w-auto flex-shrink-0" onClick={() => setIsOpen(true)}>
            {t('managePlan')}
          </Button>
        </div>
      </Card>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 animate-in fade-in duration-200"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="bg-[#1C1C21] border border-[#2E2E33] rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-5 border-b border-[#2E2E33] flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-white">{t('modalTitle')}</h2>
                <p className="text-xs text-[#909098]">
                  {t('currentPlanLabel')}{' '}
                  <span className="font-semibold text-white capitalize">{currentPlan ?? 'free'}</span>
                  {currentPlan === 'free' && (
                    <span className="text-amber-400"> · {t('freeLimitNote')}</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-[#909098] hover:text-white text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-sm">
                  {error}
                </div>
              )}

              {/* Plan comparison table */}
              <div className="overflow-x-auto rounded-xl border border-[#2E2E33]">
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="bg-[#16161A] text-xs font-semibold uppercase tracking-wider">
                      <th className="p-3 text-left text-[#909098]">{t('tableFeature')}</th>
                      <th className="p-3 text-center text-[#909098]">Free</th>
                      <th className="p-3 text-center text-[#0062FF]">Pro</th>
                      <th className="p-3 text-center text-[#A855F7]">Enterprise</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-t border-[#2E2E33] ${i % 2 === 0 ? 'bg-[#1C1C21]' : 'bg-[#191919]'}`}
                      >
                        <td className="p-3 text-[#F2F2F2]">{row.label}</td>
                        <td className="p-3 text-center text-[#909098]">{row.free}</td>
                        <td className="p-3 text-center text-[#F2F2F2]">{row.pro}</td>
                        <td className="p-3 text-center text-[#F2F2F2]">{row.ent}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[#2E2E33] bg-[#16161A] font-semibold">
                      <td className="p-3 text-[#909098]">{t('tablePricePerMonth')}</td>
                      <td className="p-3 text-center text-[#909098]">$0</td>
                      <td className="p-3 text-center text-[#0062FF]">$6 USDT</td>
                      <td className="p-3 text-center text-[#A855F7]">$10 USDT</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* CTA buttons */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  className="w-full bg-[#0062FF] hover:bg-[#0050CC] text-white"
                  onClick={() => handleUpgrade('pro')}
                  disabled={loading !== null || currentPlan === 'pro' || currentPlan === 'enterprise'}
                >
                  {loading === 'pro' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : currentPlan === 'pro' ? (
                    <><Zap size={14} className="mr-1.5" />{t('proActive')}</>
                  ) : (
                    <><Zap size={14} className="mr-1.5" />{t('activatePro')}</>
                  )}
                </Button>
                <Button
                  className="w-full"
                  style={{ background: currentPlan === 'enterprise' ? '#6b21a8' : '#A855F7', color: 'white' }}
                  onClick={() => handleUpgrade('enterprise')}
                  disabled={loading !== null || currentPlan === 'enterprise'}
                >
                  {loading === 'enterprise' ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : currentPlan === 'enterprise' ? (
                    <><Crown size={14} className="mr-1.5" />{t('enterpriseActive')}</>
                  ) : (
                    <><Crown size={14} className="mr-1.5" />{t('activateEnterprise')}</>
                  )}
                </Button>
              </div>

              <p className="text-xs text-center text-[#606068]">
                {t('paymentNote')}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
