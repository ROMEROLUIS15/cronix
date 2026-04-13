'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import { createNewClient } from '@/app/[locale]/dashboard/clients/actions';
import type { Country } from '@/components/ui/phone-input-flags';

export interface NewClientForm {
  name: string;
  phoneLocal: string;
  email: string;
  notes: string;
}

export interface UseNewClientFormReturn {
  form: NewClientForm;
  setForm: React.Dispatch<React.SetStateAction<NewClientForm>>;
  saving: boolean;
  error: string | null;
  handleSubmit: (fullPhone: string | null) => Promise<void>;
}

export function useNewClientForm(
  _selectedCountry: Country,
  selectedTags: string[],
): UseNewClientFormReturn {
  const router = useRouter();
  const { businessId } = useBusinessContext();
  const [form, setForm] = useState<NewClientForm>({
    name: '',
    phoneLocal: '',
    email: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (fullPhone: string | null) => {
      if (!businessId) {
        setError('No se pudo identificar el negocio. Recarga la página.');
        return;
      }
      if (!fullPhone) {
        setError('Número de teléfono inválido.');
        return;
      }

      setSaving(true);
      setError(null);

      const result = await createNewClient({
        businessId,
        name: form.name.trim(),
        phone: fullPhone,
        email: form.email.trim() || undefined,
        tags: selectedTags,
      });

      setSaving(false);

      if (result.error) {
        setError(result.error);
        return;
      }

      router.push('/dashboard/clients');
      router.refresh();
    },
    [businessId, form, selectedTags, router],
  );

  return { form, setForm, saving, error, handleSubmit };
}
