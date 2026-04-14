/**
 * use-settings-form — Extracts all data loading, form state, and save handlers
 * from the settings page into a reusable hook.
 *
 * Uses getContainer() from @/lib/container instead of getRepos(supabase).
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Business, BusinessSettingsJson } from '@/types';
import { parsePhone, buildPhone, COUNTRIES, Country } from '@/components/ui/phone-input-flags';
import { getBrowserContainer } from '@/lib/browser-container';
import { useNotifications } from '@/lib/hooks/use-notifications';
import { useBusinessContext } from '@/lib/hooks/use-business-context';

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type DayKey = typeof DAYS[number];

export interface DayHours {
  open: string;
  close: string;
  active: boolean;
}
const DEFAULT_DAY: DayHours = { open: '09:00', close: '18:00', active: false };

function buildDefaultHours(): Record<string, DayHours> {
  const result: Record<string, DayHours> = {};
  for (const key of DAYS) result[key] = { ...DEFAULT_DAY };
  return result;
}

function getHour(hours: Record<string, DayHours>, key: string): DayHours {
  return hours[key] ?? { ...DEFAULT_DAY };
}

export interface BizForm {
  name: string;
  category: string;
  phoneLocal: string;
  address: string;
}

export interface SettingsFormReturn {
  biz: Business | null;
  loading: boolean;
  saving: boolean;
  savingHours: boolean;
  savingFab: boolean;
  savingNotif: boolean;
  generatingSlug: boolean;
  form: BizForm;
  setForm: React.Dispatch<React.SetStateAction<BizForm>>;
  selectedCountry: Country;
  setSelectedCountry: React.Dispatch<React.SetStateAction<Country>>;
  hours: Record<string, DayHours>;
  setHours: React.Dispatch<React.SetStateAction<Record<string, DayHours>>>;
  notifSettings: { whatsapp: boolean };
  setNotifSettings: React.Dispatch<React.SetStateAction<{ whatsapp: boolean }>>;
  showLuisFab: boolean;
  setShowLuisFab: React.Dispatch<React.SetStateAction<boolean>>;
  copiedLink: boolean;
  msg: { type: 'success' | 'error'; text: string } | null;
  whatsappLink: string | null;
  updateHour: (key: string, field: keyof DayHours, value: string | boolean) => void;
  handleSaveBiz: () => Promise<void>;
  handleSaveHours: () => Promise<void>;
  handleSaveNotifications: () => Promise<void>;
  handleSaveLuisFab: (newVal: boolean) => Promise<void>;
  handleGenerateSlug: () => Promise<void>;
  copyHoursToAll: (sourceKey: string) => void;
  getHour: (key: string) => DayHours;
  DAYS: readonly DayKey[];
  notif: ReturnType<typeof useNotifications>;
}

export function useSettingsForm(): SettingsFormReturn {
  const { supabase, businessId: bizId, loading: contextLoading } = useBusinessContext();
  const [biz, setBiz] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [msg, setMsg] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [form, setForm] = useState<BizForm>({
    name: '',
    category: '',
    phoneLocal: '',
    address: '',
  });
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0] as Country);
  const [hours, setHours] = useState<Record<string, DayHours>>(buildDefaultHours);
  const [notifSettings, setNotifSettings] = useState<{ whatsapp: boolean }>({ whatsapp: false });
  const [showLuisFab, setShowLuisFab] = useState(true);
  const [savingFab, setSavingFab] = useState(false);
  const [savingNotif, setSavingNotif] = useState(false);
  const notif = useNotifications(bizId);
  const [copiedLink, setCopiedLink] = useState(false);
  const [generatingSlug, setGeneratingSlug] = useState(false);

  const WA_NUMBER = '584147531158';
  const whatsappLink = biz?.slug
    ? `https://wa.me/${WA_NUMBER}?text=%23${encodeURIComponent(biz.slug)}`
    : null;

  const showMsg = useCallback((type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  }, []);

  // Data loading — single query using container pattern
  useEffect(() => {
    if (contextLoading || !bizId) {
      if (!contextLoading) setLoading(false);
      return;
    }
    async function load() {
      const container = getBrowserContainer();
      const result = await container.businesses.getById(bizId!);

      if (!result.error && result.data) {
        const business = result.data;
        setBiz(business as any);
        const { country, local } = parsePhone(business.phone ?? '');
        setSelectedCountry(country);
        setForm({
          name: business.name,
          category: business.category ?? '',
          phoneLocal: local,
          address: business.address ?? '',
        });
        const wh = (business.settings as unknown as BusinessSettingsJson)?.workingHours ?? {};
        const loaded = buildDefaultHours();
        for (const key of DAYS) {
          const val = wh[key];
          if (Array.isArray(val) && val.length === 2) {
            loaded[key] = {
              open: String(val[0] ?? '09:00'),
              close: String(val[1] ?? '18:00'),
              active: true,
            };
          }
        }
        setHours(loaded);
        const notifData = (business.settings as unknown as BusinessSettingsJson)?.notifications;
        if (notifData) {
          setNotifSettings({
            whatsapp: notifData.whatsapp ?? false,
          });
        }

        const uiData = (business.settings as unknown as BusinessSettingsJson)?.uiSettings;
        if (uiData && typeof uiData.showLuisFab === 'boolean') {
          setShowLuisFab(uiData.showLuisFab);
        }

      }
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextLoading, bizId]);

  const handleSaveBiz = useCallback(async () => {
    if (!bizId) return;
    setSaving(true);

    const fullPhone = buildPhone(selectedCountry, form.phoneLocal);
    const container = getBrowserContainer();

    const result = await container.businesses.update(bizId, {
      name: form.name.trim(),
      category: form.category,
      phone: fullPhone,
      address: form.address.trim() || null,
    });

    setSaving(false);
    result.error
      ? showMsg('error', 'saveError')
      : showMsg('success', 'saveSuccess');
  }, [bizId, selectedCountry, form, showMsg]);

  const handleSaveHours = useCallback(async () => {
    if (!bizId || !biz) return;
    setSavingHours(true);
    const workingHours: Record<string, [string, string] | null> = {};
    for (const key of DAYS) {
      const h = getHour(hours, key);
      workingHours[key] = h.active ? [h.open, h.close] : null;
    }
    const currentSettings = (biz.settings as unknown as BusinessSettingsJson) ?? {};
    const container = getBrowserContainer();

    const result = await container.businesses.updateSettings(bizId, { ...currentSettings, workingHours });

    setSavingHours(false);
    result.error
      ? showMsg('error', 'saveHoursError')
      : showMsg('success', 'saveHoursSuccess');
  }, [bizId, biz, hours, showMsg]);

  const updateHour = useCallback(
    (key: string, field: keyof DayHours, value: string | boolean) => {
      setHours((prev) => ({
        ...prev,
        [key]: { ...(prev[key] ?? { ...DEFAULT_DAY }), [field]: value },
      }));
    },
    [],
  );

  const handleSaveNotifications = useCallback(async () => {
    if (!bizId || !biz) return;
    setSavingNotif(true);
    const currentSettings = (biz.settings as unknown as BusinessSettingsJson) ?? {};
    const container = getBrowserContainer();

    const result = await container.businesses.updateSettings(bizId, {
      ...currentSettings,
      notifications: notifSettings,
    });

    setSavingNotif(false);
    if (!result.error) {
      setBiz((prev) =>
        prev
          ? ({
              ...prev,
              settings: {
                ...(prev.settings as BusinessSettingsJson),
                notifications: notifSettings,
              } as unknown as Business['settings'],
            } as any)
          : prev,
      );
    }
    result.error
      ? showMsg('error', 'saveNotifError')
      : showMsg('success', 'saveNotifSuccess');
  }, [bizId, biz, notifSettings, showMsg]);

  const handleSaveLuisFab = useCallback(
    async (newVal: boolean) => {
      if (!bizId || !biz) return;
      setShowLuisFab(newVal);
      const currentSettings = (biz.settings as unknown as BusinessSettingsJson) ?? {};
      const container = getBrowserContainer();

      const result = await container.businesses.updateSettings(bizId, {
        ...currentSettings,
        uiSettings: { showLuisFab: newVal },
      });

      setSavingFab(false);

      if (!result.error) {
        setBiz((prev) =>
          prev
            ? ({
                ...prev,
                settings: {
                  ...(prev.settings as BusinessSettingsJson),
                  uiSettings: { showLuisFab: newVal },
                } as unknown as Business['settings'],
              } as any)
            : prev,
        );

        // Real-time UI sync without refresh
        window.dispatchEvent(new CustomEvent('cronix:toggle-fab', { detail: newVal }));
        showMsg('success', newVal ? 'saveLuisFabActive' : 'saveLuisFabInactive');
      } else {
        showMsg('error', 'saveLuisFabError');
        setShowLuisFab(!newVal); // revert
      }
    },
    [bizId, biz, showMsg],
  );

  const handleGenerateSlug = useCallback(async () => {
    if (!bizId || !biz) return;
    setGeneratingSlug(true);
    const base = biz.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20);
    const suffix = Math.random().toString(36).slice(2, 8);
    const newSlug = base ? `${base}-${suffix}` : suffix;
    const container = getBrowserContainer();
    const result = await container.businesses.update(bizId, { slug: newSlug });

    if (!result.error)
      setBiz((prev) => (prev ? ({ ...prev, slug: newSlug } as any) : prev));
    else showMsg('error', 'generateWaError');
    setGeneratingSlug(false);
  }, [bizId, biz, showMsg]);

  const copyHoursToAll = useCallback(
    (sourceKey: string) => {
      const source = hours[sourceKey];
      if (!source || !source.active) return;

      setHours((prev) => {
        const next = { ...prev };
        DAYS.forEach((key) => {
          if (key !== sourceKey && next[key]?.active) {
            next[key] = { ...next[key]!, open: source.open, close: source.close };
          }
        });
        return next;
      });
      showMsg('success', 'copyHoursSuccess');
    },
    [hours, showMsg],
  );

  return {
    biz,
    loading,
    saving,
    savingHours,
    savingFab,
    savingNotif,
    generatingSlug,
    form,
    setForm,
    selectedCountry,
    setSelectedCountry,
    hours,
    setHours,
    notifSettings,
    setNotifSettings,
    showLuisFab,
    setShowLuisFab,
    copiedLink,
    msg,
    whatsappLink,
    updateHour,
    handleSaveBiz,
    handleSaveHours,
    handleSaveNotifications,
    handleSaveLuisFab,
    handleGenerateSlug,
    copyHoursToAll,
    getHour: (key: string) => getHour(hours, key),
    DAYS,
    notif,
  };
}
