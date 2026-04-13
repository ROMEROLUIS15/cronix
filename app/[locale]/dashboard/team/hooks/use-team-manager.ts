/**
 * use-team-manager — Extracts all data loading, CRUD operations, and form
 * state management from the team page into a reusable hook.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import { getBrowserContainer } from '@/lib/browser-container';
import { useBusinessContext } from '@/lib/hooks/use-business-context';
import { useTranslations } from 'next-intl';
import type { TeamMember } from '@/lib/domain/repositories/IUserRepository';
import {
  parsePhone,
  buildPhone,
  type Country,
  COUNTRIES,
} from '@/components/ui/phone-input-flags';
import {
  createEmployeeAction,
  updateEmployeeAction,
  toggleEmployeeActiveAction,
  deleteEmployeeAction,
} from '../actions';

// ── Form state ──────────────────────────────────────────────────────────────

export interface EmployeeForm {
  name:       string
  email:      string
  country:    Country
  localPhone: string
  color:      string
}

export const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#3b82f6', '#ef4444', '#14b8a6',
]

const emptyForm = (): EmployeeForm => ({
  name:       '',
  email:      '',
  country:    COUNTRIES[0] as Country,
  localPhone: '',
  color:      '#6366f1',
})

export interface UseTeamManagerReturn {
  members: TeamMember[];
  employees: TeamMember[];
  owner: TeamMember | undefined;
  loading: boolean;
  isOwner: boolean;
  showForm: boolean;
  setShowForm: React.Dispatch<React.SetStateAction<boolean>>;
  editingId: string | null;
  form: EmployeeForm;
  setForm: React.Dispatch<React.SetStateAction<EmployeeForm>>;
  deletingId: string | null;
  saving: boolean;
  msg: { type: 'success' | 'error'; text: string } | null;
  openNew: () => void;
  openEdit: (m: TeamMember) => void;
  handleSave: () => Promise<void>;
  handleToggleActive: (m: TeamMember) => Promise<void>;
  handleDelete: (id: string) => Promise<void>;
}

export function useTeamManager(): UseTeamManagerReturn {
  const { supabase, businessId, userRole, loading: contextLoading } = useBusinessContext();
  const t = useTranslations('team');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EmployeeForm>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const isOwner = userRole === 'owner' || userRole === 'platform_admin';

  const showMsg = useCallback((type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }, []);

  // Data loading — uses container pattern
  const loadMembers = useCallback(async (bId: string) => {
    try {
      const container = getBrowserContainer();
      const result = await container.users.getTeamMembers(bId);
      setMembers(result.error ? [] : result.data as TeamMember[]);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load members when business context is ready
  useEffect(() => {
    if (businessId) loadMembers(businessId);
    else if (!contextLoading) setLoading(false);
  }, [businessId, contextLoading, loadMembers]);

  // Suppress unused variable warnings — supabase and t are available for future use
  void supabase;
  void t;

  const openNew = useCallback(() => {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(true);
  }, []);

  const openEdit = useCallback((m: TeamMember) => {
    const { country, local } = parsePhone(m.phone);
    setForm({
      name:       m.name,
      email:      m.email ?? '',
      country,
      localPhone: local,
      color:      m.color ?? '#6366f1',
    });
    setEditingId(m.id);
    setShowForm(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.name.trim() || !businessId) {
      return showMsg('error', t('errNameReq'));
    }
    setSaving(true);

    const payload = {
      name:  form.name.trim(),
      email: form.email.trim() || null,
      phone: buildPhone(form.country, form.localPhone),
      color: form.color,
    };

    try {
      if (editingId) {
        await updateEmployeeAction({ employeeId: editingId, ...payload });
        showMsg('success', t('toastUpdated'));
      } else {
        await createEmployeeAction(payload);
        showMsg('success', t('toastAdded'));
      }
      setShowForm(false);
      await loadMembers(businessId);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setSaving(false);
    }
  }, [form, businessId, editingId, showMsg, loadMembers, t]);

  const handleToggleActive = useCallback(async (m: TeamMember) => {
    if (!businessId) return;
    try {
      await toggleEmployeeActiveAction({
        employeeId: m.id,
        currentlyActive: m.is_active ?? true,
      });
      await loadMembers(businessId);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Error desconocido');
    }
  }, [businessId, loadMembers, showMsg]);

  const handleDelete = useCallback(async (id: string) => {
    if (!businessId) return;
    setDeletingId(id);
    try {
      await deleteEmployeeAction({ employeeId: id });
      showMsg('success', t('toastDeleted'));
      await loadMembers(businessId);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setDeletingId(null);
    }
  }, [businessId, showMsg, loadMembers, t]);

  const employees = members.filter(m => m.role === 'employee');
  const owner = members.find(m => m.role === 'owner');

  return {
    members,
    employees,
    owner,
    loading,
    isOwner,
    showForm,
    setShowForm,
    editingId,
    form,
    setForm,
    deletingId,
    saving,
    msg,
    openNew,
    openEdit,
    handleSave,
    handleToggleActive,
    handleDelete,
  };
}
