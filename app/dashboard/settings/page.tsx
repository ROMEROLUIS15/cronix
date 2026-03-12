"use client";

import { useState, useEffect } from "react";
import {
  Store,
  Clock,
  Bell,
  Save,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import type { Business, BusinessSettings } from "@/types";

const CATEGORIES = [
  "Barbería",
  "Salón de belleza",
  "Clínica",
  "Consultorio médico",
  "Spa",
  "Entrenador personal",
  "Restaurante",
  "Consultoría",
  "Estética / Belleza",
  "Salud / Medicina",
  "Deportes / Gimnasio",
  "Otros",
];

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
  const supabase = createClient();
  const [biz, setBiz] = useState<Business | null>(null);
  const [bizId, setBizId] = useState<string | null>(null);
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
    phone: "",
    address: "",
  });
  const [hours, setHours] =
    useState<Record<string, DayHours>>(buildDefaultHours);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: dbUser } = await supabase
        .from("users")
        .select("business_id")
        .eq("id", user.id)
        .single();
      if (!dbUser?.business_id) {
        setLoading(false);
        return;
      }
      setBizId(dbUser.business_id);
      const { data: business } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", dbUser.business_id)
        .single();
      if (business) {
        setBiz(business);
        setForm({
          name: business.name,
          category: business.category ?? "",
          phone: business.phone ?? "",
          address: business.address ?? "",
        });
        const wh = (business.settings as any)?.workingHours ?? {};
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
      }
      setLoading(false);
    }
    load();
  }, []);

  const showMsg = (type: "success" | "error", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const handleSaveBiz = async () => {
    if (!bizId) return;
    setSaving(true);
    const { error } = await supabase
      .from("businesses")
      .update({
        name: form.name.trim(),
        category: form.category,
        phone: form.phone.trim() || null,
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
    const currentSettings = (biz.settings as any) ?? {};
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

  const settings = (biz?.settings as unknown as BusinessSettings) ?? {
    notifications: { whatsapp: false, email: false, reminderHours: [] },
    workingHours: {},
    maxDailyBookingsPerClient: 2,
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
                {CATEGORIES.map((cat) => (
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
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="input-base"
                placeholder="+58 412 000 0000"
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

      {/* Working Hours — RESPONSIVE FIX */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
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
        <div className="space-y-2">
          {DAYS.map(({ key, label }) => {
            const h: DayHours = getHour(hours, key);
            return (
              <div
                key={key}
                className="rounded-xl p-3"
                style={{ background: "#212125", border: "1px solid #2E2E33" }}
              >
                {/* Row 1: día + toggle */}
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "#F2F2F2" }}
                  >
                    {label}
                  </span>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs" style={{ color: "#909098" }}>
                      {h.active ? "Abierto" : "Cerrado"}
                    </span>
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
                        className="w-9 h-5 rounded-full transition-colors peer-checked:bg-blue-600"
                        style={{ background: h.active ? "#0062FF" : "#3A3A3F" }}
                      />
                      <div
                        className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                        style={{
                          transform: h.active
                            ? "translateX(16px)"
                            : "translateX(0)",
                        }}
                      />
                    </div>
                  </label>
                </div>
                {/* Row 2: horarios — solo si activo */}
                {h.active && (
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={h.open}
                      onChange={(e) => updateHour(key, "open", e.target.value)}
                      className="input-base flex-1 py-2 text-sm"
                    />
                    <span
                      className="text-sm font-bold flex-shrink-0"
                      style={{ color: "#909098" }}
                    >
                      —
                    </span>
                    <input
                      type="time"
                      value={h.close}
                      onChange={(e) => updateHour(key, "close", e.target.value)}
                      className="input-base flex-1 py-2 text-sm"
                    />
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex justify-end pt-2">
            <Button
              onClick={handleSaveHours}
              loading={savingHours}
              leftIcon={<Save size={16} />}
            >
              Guardar horario
            </Button>
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
          {[
            {
              key: "whatsapp",
              label: "WhatsApp",
              desc: "Recordatorios por WhatsApp",
            },
            {
              key: "email",
              label: "Email",
              desc: "Recordatorios por correo electrónico",
            },
          ].map(({ key, label, desc }) => (
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
                  defaultChecked={
                    settings.notifications?.[key as "whatsapp" | "email"]
                  }
                  className="sr-only peer"
                />
                <div
                  className="w-10 h-5 rounded-full transition-colors"
                  style={{ background: "#3A3A3F" }}
                />
                <div className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
              </label>
            </div>
          ))}
          <div>
            <p
              className="text-sm font-medium mb-2"
              style={{ color: "#F2F2F2" }}
            >
              Anticipación del recordatorio
            </p>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 6, 12, 24, 48].map((h) => (
                <button
                  key={h}
                  className="px-3 py-1.5 rounded-lg text-sm border transition-all"
                  style={
                    (settings.notifications?.reminderHours ?? [24, 2]).includes(
                      h,
                    )
                      ? {
                          background: "#0062FF",
                          color: "#fff",
                          border: "1px solid #0062FF",
                        }
                      : {
                          background: "transparent",
                          color: "#909098",
                          border: "1px solid #2E2E33",
                        }
                  }
                >
                  {h}h
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card style={{ border: "1px solid rgba(0,98,255,0.2)" }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: "#F2F2F2" }}>
              Plan actual: {biz?.plan ?? "free"}
            </p>
            <p className="text-xs" style={{ color: "#909098" }}>
              Acceso completo a todas las funcionalidades
            </p>
          </div>
          <Button variant="secondary">Gestionar plan</Button>
        </div>
      </Card>
    </div>
  );
}
