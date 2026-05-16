/**
 * use-payment-flow.ts
 * Hook: encapsula TODA la lógica de estado del flujo de pago.
 * El modal es un renderizador tonto; este hook es el cerebro.
 *
 * SRP  — Una sola responsabilidad: gestionar el estado del flujo de pago.
 * DIP  — El hook depende de abstracciones (actions), no de la UI.
 * OCP  — Añadir un nuevo método solo requiere extender AnyPaymentMethod y
 *         añadir el handler correspondiente, sin tocar el modal.
 */

'use client';

import { useState } from 'react';
import { createSaaSCheckoutSession, submitManualPayment } from './actions';
import type { Plan, AnyPaymentMethod, ManualPaymentMethod } from './payment-config';

export type PaymentStep = 'choose_method' | 'manual_form' | 'manual_success' | 'paypal_success';

export interface PaymentFlowState {
  step:      PaymentStep;
  method:    AnyPaymentMethod;
  loading:   boolean;
  error:     string | null;
  reference: string;
}

export interface PaymentFlowActions {
  setMethod:            (m: AnyPaymentMethod) => void;
  setReference:         (r: string) => void;
  handleContinue:       () => Promise<void>;
  handleSubmitManual:   () => Promise<void>;
  goBack:               () => void;
  setStep:              (step: PaymentStep) => void;
  setLoading:           (loading: boolean) => void;
  setError:             (error: string | null) => void;
}

export function usePaymentFlow(
  plan: Plan,
  onClose: () => void,
): PaymentFlowState & PaymentFlowActions {
  const [step,      setStep]      = useState<PaymentStep>('choose_method');
  const [method,    setMethod]    = useState<AnyPaymentMethod>('nowpayments');
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [reference, setReference] = useState('');

  // ── Step 1: route by method ──────────────────────────────────────────────
  const handleContinue = async () => {
    setError(null);

    if (method === 'nowpayments') {
      setLoading(true);
      try {
        const res = await createSaaSCheckoutSession(plan);
        if (res.error) { setError(res.error); return; }
        if (res.invoice_url) {
          window.open(res.invoice_url, '_blank', 'noopener,noreferrer');
          onClose();
        }
      } finally {
        setLoading(false);
      }
      return;
    }

    // Manual methods → show form
    setStep('manual_form');
  };

  // ── Step 2: submit reference number ─────────────────────────────────────
  const handleSubmitManual = async () => {
    setError(null);

    const ref = reference.trim();
    if (!ref || ref.length < 4) {
      setError('Ingresa el número de referencia (mínimo 4 caracteres).');
      return;
    }

    setLoading(true);
    try {
      const res = await submitManualPayment({
        plan,
        method: method as ManualPaymentMethod,
        referenceNumber: ref,
      });
      if (res.error) { setError(res.error); return; }
      setStep('manual_success');
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    setStep('choose_method');
    setError(null);
  };

  return {
    step, method, loading, error, reference,
    setMethod, setReference,
    handleContinue, handleSubmitManual, goBack,
    setStep, setLoading, setError,
  };
}
