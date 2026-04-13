/**
 * use-service-manager — Extracts all data loading, CRUD operations, and form
 * state management from the services page into a reusable hook.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import type { Service } from '@/types';
import { getContainer } from '@/lib/container';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import {
  DEFAULT_SERVICE_COLOR,
  DEFAULT_DURATION
} from '@/lib/services/constants';

export interface ServiceForm {
  name: string;
  description: string;
  duration_min: number;
  priceStr: string;
  color: string;
  category: string;
  is_active: boolean;
}

const emptyForm = (): ServiceForm => ({
  name: '',
  description: '',
  duration_min: DEFAULT_DURATION,
  priceStr: '',
  color: DEFAULT_SERVICE_COLOR,
  category: '',
  is_active: true,
});

export interface UseServiceManagerReturn {
  services: Service[];
  loading: boolean;
  showForm: boolean;
  setShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  editingId: string | null;
  form: ServiceForm;
  setForm: React.Dispatch<React.SetStateAction<ServiceForm>>;
  deletingId: string | null;
  isCustom: boolean;
  setIsCustom: React.Dispatch<React.SetStateAction<boolean>>;
  msg: { type: 'success' | 'error'; text: string } | null;
  saving: boolean;
  openNew: () => void;
  openEdit: (s: Service) => void;
  handleSave: () => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
  toggleActive: (s: Service) => Promise<void>;
}

export function useServiceManager(): UseServiceManagerReturn {
  const { businessId, loading: contextLoading } = useBusinessContext();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ServiceForm>(emptyForm());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const showMsg = useCallback((type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }, []);

  // Data loading — uses container pattern
  const loadServices = useCallback(async (bId: string) => {
    try {
      const container = await getContainer();
      const result = await container.services.getAll(bId);

      if (!result.error) {
        setServices(result.data ?? []);
      }
    } catch {
      // Silently fail — page handles empty state
    } finally {
      setLoading(false);
    }
  }, []);

  // Load services when business context is ready
  useEffect(() => {
    if (businessId) loadServices(businessId);
    else if (!contextLoading) setLoading(false);
  }, [businessId, contextLoading, loadServices]);

  const openNew = useCallback(() => {
    setForm(emptyForm());
    setEditingId(null);
    setIsCustom(false);
    setShowForm(true);
  }, []);

  const openEdit = useCallback((s: Service) => {
    setForm({
      name: s.name,
      description: s.description ?? '',
      duration_min: s.duration_min,
      priceStr: s.price === 0 ? '' : String(s.price),
      color: s.color ?? '#6366f1',
      category: s.category ?? '',
      is_active: s.is_active ?? true,
    });
    setEditingId(s.id);
    setIsCustom(![30, 60, 90, 120, 150].includes(s.duration_min));
    setShowForm(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim() || !businessId) {
      return showMsg('error', 'El nombre es obligatorio.');
    }
    setSaving(true);
    const parsedPrice = parseFloat(form.priceStr.replace(',', '.')) || 0;
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      duration_min: form.duration_min,
      price: parsedPrice,
      color: form.color,
      category: form.category || null,
      is_active: form.is_active,
    };
    try {
      const container = await getContainer();
      let result;

      if (editingId) {
        result = await container.services.update(editingId, businessId, payload);
      } else {
        result = await container.services.create(businessId, payload);
      }

      if (result.error) throw new Error(result.error);

      showMsg(
        'success',
        editingId ? 'Servicio actualizado' : 'Servicio creado correctamente',
      );
      setShowForm(false);
      await loadServices(businessId);
    } catch (err) {
      showMsg('error', 'Error al guardar: ' + (err instanceof Error ? err.message : 'Error desconocido'));
    } finally {
      setSaving(false);
    }
  }, [form, businessId, editingId, showMsg, loadServices]);

  const handleDelete = useCallback(async (id: string) => {
    if (!businessId) return;
    setDeletingId(id);
    try {
      const container = await getContainer();
      const result = await container.services.delete(id, businessId);

      if (result.error) throw new Error(result.error);

      showMsg('success', 'Servicio eliminado');
      await loadServices(businessId);
    } catch (err) {
      showMsg('error', 'Error al eliminar: ' + (err instanceof Error ? err.message : 'Error desconocido'));
    } finally {
      setDeletingId(null);
    }
  }, [businessId, showMsg, loadServices]);

  const toggleActive = useCallback(async (s: Service) => {
    if (!businessId) return;
    try {
      const container = await getContainer();
      const result = await container.services.toggleActive(s.id, s.is_active ?? true);

      if (result.error) throw new Error(result.error);

      await loadServices(businessId);
    } catch (err) {
      showMsg('error', 'Error al cambiar estado: ' + (err instanceof Error ? err.message : 'Error desconocido'));
    }
  }, [businessId, showMsg, loadServices]);

  return {
    services,
    loading,
    showForm,
    setShowForm,
    editingId,
    form,
    setForm,
    deletingId,
    isCustom,
    setIsCustom,
    msg,
    saving,
    openNew,
    openEdit,
    handleSave,
    handleDelete,
    toggleActive,
  };
}
