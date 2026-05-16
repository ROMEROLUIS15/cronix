/**
 * payment-config.ts
 * SSOT para toda la configuración relacionada con pagos de suscripción.
 * Cualquier cambio de banco, precio o método se hace ÚNICAMENTE aquí.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Plan = 'pro' | 'enterprise';
export type ManualPaymentMethod = 'pago_movil' | 'binance_manual';
export type AnyPaymentMethod = 'nowpayments' | 'paypal' | ManualPaymentMethod;

// ─── Plan config ──────────────────────────────────────────────────────────────

export const PLAN_CONFIG = {
  pro: {
    label: 'Pro',
    price: '$10 USDT',
    amountUsd: 10,
    color: '#0062FF',
  },
  enterprise: {
    label: 'Enterprise',
    price: '$15 USDT',
    amountUsd: 15,
    color: '#A855F7',
  },
} as const satisfies Record<Plan, { label: string; price: string; amountUsd: number; color: string }>;

// ─── Pago Móvil — SSOT ───────────────────────────────────────────────────────

export const PAGO_MOVIL_CONFIG = {
  bankName: 'Bancamiga',
  phone:    '04247092980',
  cedula:   '15295575',
} as const;

// ─── Binance Pay — SSOT ──────────────────────────────────────────────────────

export const BINANCE_CONFIG = {
  payId: '550313419',
} as const;

// ─── Method display config ───────────────────────────────────────────────────

export interface MethodMeta {
  label: string;
  subtitle: string;
  badge?: string;
  color: string;
}

export const METHOD_META: Record<AnyPaymentMethod, MethodMeta> = {
  nowpayments: {
    label:    'Criptomoneda (Automático)',
    subtitle: 'USDT en red BSC. Se activa solo al confirmar en blockchain (1–3 min).',
    badge:    'Automático',
    color:    'text-amber-400',
  },
  paypal: {
    label:    'PayPal (Automático)',
    subtitle: 'Paga de forma segura con tu cuenta PayPal o tarjeta de crédito.',
    badge:    'Automático',
    color:    'text-blue-500',
  },
  pago_movil: {
    label:    'Pago Móvil (Venezuela)',
    subtitle: 'Transfiere en Bs. al número registrado. Activación manual en 24h hábiles.',
    color:    'text-emerald-400',
  },
  binance_manual: {
    label:    'Binance Pay (Manual)',
    subtitle: 'Envía USDT con tu Pay ID de Binance. Activación manual en 24h hábiles.',
    color:    'text-yellow-400',
  },
};
