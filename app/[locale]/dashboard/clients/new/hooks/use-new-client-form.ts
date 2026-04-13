/**
 * use-new-client-form — Extracts form state and creation logic for the
 * new client page.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import { getContainer } from '@/lib/container';
import { notificationForNewClient } from '@/lib/use-cases/notifications.use-case';
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
  selectedCountry: Country,
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
      setSaving(true);
      setError(null);

      // Check duplicate phone
      if (fullPhone) {
        const container = await getContainer();
        const { clients: clientsRepo } = container;
        // Use raw Supabase check for duplicate (repository doesn't expose this)
        const { createClient } = await import('@/lib/supabase/server');
        const supabase = await createClient();
        const { data: existing } = await supabase
          .from('clients')
          .select('id, name')
          .eq('business_id', businessId)
          .eq('phone', fullPhone)
          .is('deleted_at', null)
          .maybeSingle();

        if (existing) {
          setSaving(false);
          setError(`El número ya está registrado para el cliente "${existing.name}".`);
          return;
        }
      }

      if (!fullPhone) {
        setSaving(false);
        setError('Número de teléfono inválido.');
        return;
      }

      const container = await getContainer();
      const result = await container.clients.insert({
        business_id: businessId,
        name: form.name.trim(),
        phone: fullPhone,
        email: form.email.trim() || undefined,
      });

      setSaving(false);
      if (result.error) {
        setError('Error al crear el cliente: ' + result.error);
        return;
      }

      // In-app notification for new client
      const notifPayload = notificationForNewClient(
        businessId,
        form.name.trim(),
        fullPhone ?? undefined,
      );
      container.notifications.create(notifPayload).catch(() => null);

      router.push('/dashboard/clients');
      router.refresh();
    },
    [businessId, form, selectedTags, router],
  );

  return { form, setForm, saving, error, handleSubmit };
}
