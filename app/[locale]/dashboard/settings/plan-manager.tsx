'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTranslations } from 'next-intl';
import { createSaaSCheckoutSession } from './actions';
import { Loader2, Zap, Crown, Check, X } from 'lucide-react';
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

  // ── Feature rows for comparison ──
  const rows = [
    { label: t('tableClients'),     free: t('tableUpTo20'),      pro: t('tableUnlimited'),      ent: t('tableUnlimited') },
    { label: t('tableEmployees'),   free: t('tableOwnerOnly'),   pro: t('tableUpTo2'),           ent: t('tableUnlimited') },
    { label: t('tableAppts'),       free: t('tableUpTo30'),      pro: t('tableUpTo150'),         ent: t('tableUnlimitedAppts') },
    { label: t('tableAiAssistant'), free: true,                  pro: true,                      ent: true },
    { label: t('tableCalendar'),    free: true,                  pro: true,                      ent: true },
    { label: t('tableFinance'),     free: true,                  pro: true,                      ent: true },
    { label: t('tableReports'),     free: true,                  pro: true,                      ent: true },
    { label: t('tableWhatsapp'),    free: true,                  pro: true,                      ent: true },
    { label: t('tableBranches'),    free: false,                 pro: false,                     ent: t('tableComingSoon') },
  ];

  // Helper to render table cell values
  const renderCell = (val: string | boolean) => {
    if (val === true)  return <Check size={15} className="mx-auto text-emerald-400" />;
    if (val === false) return <X size={15} className="mx-auto text-[#4A4A50]" />;
    return <span>{val}</span>;
  };

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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/70 animate-in fade-in duration-200"
          onClick={() => setIsOpen(false)}
        >
          {/* Modal panel — bottom-sheet on mobile, centered on sm+ */}
          <div
            className="bg-[#1C1C21] border border-[#2E2E33] rounded-t-3xl sm:rounded-2xl w-full sm:max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[90vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drag handle (mobile only) */}
            <div className="sm:hidden flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-[#3E3E44]" />
            </div>

            {/* Header */}
            <div className="px-4 sm:px-5 py-3 sm:py-4 border-b border-[#2E2E33] flex justify-between items-start gap-3">
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-bold text-white leading-tight">{t('modalTitle')}</h2>
                <p className="text-xs text-[#909098] mt-0.5 leading-snug">
                  {t('currentPlanLabel')}{' '}
                  <span className="font-semibold text-white capitalize">{currentPlan ?? 'free'}</span>
                  {currentPlan === 'free' && (
                    <span className="text-amber-400"> · {t('freeLimitNote')}</span>
                  )}
                </p>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-[#909098] hover:text-white text-2xl leading-none flex-shrink-0 mt-0.5"
                aria-label="Close"
              >
                &times;
              </button>
            </div>

            {/* Scrollable body */}
            <div className="px-4 sm:px-6 py-4 sm:py-5 overflow-y-auto space-y-4 sm:space-y-6">
              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-sm">
                  {error}
                </div>
              )}

              {/* ── Mobile: stacked plan cards ── */}
              <div className="sm:hidden space-y-3">
                {[
                  {
                    name: 'Free',
                    price: '$0',
                    color: '#909098',
                    bg: 'rgba(144,144,152,0.08)',
                    border: 'rgba(144,144,152,0.2)',
                    values: rows.map(r => ({ label: r.label, val: r.free })),
                  },
                  {
                    name: 'Pro',
                    price: '$10 USDT/mo',
                    color: '#0062FF',
                    bg: 'rgba(0,98,255,0.08)',
                    border: 'rgba(0,98,255,0.25)',
                    values: rows.map(r => ({ label: r.label, val: r.pro })),
                  },
                  {
                    name: 'Enterprise',
                    price: '$15 USDT/mo',
                    color: '#A855F7',
                    bg: 'rgba(168,85,247,0.08)',
                    border: 'rgba(168,85,247,0.25)',
                    values: rows.map(r => ({ label: r.label, val: r.ent })),
                  },
                ].map((plan) => (
                  <div
                    key={plan.name}
                    className="rounded-xl overflow-hidden"
                    style={{ background: plan.bg, border: `1px solid ${plan.border}` }}
                  >
                    {/* Plan header */}
                    <div className="flex items-center justify-between px-4 py-3">
                      <span className="text-sm font-bold" style={{ color: plan.color }}>{plan.name}</span>
                      <span className="text-xs font-semibold" style={{ color: plan.color }}>{plan.price}</span>
                    </div>
                    {/* Feature list */}
                    <div className="divide-y divide-[#2E2E33]">
                      {plan.values.map(({ label, val }) => (
                        <div key={label} className="flex items-center justify-between px-4 py-2.5 gap-3">
                          <span className="text-xs text-[#C0C0C8] flex-1 min-w-0">{label}</span>
                          <span className="text-xs font-medium flex-shrink-0" style={{ color: plan.color }}>
                            {val === true  ? <Check size={14} className="text-emerald-400" /> :
                             val === false ? <X size={14} className="text-[#4A4A50]" /> :
                             val}
                          </span>
                        </div>
                      ))}
                    </div>
                    {plan.name === 'Pro' && (
                      <div className="p-4 pt-2 border-t border-[#2E2E33]/50">
                        <Button
                          className="w-full bg-[#0062FF] hover:bg-[#0050CC] text-white h-11 text-xs font-semibold"
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
                      </div>
                    )}
                    {plan.name === 'Enterprise' && (
                      <div className="p-4 pt-2 border-t border-[#2E2E33]/50">
                        <Button
                          className="w-full h-11 text-xs font-semibold"
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
                    )}
                  </div>
                ))}
              </div>

              {/* ── Desktop: comparison table ── */}
              <div className="hidden sm:block overflow-x-auto rounded-xl border border-[#2E2E33]">
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
                        <td className="p-3 text-center text-[#909098]">{renderCell(row.free)}</td>
                        <td className="p-3 text-center text-[#F2F2F2]">{renderCell(row.pro)}</td>
                        <td className="p-3 text-center text-[#F2F2F2]">{renderCell(row.ent)}</td>
                      </tr>
                    ))}
                    <tr className="border-t border-[#2E2E33] bg-[#16161A] font-semibold">
                      <td className="p-3 text-[#909098]">{t('tablePricePerMonth')}</td>
                      <td className="p-3 text-center text-[#909098]">$0</td>
                      <td className="p-3 text-center text-[#0062FF]">$10 USDT</td>
                      <td className="p-3 text-center text-[#A855F7]">$15 USDT</td>
                    </tr>
                    <tr className="border-t border-[#2E2E33] bg-[#16161A]">
                      <td className="p-3"></td>
                      <td className="p-3 text-center"></td>
                      <td className="p-3 text-center">
                        <Button
                          className="w-full bg-[#0062FF] hover:bg-[#0050CC] text-white h-10 text-xs font-semibold"
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
                      </td>
                      <td className="p-3 text-center">
                        <Button
                          className="w-full h-10 text-xs font-semibold"
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
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-center text-[#606068] pb-1">
                {t('paymentNote')}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
