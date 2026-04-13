/**
 * use-client-edit-form — Extracts form state, loading, saving, and delete
 * logic for the client edit page.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import { getBrowserContainer } from '@/lib/browser-container';
import { parsePhone, buildPhone, isE164Phone, COUNTRIES, Country } from '@/components/ui/phone-input-flags';
import { useContactPicker } from '@/lib/hooks/use-contact-picker';

export interface ClientEditForm {
  name: string;
  phoneLocal: string;
  email: string;
  notes: string;
  tags: string[];
}

export interface UseClientEditFormReturn {
  loading: boolean;
  saving: boolean;
  deleting: boolean;
  confirmDelete: boolean;
  setConfirmDelete: React.Dispatch<React.SetStateAction<boolean>>;
  legacyPhone: boolean;
  form: ClientEditForm;
  setForm: React.Dispatch<React.SetStateAction<ClientEditForm>>;
  selectedCountry: Country;
  setSelectedCountry: React.Dispatch<React.SetStateAction<Country>>;
  msg: { type: 'success' | 'error'; text: string } | null;
  handleSave: () => Promise<void>;
  handleDelete: () => Promise<void>;
  toggleTag: (tag: string) => void;
  pickContact: (() => void) | undefined;
  cpSupported: boolean;
  cpLoading: boolean;
}

export function useClientEditForm(clientId: string): UseClientEditFormReturn {
  const router = useRouter();
  const { supabase, businessId, loading: contextLoading } = useBusinessContext();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [legacyPhone, setLegacyPhone] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [form, setForm] = useState<ClientEditForm>({
    name: '',
    phoneLocal: '',
    email: '',
    notes: '',
    tags: [],
  });

  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0] as Country);

  const { supported: cpSupported, loading: cpLoading, pick: pickContact } = useContactPicker(
    ({ name, phoneLocal, country }) => {
      setForm(prev => ({ ...prev, name: prev.name || name, phoneLocal }));
      setSelectedCountry(country);
    }
  );

  const showMsg = useCallback((type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }, []);

  const toggleTag = useCallback((tag: string) => {
    setForm(prev => ({
      ...prev,
      tags: prev.tags.includes(tag)
        ? prev.tags.filter(t => t !== tag)
        : [...prev.tags, tag],
    }));
  }, []);

  // Load client data
  useEffect(() => {
    if (!businessId) {
      if (!contextLoading) router.push('/dashboard/setup');
      return;
    }
    async function load() {
      const container = getBrowserContainer();
      const clientResult = await container.clients.getById(clientId, businessId!);
      const client = clientResult.data;
      if (!client) return router.push('/dashboard/clients');

      setLegacyPhone(!isE164Phone(client.phone));
      const { country, local } = parsePhone(client.phone ?? '');
      setSelectedCountry(country);
      setForm({
        name: client.name ?? '',
        phoneLocal: local,
        email: client.email ?? '',
        notes: client.notes ?? '',
        tags: client.tags ?? [],
      });
      setLoading(false);
    }
    load();
  }, [businessId, contextLoading, clientId, router]);

  const handleSave = useCallback(async () => {
    if (!form.name.trim()) return showMsg('error', 'El nombre es obligatorio.');
    if (!businessId) return;
    setSaving(true);

    const fullPhone = buildPhone(selectedCountry, form.phoneLocal);

    // Check duplicate phone (exclude current client)
    if (fullPhone) {
      const { data: existing } = await supabase
        .from('clients')
        .select('id, name')
        .eq('business_id', businessId)
        .eq('phone', fullPhone)
        .is('deleted_at', null)
        .neq('id', clientId)
        .maybeSingle();

      if (existing) {
        setSaving(false);
        return showMsg('error', `El número ya está registrado para el cliente "${existing.name}".`);
      }
    }

    const { error } = await supabase
      .from('clients')
      .update({
        name: form.name.trim(),
        phone: fullPhone,
        email: form.email.trim() || null,
        notes: form.notes.trim() || null,
        tags: form.tags.length > 0 ? form.tags : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', clientId)
      .eq('business_id', businessId);

    setSaving(false);
    if (error) return showMsg('error', 'Error al guardar: ' + error.message);
    setLegacyPhone(false);
    showMsg('success', 'Cliente actualizado correctamente');
    setTimeout(() => router.push(`/dashboard/clients/${clientId}`), 1200);
  }, [form, businessId, clientId, selectedCountry, supabase, router, showMsg]);

  const handleDelete = useCallback(async () => {
    if (!businessId) return;
    setDeleting(true);
    const { error } = await supabase
      .from('clients')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', clientId)
      .eq('business_id', businessId);

    setDeleting(false);
    if (error) return showMsg('error', 'Error al eliminar: ' + error.message);
    router.push('/dashboard/clients');
  }, [businessId, clientId, supabase, router, showMsg]);

  return {
    loading,
    saving,
    deleting,
    confirmDelete,
    setConfirmDelete,
    legacyPhone,
    form,
    setForm,
    selectedCountry,
    setSelectedCountry,
    msg,
    handleSave,
    handleDelete,
    toggleTag,
    pickContact,
    cpSupported,
    cpLoading,
  };
}
