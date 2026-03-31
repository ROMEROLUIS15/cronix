"use client";

import { useState, useEffect } from "react";
import {
  Store,
  Clock,
  Bell,
  Save,
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  MessageCircle,
  Link as LinkIcon,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Business, BusinessSettingsJson } from "@/types";
import { PhoneInputFlags, parsePhone, buildPhone, COUNTRIES, Country } from "@/components/ui/phone-input-flags";
import { BUSINESS_CATEGORIES } from "@/lib/constants/business";
import { useNotifications } from "@/lib/hooks/use-notifications";
import { useBusinessContext } from "@/lib/hooks/use-business-context";

const DAYS = [
  { key: "mon", label: "Lunes" },
  { key: "tue", label: "Martes" },
  { key: "wed", label: "Miércoles" },
  { key: "thu", label: "Jueves" },
  { key: "fri", label: "Viernes" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
];

interface DayHours {
  open: string;
  close: string;
  active: boolean;
}
const DEFAULT_DAY: DayHours = { open: "09:00", close: "18:00", active: false };

function buildDefaultHours(): Record<string, DayHours> {
  const result: Record<string, DayHours> = {};
  for (const { key } of DAYS) result[key] = { ...DEFAULT_DAY };
  return result;
}

function getHour(hours: Record<string, DayHours>, key: string): DayHours {
  return hours[key] ?? { ...DEFAULT_DAY };
}

export default function SettingsPage() {
  // useBusinessContext is cached in React Query — no extra auth queries on navigation
  const { supabase, businessId: bizId, loading: contextLoading } = useBusinessContext();
  const [biz, setBiz] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [msg, setMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [form, setForm] = useState({
    name: "",
    category: "",
    phoneLocal: "",
    address: "",
  });
  const [selectedCountry, setSelectedCountry] = useState<Country>(COUNTRIES[0] as Country);
  const [hours, setHours] =
    useState<Record<string, DayHours>>(buildDefaultHours);
  const [notifSettings, setNotifSettings] = useState<{
    whatsapp: boolean
    email:    boolean
  }>({ whatsapp: false, email: false });
  const [savingNotif, setSavingNotif] = useState(false);
  const notif = useNotifications(bizId);
  const [copiedLink, setCopiedLink] = useState(false);

  const WA_NUMBER = '584147531158';
  const whatsappLink = biz?.slug
    ? `https://wa.me/${WA_NUMBER}?text=%23${encodeURIComponent(biz.slug)}`
    : null;
  const [generatingSlug, setGeneratingSlug] = useState(false);

  const handleGenerateSlug = async () => {
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
    const { error } = await supabase
      .from('businesses')
      .update({ slug: newSlug })
      .eq('id', bizId);
    if (!error) setBiz(prev => prev ? { ...prev, slug: newSlug } : prev);
    else showMsg('error', 'Error al generar el enlace');
    setGeneratingSlug(false);
  };

  // Only one query needed — auth/business_id come from cached context
  useEffect(() => {
    if (contextLoading || !bizId) {
      if (!contextLoading) setLoading(false);
      return;
    }
    async function load() {
      const { data: business } = await supabase
        .from("businesses")
        .select("id, name, category, phone, address, logo_url, slug, owner_id, settings, timezone, locale, plan, created_at, updated_at")
        .eq("id", bizId!)
        .single();
      if (business) {
        setBiz(business);
        const { country, local } = parsePhone(business.phone);
        setSelectedCountry(country);
        setForm({
          name: business.name,
          category: business.category ?? "",
          phoneLocal: local,
          address: business.address ?? "",
        });
        const wh = (business.settings as unknown as BusinessSettingsJson)?.workingHours ?? {};
        const loaded = buildDefaultHours();
        for (const { key } of DAYS) {
          const val = wh[key];
          if (Array.isArray(val) && val.length === 2) {
            loaded[key] = {
              open: String(val[0] ?? "09:00"),
              close: String(val[1] ?? "18:00"),
              active: true,
            };
          }
        }
        setHours(loaded);
        const notifData = (business.settings as unknown as BusinessSettingsJson)?.notifications
        if (notifData) {
          setNotifSettings({
            whatsapp: notifData.whatsapp ?? false,
            email:    notifData.email    ?? false,
          });
        }
      }
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextLoading, bizId]);

  const showMsg = (type: "success" | "error", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleSaveBiz = async () => {
    if (!bizId) return;
    setSaving(true);
    
    // Combinar dial + número local (normalizado)
    const fullPhone = buildPhone(selectedCountry, form.phoneLocal);

    const { error } = await supabase
      .from("businesses")
      .update({
        name: form.name.trim(),
        category: form.category,
        phone: fullPhone,
        address: form.address.trim() || null,
      })
      .eq("id", bizId);
    setSaving(false);
    error
      ? showMsg("error", "Error al guardar: " + error.message)
      : showMsg("success", "Perfil del negocio guardado correctamente");
  };

  const handleSaveHours = async () => {
    if (!bizId || !biz) return;
    setSavingHours(true);
    const workingHours: Record<string, [string, string] | null> = {};
    for (const { key } of DAYS) {
      const h = getHour(hours, key);
      workingHours[key] = h.active ? [h.open, h.close] : null;
    }
    const currentSettings = (biz.settings as unknown as BusinessSettingsJson) ?? {};
    const { error } = await supabase
      .from("businesses")
      .update({ settings: { ...currentSettings, workingHours } })
      .eq("id", bizId);
    setSavingHours(false);
    error
      ? showMsg("error", "Error al guardar horario: " + error.message)
      : showMsg("success", "Horario guardado correctamente");
  };

  const updateHour = (
    key: string,
    field: keyof DayHours,
    value: string | boolean,
  ) => {
    setHours((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { ...DEFAULT_DAY }), [field]: value },
    }));
  };
  
  const handleSaveNotifications = async () => {
    if (!bizId || !biz) return;
    setSavingNotif(true);
    const currentSettings = (biz.settings as unknown as BusinessSettingsJson) ?? {};
    const { error } = await supabase
      .from("businesses")
      .update({ settings: { ...currentSettings, notifications: notifSettings } })
      .eq("id", bizId);
    setSavingNotif(false);
    if (!error) {
      setBiz(prev => prev ? {
        ...prev,
        settings: { ...(prev.settings as BusinessSettingsJson), notifications: notifSettings } as unknown as Business['settings'],
      } : prev);
    }
    error
      ? showMsg("error", "Error al guardar notificaciones: " + error.message)
      : showMsg("success", "Preferencias de recordatorio guardadas");
  };

  const copyHoursToAll = (sourceKey: string) => {
    const source = hours[sourceKey];
    if (!source || !source.active) return;
    
    setHours(prev => {
      const next = { ...prev };
      DAYS.forEach(({ key }) => {
        if (key !== sourceKey && next[key]?.active) {
          next[key] = { ...next[key]!, open: source.open, close: source.close };
        }
      });
      return next;
    });
    showMsg("success", "Horarios copiados a los días abiertos");
  };


  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" />
      </div>
    );

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "#F2F2F2" }}>
          Ajustes
        </h1>
        <p className="text-sm" style={{ color: "#909098" }}>
          Configura tu negocio y preferencias
        </p>
      </div>

      {msg && (
        <div
          className={`p-4 rounded-xl flex items-center gap-3 text-sm border`}
          style={
            msg.type === "success"
              ? {
                  background: "rgba(48,209,88,0.08)",
                  border: "1px solid rgba(48,209,88,0.2)",
                  color: "#30D158",
                }
              : {
                  background: "rgba(255,59,48,0.08)",
                  border: "1px solid rgba(255,59,48,0.2)",
                  color: "#FF3B30",
                }
          }
        >
          {msg.type === "success" ? (
            <CheckCircle2 size={18} />
          ) : (
            <AlertCircle size={18} />
          )}
          {msg.text}
        </div>
      )}

      {/* Business Profile */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0,98,255,0.1)" }}
          >
            <Store size={18} style={{ color: "#0062FF" }} />
          </div>
          <div>
            <h2
              className="text-base font-semibold"
              style={{ color: "#F2F2F2" }}
            >
              Perfil del Negocio
            </h2>
            <p className="text-xs" style={{ color: "#909098" }}>
              Información pública de tu negocio
            </p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label
              className="block text-sm font-medium mb-1.5"
              style={{ color: "#F2F2F2" }}
            >
              Nombre del negocio
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-base"
              placeholder="Nombre de tu negocio"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: "#F2F2F2" }}
              >
                Categoría o rubro
              </label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="input-base"
                style={{ backgroundColor: "#212125" }}
              >
                <option value="">Selecciona una categoría</option>
                {BUSINESS_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: "#F2F2F2" }}
              >
                Teléfono
              </label>
              <PhoneInputFlags
                country={selectedCountry}
                onCountryChange={(c) => setSelectedCountry(c)}
                localPhone={form.phoneLocal}
                onLocalPhoneChange={(v) => setForm({ ...form, phoneLocal: v })}
              />
            </div>
          </div>
          <div>
            <label
              className="block text-sm font-medium mb-1.5"
              style={{ color: "#F2F2F2" }}
            >
              Dirección
            </label>
            <input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="input-base"
              placeholder="Calle, ciudad..."
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={handleSaveBiz}
              loading={saving}
              leftIcon={<Save size={16} />}
            >
              Guardar cambios
            </Button>
          </div>
        </div>
      </Card>

      {/* WhatsApp Deep Link */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(37,211,102,0.1)" }}
          >
            <MessageCircle size={18} style={{ color: "#25D366" }} />
          </div>
          <div>
            <h2
              className="text-base font-semibold"
              style={{ color: "#F2F2F2" }}
            >
              Link de WhatsApp
            </h2>
            <p className="text-xs" style={{ color: "#909098" }}>
              Comparte este enlace para que tus clientes agenden por WhatsApp
            </p>
          </div>
        </div>

        {whatsappLink ? (
          <>
            <div
              className="flex items-center gap-3 p-3 rounded-xl"
              style={{ background: "#16161C", border: "1px solid #2E2E33" }}
            >
              <LinkIcon size={16} className="flex-shrink-0" style={{ color: "#909098" }} />
              <span
                className="text-sm truncate flex-1 font-mono"
                style={{ color: "#F2F2F2" }}
              >
                {whatsappLink}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="flex-shrink-0 gap-1.5"
                onClick={() => {
                  navigator.clipboard.writeText(whatsappLink);
                  setCopiedLink(true);
                  setTimeout(() => setCopiedLink(false), 2000);
                }}
              >
                {copiedLink ? (
                  <>
                    <CheckCircle2 size={14} style={{ color: "#30D158" }} />
                    <span style={{ color: "#30D158" }}>Copiado</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    Copiar
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs mt-3" style={{ color: "#909098" }}>
              Cuando un cliente abre este enlace, WhatsApp se abre con tu negocio pre-seleccionado. Ideal para Instagram, tarjetas de presentación o tu página web.
            </p>
          </>
        ) : (
          <div className="text-center py-4 space-y-3">
            <p className="text-sm" style={{ color: "#909098" }}>
              Tu negocio aún no tiene un enlace de WhatsApp generado.
            </p>
            <Button
              onClick={handleGenerateSlug}
              loading={generatingSlug}
              leftIcon={<MessageCircle size={16} />}
            >
              Generar enlace de WhatsApp
            </Button>
          </div>
        )}
      </Card>

      {/* Working Hours — RESPONSIVE FIX */}
      <Card>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(0,98,255,0.1)" }}
            >
              <Clock size={18} style={{ color: "#0062FF" }} />
            </div>
            <div>
              <h2
                className="text-base font-semibold"
                style={{ color: "#F2F2F2" }}
              >
                Horario de Atención
              </h2>
              <p className="text-xs" style={{ color: "#909098" }}>
                Define los horarios de cada día
              </p>
            </div>
          </div>
          
          {Object.values(hours).some(h => h.active) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const firstActive = DAYS.find(d => hours[d.key]?.active);
                if (firstActive) copyHoursToAll(firstActive.key);
              }}
              className="text-xs h-8 gap-1.5"
            >
              <Copy size={13} />
              Copiar a todos
            </Button>
          )}
        </div>

        <div className="space-y-3">
          {DAYS.map(({ key, label }) => {
            const h: DayHours = getHour(hours, key);
            return (
              <div
                key={key}
                className={`rounded-2xl p-4 transition-all duration-200 ${h.active ? 'bg-brand-500/5 border-brand-500/20' : 'bg-[#1C1C21] border-[#2E2E33]'}`}
                style={{ border: "1px solid" }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  {/* Day and Status Toggle */}
                  <div className="flex items-center justify-between sm:justify-start gap-4">
                    <div className="w-24">
                      <span
                        className={`text-sm font-bold ${h.active ? 'text-white' : 'text-[#8A8A90]'}`}
                      >
                        {label}
                      </span>
                    </div>
                    
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={h.active}
                          onChange={(e) =>
                            updateHour(key, "active", e.target.checked)
                          }
                          className="sr-only peer"
                        />
                        <div
                          className="w-10 h-5 rounded-full transition-colors bg-[#3A3A3F] peer-checked:bg-blue-600"
                        />
                        <div
                          className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-5"
                        />
                      </div>
                      <span className={`text-[11px] font-bold uppercase tracking-wider transition-colors ${h.active ? 'text-brand-400' : 'text-[#606068]'}`}>
                        {h.active ? "Abierto" : "Cerrado"}
                      </span>
                    </label>
                  </div>

                  {/* Time Selectors — Refined for mobile to prevent overflow */}
                  {h.active && (
                    <div className="grid grid-cols-2 gap-3 sm:gap-4 animate-fade-in flex-1 sm:max-w-[340px] w-full items-end">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold text-[#6A6A72] uppercase tracking-widest mb-1.5 ml-1">Desde</p>
                        <input
                          type="time"
                          value={h.open}
                          onChange={(e) => updateHour(key, "open", e.target.value)}
                          className="w-full bg-[#16161C] border border-[#2E2E33] rounded-xl px-3 py-2.5 text-sm text-white font-medium focus:border-brand-500 outline-none transition-all"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold text-[#6A6A72] uppercase tracking-widest mb-1.5 ml-1">Hasta</p>
                        <input
                          type="time"
                          value={h.close}
                          onChange={(e) => updateHour(key, "close", e.target.value)}
                          className="w-full bg-[#16161C] border border-[#2E2E33] rounded-xl px-3 py-2.5 text-sm text-white font-medium focus:border-brand-500 outline-none transition-all"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          
          <div className="flex justify-end pt-4">
            <Button
              onClick={handleSaveHours}
              loading={savingHours}
              leftIcon={<Save size={16} />}
              className="w-full sm:w-auto"
            >
              Guardar todos los horarios
            </Button>
          </div>
        </div>
      </Card>

      {/* Admin Alerts */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(34,197,94,0.1)" }}
          >
            <ShieldCheck size={18} style={{ color: "#22C55E" }} />
          </div>
          <div>
            <h2
              className="text-base font-semibold"
              style={{ color: "#F2F2F2" }}
            >
              Notificaciones del Administrador
            </h2>
            <p className="text-xs" style={{ color: "#909098" }}>
              Alertas de reservas automáticas exclusivas para el dueño
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div
            className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-xl gap-4"
            style={{ background: "#212125", border: "1px solid #2E2E33" }}
          >
            <div>
              <p className="text-sm font-medium" style={{ color: "#F2F2F2" }}>
                WhatsApp del Negocio
              </p>
              <p className="text-xs mt-1" style={{ color: "#909098" }}>
                Recibe notificaciones instantáneas en tu celular cada vez que la IA agende una nueva cita.
              </p>
            </div>
            
            {(biz?.settings as unknown as BusinessSettingsJson)?.wa_verified && biz?.phone ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/20 self-start sm:self-center">
                <CheckCircle2 size={16} className="text-[#22C55E]" />
                <span className="text-sm font-medium text-[#22C55E]">
                  Verificado: {biz.phone}
                </span>
              </div>
            ) : (
              <a
                href={`https://wa.me/${WA_NUMBER}?text=VINCULAR-${biz?.slug || ''}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#22C55E] hover:bg-[#16a34a] transition-colors self-start sm:self-center whitespace-nowrap"
              >
                <Smartphone size={16} className="text-white" />
                <span className="text-sm font-semibold text-white">
                  Vincular mi WhatsApp
                </span>
              </a>
            )}
          </div>
        </div>
      </Card>

      {/* Notifications */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <div
            className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(0,98,255,0.1)" }}
          >
            <Bell size={18} style={{ color: "#0062FF" }} />
          </div>
          <div>
            <h2
              className="text-base font-semibold"
              style={{ color: "#F2F2F2" }}
            >
              Recordatorios
            </h2>
            <p className="text-xs" style={{ color: "#909098" }}>
              Canales y ventanas de tiempo
            </p>
          </div>
        </div>
        <div className="space-y-4">
          {(
            [
              { key: "whatsapp", label: "WhatsApp", desc: "Recordatorios por WhatsApp" },
              { key: "email",    label: "Email",    desc: "Recordatorios por correo electrónico" },
            ] as const
          ).map(({ key, label, desc }) => (
            <div
              key={key}
              className="flex items-center justify-between p-4 rounded-xl"
              style={{ background: "#212125", border: "1px solid #2E2E33" }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: "#F2F2F2" }}>
                  {label}
                </p>
                <p className="text-xs" style={{ color: "#909098" }}>
                  {desc}
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={notifSettings[key]}
                  onChange={e =>
                    setNotifSettings(prev => ({ ...prev, [key]: e.target.checked }))
                  }
                  className="sr-only peer"
                />
                <div
                  className="w-10 h-5 rounded-full transition-colors"
                  style={{ background: notifSettings[key] ? "#0062FF" : "#3A3A3F" }}
                />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
              </label>
            </div>
          ))}
          {/* PWA Push Notifications */}
          {notif.state !== 'unsupported' && (
            <div
              className="flex items-center justify-between p-4 rounded-xl"
              style={{ background: "#212125", border: "1px solid #2E2E33" }}
            >
              <div>
                <p className="text-sm font-medium" style={{ color: "#F2F2F2" }}>
                  Notificaciones Push
                </p>
                <p className="text-xs" style={{ color: "#909098" }}>
                  {notif.state === 'denied'
                    ? 'Bloqueadas — actívalas en la configuración de tu navegador'
                    : notif.state === 'missing_config'
                    ? 'Error: clave VAPID no configurada en el servidor'
                    : notif.state === 'sw_unavailable'
                    ? 'Requiere build de producción — prueba con next build && next start'
                    : notif.loading
                    ? 'Procesando…'
                    : notif.subscribed
                    ? 'Activo en este dispositivo'
                    : 'Recibe alertas de citas en este dispositivo'}
                </p>
              </div>
              {notif.loading ? (
                <Loader2 size={20} className="animate-spin flex-shrink-0" style={{ color: '#0062FF' }} />
              ) : (
                <button
                  type="button"
                  onClick={() => notif.subscribed ? notif.unsubscribe() : notif.subscribe()}
                  disabled={
                    notif.state === 'denied' ||
                    notif.state === 'missing_config' ||
                    notif.state === 'sw_unavailable'
                  }
                  className="relative flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                  aria-label={notif.subscribed ? 'Desactivar notificaciones push' : 'Activar notificaciones push'}
                >
                  <div
                    className="w-10 h-5 rounded-full transition-colors"
                    style={{ background: notif.subscribed ? '#0062FF' : '#3A3A3F' }}
                  />
                  <div
                    className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all duration-200"
                    style={{ left: notif.subscribed ? '22px' : '2px' }}
                  />
                </button>
              )}
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSaveNotifications}
              loading={savingNotif}
              leftIcon={<Save size={16} />}
              className="w-full sm:w-auto"
            >
              Guardar recordatorios
            </Button>
          </div>
        </div>
      </Card>

      <Card style={{ border: "1px solid rgba(0,98,255,0.2)" }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: "#F2F2F2" }}>
              Plan actual: {biz?.plan ?? "free"}
            </p>
            <p className="text-xs" style={{ color: "#909098" }}>
              Acceso completo a todas las funcionalidades
            </p>
          </div>
          <Button variant="secondary" className="w-full sm:w-auto flex-shrink-0">
            Gestionar plan
          </Button>
        </div>
      </Card>
    </div>
  );
}
