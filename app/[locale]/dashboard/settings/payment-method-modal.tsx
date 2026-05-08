'use client';

/**
 * payment-method-modal.tsx
 *
 * SRP  — UI pura. No contiene lógica de negocio.
 * DIP  — Depende de usePaymentFlow (hook) y payment-config (SSOT).
 * OCP  — Nuevos métodos: agregar solo en payment-config y use-payment-flow.
 * i18n — Traducciones en 6 idiomas via next-intl.
 */

import { useState, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2, X, Bitcoin, Smartphone, Copy, Check, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePaymentFlow }    from './use-payment-flow';
import {
  PLAN_CONFIG,
  PAGO_MOVIL_CONFIG,
  BINANCE_CONFIG,
  type Plan,
  type AnyPaymentMethod,
} from './payment-config';
import {
  calculateBsAmount,
  isVenezuelanBusiness,
  type BcvRateResult,
} from '@/lib/payments/bcv-rate';
import { getBcvRateAction } from './actions';

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useTranslations('settings.plan.paymentModal');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API not available (e.g. http)
      const el = document.createElement('textarea');
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`${t('copy')} ${label}`}
      className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg font-semibold transition-all text-xs px-3 py-1.5"
      style={{
        background: copied ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.08)',
        color:      copied ? '#10B981' : '#C0C0C8',
        border:     `1px solid ${copied ? 'rgba(16,185,129,0.35)' : 'rgba(255,255,255,0.15)'}`,
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      <span>{copied ? t('copied') : t('copy')}</span>
    </button>
  );
}

// ─── DataRow — fila con valor + CopyButton ────────────────────────────────────

function DataRow({
  label,
  value,
  copyable = false,
  highlight = false,
}: {
  label: string;
  value: string;
  copyable?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="py-2.5 border-b border-white/[0.07] last:border-0">
      {/* Label — línea pequeña arriba */}
      <p className="text-[10px] uppercase tracking-wide text-[#909098] mb-1">{label}</p>
      {/* Valor + botón copiar en la misma fila */}
      <div className="flex items-center justify-between gap-3">
        <p
          className="text-sm font-semibold break-all leading-snug flex-1"
          style={{ color: highlight ? '#F59E0B' : '#ffffff' }}
        >
          {value}
        </p>
        {copyable && <CopyButton value={value} label={label} />}
      </div>
    </div>
  );
}

// ─── PagoMovilInstructions ────────────────────────────────────────────────────

function PagoMovilInstructions({ concept, amountBs }: { concept: string; amountBs: string | null }) {
  const t = useTranslations('settings.plan.paymentModal.pagoMovil');

  return (
    <div
      className="rounded-xl p-4 space-y-1"
      style={{ background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.22)' }}
    >
      <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-3">
        {t('title')}
      </p>
      <DataRow label={t('bank')}    value={PAGO_MOVIL_CONFIG.bankName} copyable />
      <DataRow label={t('phone')}   value={PAGO_MOVIL_CONFIG.phone}    copyable />
      <DataRow label={t('cedula')}  value={PAGO_MOVIL_CONFIG.cedula}   copyable />
      <DataRow label={t('concept')} value={concept}                    copyable />
      {amountBs ? (
        <DataRow label="Monto a transferir" value={`Bs. ${amountBs}`} copyable highlight />
      ) : (
        <p className="text-[10px] text-amber-400/80 pt-2 leading-snug">
          ⚠ No se pudo obtener la tasa BCV. Consulta bcv.org.ve y aplica un 30% adicional.
        </p>
      )}
    </div>
  );
}

// ─── BinanceInstructions ──────────────────────────────────────────────────────

function BinanceInstructions({ price }: { price: string }) {
  const t  = useTranslations('settings.plan.paymentModal.binance');
  const tb = useTranslations('settings.plan.paymentModal');

  return (
    <div
      className="rounded-xl p-4 space-y-1"
      style={{ background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.22)' }}
    >
      <p className="text-[10px] font-bold text-yellow-400 uppercase tracking-wider mb-3">
        {t('title')}
      </p>
      <DataRow label={t('payId')}       value={BINANCE_CONFIG.payId}  copyable />
      <DataRow label={t('currency')}    value={t('currencyValue')} />
      <DataRow label={t('exactAmount')} value={price} copyable highlight />
      <a
        href="https://www.binance.com/en/my/wallet/account/payment/send"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[10px] text-yellow-400/70 hover:text-yellow-400 transition-colors pt-2"
      >
        <ExternalLink size={10} />
        {tb('openBinance')}
      </a>
    </div>
  );
}

// ─── ReferenceInput ───────────────────────────────────────────────────────────

function ReferenceInput({
  id,
  label,
  hint,
  value,
  onChange,
  accentColor,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  accentColor: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-[#909098] block mb-1.5">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ej: 93847261"
        maxLength={40}
        className="w-full h-11 px-3 rounded-lg text-sm text-white bg-[#16161A] border border-[#3E3E44] outline-none transition-colors"
        onFocus={(e) => (e.currentTarget.style.borderColor = accentColor)}
        onBlur={(e)  => (e.currentTarget.style.borderColor = '#3E3E44')}
      />
      <p className="text-[10px] text-[#606068] mt-1 leading-snug">{hint}</p>
    </div>
  );
}

// ─── MethodCard ───────────────────────────────────────────────────────────────

function MethodCard({
  id,
  icon,
  label,
  subtitle,
  badge,
  selected,
  onClick,
}: {
  id: string;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
  badge?: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      className="w-full flex items-start gap-3 p-3.5 rounded-xl transition-all text-left"
      style={{
        background: selected ? 'rgba(0,98,255,0.12)' : 'rgba(255,255,255,0.03)',
        border: `1.5px solid ${selected ? '#0062FF' : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      <div
        className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center mt-0.5"
        style={{ background: selected ? 'rgba(0,98,255,0.22)' : 'rgba(255,255,255,0.06)' }}
      >
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-white">{label}</span>
          {badge && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-[#909098] mt-0.5 leading-snug">{subtitle}</p>
      </div>
      {/* Radio circle */}
      <div
        className="flex-shrink-0 w-4 h-4 rounded-full border-2 mt-1 flex items-center justify-center"
        style={{ borderColor: selected ? '#0062FF' : '#3E3E44' }}
      >
        {selected && <div className="w-2 h-2 rounded-full bg-[#0062FF]" />}
      </div>
    </button>
  );
}

// ─── PaymentMethodModal ───────────────────────────────────────────────────────

interface Props {
  plan:    Plan;
  onClose: () => void;
  businessTimezone?: string | null;
}

export function PaymentMethodModal({ plan, onClose, businessTimezone }: Props) {
  const t   = useTranslations('settings.plan.paymentModal');
  const cfg = PLAN_CONFIG[plan];
  const flow = usePaymentFlow(plan, onClose);
  const isVE = isVenezuelanBusiness(businessTimezone);

  // ── BCV rate for Venezuelan businesses ──────────────────────────────────────
  const [bcvRate, setBcvRate] = useState<BcvRateResult | null>(null);

  useEffect(() => {
    if (!isVE) return;
    getBcvRateAction().then(setBcvRate).catch(() => setBcvRate(null));
  }, [isVE]);

  const amountBs = bcvRate
    ? calculateBsAmount(cfg.amountUsd, bcvRate.rateWithMarkup)
    : null;

  // Filter payment methods: Pago Móvil only for Venezuelan businesses
  const METHODS = useMemo(() => {
    const all: { method: AnyPaymentMethod; icon: React.ReactNode }[] = [
      { method: 'nowpayments',    icon: <Bitcoin    size={18} className="text-amber-400" /> },
      { method: 'pago_movil',     icon: <Smartphone size={18} className="text-emerald-400" /> },
      { method: 'binance_manual', icon: <Bitcoin    size={18} className="text-yellow-400" /> },
    ];
    if (!isVE) return all.filter((m) => m.method !== 'pago_movil');
    return all;
  }, [isVE]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4 bg-black/80 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-[#1C1C21] border border-[#2E2E33] rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md overflow-hidden shadow-2xl flex flex-col"
        style={{ maxHeight: '92dvh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle — mobile only */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-[#3E3E44]" />
        </div>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="px-4 sm:px-5 py-3 border-b border-[#2E2E33] flex items-center justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white truncate">
              {flow.step === 'manual_success'
                ? t('registered')
                : `${t('continueBtn')} · ${cfg.label}`}
            </h3>
            <p className="text-xs" style={{ color: cfg.color }}>
              {cfg.price} / mes
            </p>
          </div>
          <button
            id="payment-modal-close"
            type="button"
            onClick={onClose}
            className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[#909098] hover:text-white hover:bg-white/10 transition-all"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="px-4 sm:px-5 py-4 overflow-y-auto space-y-4 flex-1">

          {/* Error banner */}
          {flow.error && (
            <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
              <X size={12} className="flex-shrink-0 mt-0.5" />
              <span>{flow.error}</span>
            </div>
          )}

          {/* ══ STEP 1: Choose method ══════════════════════════════════════ */}
          {flow.step === 'choose_method' && (
            <>
              <p className="text-xs text-[#909098]">{t('selectMethod')}</p>
              <div className="space-y-2">
                {METHODS.map(({ method, icon }) => {
                  const label    = t(`methods.${method}.label`);
                  const subtitle = t(`methods.${method}.subtitle`);
                  const badge    = method === 'nowpayments' ? t('methods.nowpayments.badge') : undefined;
                  return (
                    <MethodCard
                      key={method}
                      id={`method-${method}`}
                      icon={icon}
                      label={label}
                      subtitle={subtitle}
                      badge={badge}
                      selected={flow.method === method}
                      onClick={() => flow.setMethod(method)}
                    />
                  );
                })}
              </div>
              <Button
                id="payment-method-continue"
                className="w-full h-11 font-semibold text-sm"
                style={{ background: cfg.color }}
                onClick={flow.handleContinue}
                disabled={flow.loading}
              >
                {flow.loading
                  ? <Loader2 size={16} className="animate-spin" />
                  : `${t('continueBtn')} →`}
              </Button>
            </>
          )}

          {/* ══ STEP 2a: Pago Móvil form ═══════════════════════════════════ */}
          {flow.step === 'manual_form' && flow.method === 'pago_movil' && (
            <>
              <PagoMovilInstructions concept={`Cronix ${cfg.label}`} amountBs={amountBs} />
              <ReferenceInput
                id="pago-movil-ref"
                label={t('pagoMovil.refLabel')}
                hint={t('pagoMovil.refHint')}
                value={flow.reference}
                onChange={flow.setReference}
                accentColor="#10B981"
              />
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1 h-11 text-xs text-[#909098] hover:text-white"
                  onClick={flow.goBack}
                  disabled={flow.loading}
                >
                  ← {t('backBtn')}
                </Button>
                <Button
                  id="submit-pago-movil"
                  className="flex-1 h-11 text-xs font-semibold"
                  style={{ background: '#10B981' }}
                  onClick={flow.handleSubmitManual}
                  disabled={flow.loading}
                >
                  {flow.loading
                    ? <Loader2 size={15} className="animate-spin" />
                    : t('sendRef')}
                </Button>
              </div>
            </>
          )}

          {/* ══ STEP 2b: Binance form ══════════════════════════════════════ */}
          {flow.step === 'manual_form' && flow.method === 'binance_manual' && (
            <>
              <BinanceInstructions price={cfg.price} />
              <ReferenceInput
                id="binance-ref"
                label={t('binance.refLabel')}
                hint={t('binance.refHint')}
                value={flow.reference}
                onChange={flow.setReference}
                accentColor="#F59E0B"
              />
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  className="flex-1 h-11 text-xs text-[#909098] hover:text-white"
                  onClick={flow.goBack}
                  disabled={flow.loading}
                >
                  ← {t('backBtn')}
                </Button>
                <Button
                  id="submit-binance-payment"
                  className="flex-1 h-11 text-xs font-semibold"
                  style={{ background: '#F59E0B', color: '#111' }}
                  onClick={flow.handleSubmitManual}
                  disabled={flow.loading}
                >
                  {flow.loading
                    ? <Loader2 size={15} className="animate-spin" />
                    : t('sendRef')}
                </Button>
              </div>
            </>
          )}

          {/* ══ STEP 3: Success ════════════════════════════════════════════ */}
          {flow.step === 'manual_success' && (
            <div className="text-center py-4 space-y-3">
              <div className="text-5xl">✅</div>
              <p className="text-white font-semibold text-sm">{t('successTitle')}</p>
              <p className="text-xs text-[#909098] leading-relaxed max-w-[280px] mx-auto">
                {t('successMsg', { plan: cfg.label })}
              </p>
              <p className="text-xs text-[#606068]">{t('successNote')}</p>
              <Button
                id="manual-payment-done"
                className="w-full h-11 text-sm font-semibold mt-2"
                style={{ background: cfg.color }}
                onClick={onClose}
              >
                {t('successBtn')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
