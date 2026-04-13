/**
 * use-new-expense-form — Extracts form state and creation logic for the
 * new expense page.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import { getContainer } from '@/lib/container';
import type { ExpenseCategory } from '@/types';

export interface NewExpenseForm {
  category: ExpenseCategory;
  amount: string;
  description: string;
  date: string;
}

export interface UseNewExpenseFormReturn {
  form: NewExpenseForm;
  setForm: React.Dispatch<React.SetStateAction<NewExpenseForm>>;
  saving: boolean;
  msg: { type: 'success' | 'error'; text: string } | null;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
}

export function useNewExpenseForm(): UseNewExpenseFormReturn {
  const router = useRouter();
  const { businessId } = useBusinessContext();

  const [form, setForm] = useState<NewExpenseForm>({
    category: 'supplies' as ExpenseCategory,
    amount: '',
    description: '',
    date: new Date().toISOString().split('T')[0] as string,
  });

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;

    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) {
      setMsg({ type: 'error', text: 'Ingresa un monto valido' });
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const container = await getContainer();
      const result = await container.finances.createExpense({
        business_id: businessId!,
        category: form.category,
        amount,
        description: form.description.trim() || null,
        expense_date: form.date,
      });

      if (result.error) throw new Error(result.error);

      router.push('/dashboard/finances/expenses');
      router.refresh();
    } catch (err) {
      setMsg({ type: 'error', text: err instanceof Error ? err.message : 'Error al guardar el gasto' });
    } finally {
      setSaving(false);
    }
  }, [businessId, form, router]);

  return { form, setForm, saving, msg, handleSubmit };
}
