/**
 * use-new-transaction-form — Extracts form state and creation logic for the
 * new transaction (income) page.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import { getBrowserContainer } from '@/lib/browser-container';
import { registerClientPayment, registerOtherIncome } from '@/app/[locale]/dashboard/clients/actions';
import { useTranslations } from 'next-intl';
import type { PaymentMethod, Client } from '@/types';

/**
 * Two modes, because "cobro" means two different things:
 *  - client_payment: settle the client's appointment debt → routes through
 *    registerClientPayment (distributes across unpaid appointments, idempotent),
 *    so debt + income + dashboard all reconcile.
 *  - other_income: ad-hoc income (product sale, tip) NOT tied to a debt →
 *    standalone transaction that counts as revenue but settles no appointment.
 */
export type CobroMode = 'client_payment' | 'other_income';

export interface NewTransactionForm {
  mode: CobroMode;
  client_id: string;
  amount: string;
  method: PaymentMethod;
  notes: string;
  date: string;
}

export interface UseNewTransactionFormReturn {
  form: NewTransactionForm;
  setForm: React.Dispatch<React.SetStateAction<NewTransactionForm>>;
  clients: Client[];
  loadingData: boolean;
  saving: boolean;
  msg: { type: 'success' | 'error'; text: string } | null;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
}

export function useNewTransactionForm(): UseNewTransactionFormReturn {
  const router = useRouter();
  const { businessId, loading: contextLoading } = useBusinessContext();
  const t = useTranslations('finances.cobro');

  const [form, setForm] = useState<NewTransactionForm>({
    mode: 'client_payment',
    client_id: '',
    amount: '',
    method: 'cash' as PaymentMethod,
    notes: '',
    date: new Date().toISOString().split('T')[0] as string,
  });

  const [clients, setClients] = useState<Client[]>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // Fresh key per mount → submit is idempotent even on double-click / retry.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) setLoadingData(false);
      return;
    }

    async function loadClients() {
      const container = getBrowserContainer();
      const res = await container.clients.getAll(businessId!);
      setClients(res.error ? [] : res.data as Client[]);
      setLoadingData(false);
    }
    loadClients();
  }, [businessId, contextLoading]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;

    // Client is required to settle debt; optional for ad-hoc income.
    if (form.mode === 'client_payment' && !form.client_id) {
      setMsg({ type: 'error', text: t('errorClient') });
      return;
    }
    const amount = parseFloat(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMsg({ type: 'error', text: t('amountValid') });
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      if (form.mode === 'client_payment') {
        await registerClientPayment({
          business_id: businessId,
          client_id: form.client_id,
          amount,
          method: form.method,
          notes: form.notes.trim() || undefined,
          idempotency_key: idempotencyKey,
        });
      } else {
        await registerOtherIncome({
          client_id: form.client_id || undefined,
          amount,
          method: form.method,
          notes: form.notes.trim() || undefined,
          paid_at: form.date ? new Date(form.date).toISOString() : undefined,
          idempotency_key: idempotencyKey,
        });
      }
      router.push('/dashboard/finances');
      router.refresh();
    } catch (err) {
      // Rotate the key so a corrected retry isn't silently dropped as a duplicate.
      setIdempotencyKey(crypto.randomUUID());
      setMsg({ type: 'error', text: err instanceof Error ? err.message : t('errorSave') });
    } finally {
      setSaving(false);
    }
  }, [businessId, form, router, idempotencyKey, t]);

  return { form, setForm, clients, loadingData, saving, msg, handleSubmit };
}
