"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Clock,
  DollarSign,
  Tag,
  CheckCircle2,
  AlertCircle,
  X,
  Save,
  Wrench,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBusinessContext } from "@/lib/hooks/use-business-context";
import type { Service } from "@/types";
import { logger } from "@/lib/logger";
import { useTranslations } from "next-intl";
import { getRepos } from "@/lib/repositories";
import { 
  SERVICE_COLORS, 
  SERVICE_CATEGORIES, 
  DEFAULT_SERVICE_COLOR,
  DEFAULT_DURATION 
} from "@/lib/services/constants";

interface ServiceForm {
  name: string;
  description: string;
  duration_min: number;
  priceStr: string; // ← string para permitir edición libre (borrar el 0)
  color: string;
  category: string;
  is_active: boolean;
}

const emptyForm = (): ServiceForm => ({
  name: "",
  description: "",
  duration_min: DEFAULT_DURATION,
  priceStr: "", // vacío — el usuario escribe el precio desde cero
  color: DEFAULT_SERVICE_COLOR,
  category: "",
  is_active: true,
});

export default function ServicesPage() {
  const { supabase, businessId, loading: contextLoading } = useBusinessContext();
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ServiceForm>(emptyForm());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isCustom, setIsCustom] = useState(false);
  const t = useTranslations("services");
  const [msg, setMsg] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  const loadServices = useCallback(async (bId: string) => {
    try {
      const { services: servicesRepoInstance } = getRepos(supabase);
      const result = await servicesRepoInstance.getAll(bId);
      
      if (!result.error) {
        setServices(result.data ?? []);
      } else {
        logger.error('services', 'Error loading services', result.error);
      }
    } catch (err) {
      logger.error('services', 'Error loading services', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // Load services when business context is ready
  useEffect(() => {
    if (businessId) loadServices(businessId);
    else if (!contextLoading) setLoading(false);
  }, [businessId, contextLoading, loadServices]);

  const showMsg = (type: "success" | "error", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const openNew = () => {
    setForm(emptyForm());
    setEditingId(null);
    setIsCustom(false);
    setShowForm(true);
  };

  const openEdit = (s: Service) => {
    setForm({
      name: s.name,
      description: s.description ?? "",
      duration_min: s.duration_min,
      priceStr: s.price === 0 ? "" : String(s.price), // vacío si era 0
      color: s.color ?? "#6366f1",
      category: s.category ?? "",
      is_active: s.is_active ?? true,
    });
    setEditingId(s.id);
    setIsCustom(![30, 60, 90, 120, 150].includes(s.duration_min));
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !businessId)
      return showMsg("error", "El nombre es obligatorio.");
    setSaving(true);
    const parsedPrice = parseFloat(form.priceStr.replace(",", ".")) || 0;
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
      const { services: servicesRepoInstance } = getRepos(supabase);
      let result;
      
      if (editingId) {
        result = await servicesRepoInstance.update(editingId, businessId, payload);
      } else {
        result = await servicesRepoInstance.create(businessId, payload);
      }

      if (result.error) throw new Error(result.error);

      showMsg(
        "success",
        editingId ? "Servicio actualizado" : "Servicio creado correctamente",
      );
      setShowForm(false);
      await loadServices(businessId);
    } catch (err) {
      showMsg("error", "Error al guardar: " + (err instanceof Error ? err.message : 'Error desconocido'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!businessId) return;
    setDeletingId(id);
    try {
      const { services: servicesRepoInstance } = getRepos(supabase);
      const result = await servicesRepoInstance.delete(id, businessId);
      
      if (result.error) throw new Error(result.error);

      showMsg("success", "Servicio eliminado");
      await loadServices(businessId);
    } catch (err) {
      showMsg("error", "Error al eliminar: " + (err instanceof Error ? err.message : 'Error desconocido'));
    } finally {
      setDeletingId(null);
    }
  };

  const toggleActive = async (s: Service) => {
    if (!businessId) return;
    try {
      const { services: servicesRepoInstance } = getRepos(supabase);
      const result = await servicesRepoInstance.toggleActive(s.id, s.is_active ?? true);
      
      if (result.error) throw new Error(result.error);
      
      await loadServices(businessId);
    } catch (err) {
      showMsg("error", "Error al cambiar estado: " + (err instanceof Error ? err.message : 'Error desconocido'));
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-brand-600 border-t-transparent rounded-full" />
      </div>
    );

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl w-full overflow-x-hidden">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#F2F2F2" }}>
            {t('title')}
          </h1>
          <p className="text-sm" style={{ color: "#909098" }}>
            {t('count' as any, { count: services.length })}
          </p>
        </div>
        <Button onClick={openNew} leftIcon={<Plus size={16} />}>
          {t('newService')}
        </Button>
      </div>

      {msg && (
        <div
          className="p-4 rounded-xl flex items-center gap-3 text-sm"
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

      {/* Form */}
      {showForm && (
        <Card style={{ border: "1px solid rgba(0,98,255,0.25)" }}>
          <div className="flex items-center justify-between mb-5">
            <h2
              className="text-base font-semibold"
              style={{ color: "#F2F2F2" }}
            >
              {editingId ? t('editService') : t('newService')}
            </h2>
            <button
              onClick={() => setShowForm(false)}
              className="p-1.5 rounded-lg transition-colors hover:bg-white/5"
              style={{ color: "#909098" }}
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: "#F2F2F2" }}
                >
                  {t('form.name')} *
                </label>
                <input
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                  className="input-base"
                  placeholder={t('form.namePlaceholder')}
                />
              </div>
              <div>
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: "#F2F2F2" }}
                >
                  {t('form.category')}
                </label>
                <select
                  value={form.category}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, category: e.target.value }))
                  }
                  className="input-base"
                  style={{ backgroundColor: "#212125" }}
                >
                  <option value="">{t('form.noCategory')}</option>
                  {SERVICE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {t(`categories.${c}` as any)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                style={{ color: "#F2F2F2" }}
              >
                {t('form.description')}
              </label>
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                className="input-base resize-none"
                rows={2}
                placeholder={t('form.descriptionPlaceholder')}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: "#F2F2F2" }}
                >
                  {t('form.duration')}
                </label>
                <div className="flex flex-col gap-2">
                  <div className="relative">
                    <Clock
                      size={16}
                      className="absolute left-3 top-1/2 -translate-y-1/2"
                      style={{ color: "#909098" }}
                    />
                    <select
                      value={isCustom ? "custom" : form.duration_min}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "custom") {
                          setIsCustom(true);
                          setForm(f => ({ ...f, duration_min: 0 }));
                        } else {
                          setIsCustom(false);
                          setForm((f) => ({
                            ...f,
                            duration_min: Number(val),
                          }));
                        }
                      }}
                      className="input-base pl-9"
                      style={{ backgroundColor: "#212125" }}
                    >
                      <option value={30}>{t('form.durations.30')}</option>
                      <option value={60}>{t('form.durations.60')}</option>
                      <option value={90}>{t('form.durations.90')}</option>
                      <option value={120}>{t('form.durations.120')}</option>
                      <option value={150}>{t('form.durations.150')}</option>
                      <option value="custom">{t('form.customDuration')}</option>
                    </select>
                  </div>
                  {isCustom && (
                    <div className="animate-fade-in relative">
                       <input
                        type="number"
                        min="1"
                        placeholder={t('form.customMin')}
                        value={form.duration_min === 0 ? "" : form.duration_min}
                        onChange={(e) => {
                          const val = e.target.value;
                          setForm(f => ({ ...f, duration_min: val === "" ? 0 : Number(val) }));
                        }}
                        className="input-base pr-12"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-[#909098] uppercase">min</span>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label
                  className="block text-sm font-medium mb-1.5"
                  style={{ color: "#F2F2F2" }}
                >
                  {t('form.price')}
                </label>
                <div className="relative">
                  <DollarSign
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2"
                    style={{ color: "#909098" }}
                  />
                  {/* ← string input: permite borrar todos los caracteres libremente */}
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.priceStr}
                    placeholder="0"
                    onChange={(e) => {
                      const val = e.target.value;
                      // Permitir solo dígitos, punto y coma
                      if (/^[0-9]*[.,]?[0-9]*$/.test(val) || val === "") {
                        setForm((f) => ({ ...f, priceStr: val }));
                      }
                    }}
                    className="input-base pl-9"
                  />
                </div>
              </div>
            </div>

            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: "#F2F2F2" }}
              >
                {t('form.color')}
              </label>
              <div className="flex gap-2 flex-wrap">
                {SERVICE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, color: c }))}
                    className="w-8 h-8 rounded-full transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      border:
                        form.color === c
                          ? "3px solid #F2F2F2"
                          : "3px solid transparent",
                      transform: form.color === c ? "scale(1.15)" : "scale(1)",
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, is_active: e.target.checked }))
                  }
                  className="sr-only peer"
                />
                <div
                  className="w-10 h-5 rounded-full transition-colors"
                  style={{ background: form.is_active ? "#0062FF" : "#3A3A3F" }}
                />
                <div
                  className="absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                  style={{
                    transform: form.is_active
                      ? "translateX(20px)"
                      : "translateX(0)",
                  }}
                />
              </label>
              <span className="text-sm" style={{ color: "#F2F2F2" }}>
                {t('form.active')}
              </span>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={() => setShowForm(false)}>
                {t('form.cancel')}
              </Button>
              <Button
                onClick={handleSave}
                loading={saving}
                leftIcon={<Save size={16} />}
              >
                {editingId ? t('form.save') : t('form.create')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* List */}
      {services.length === 0 ? (
        <Card className="text-center py-16">
          <Wrench
            size={40}
            className="mx-auto mb-3 opacity-30"
            style={{ color: "#909098" }}
          />
          <p className="text-base font-medium" style={{ color: "#F2F2F2" }}>
            {t('noServices')}
          </p>
          <p className="text-sm mt-1 mb-4" style={{ color: "#909098" }}>
            {t('createFirst')}
          </p>
          <Button onClick={openNew} leftIcon={<Plus size={16} />}>
            {t('createFirstBtn')}
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {services.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 p-3 sm:p-4 rounded-2xl transition-all"
              style={{
                background: s.is_active ? "#1A1A1F" : "#161619",
                border: "1px solid #2E2E33",
                opacity: s.is_active ? 1 : 0.6,
              }}
            >
              <div
                className="w-3 h-12 rounded-full flex-shrink-0"
                style={{ backgroundColor: s.color ?? "#ccc" }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p
                    className="text-sm font-semibold"
                    style={{ color: "#F2F2F2" }}
                  >
                    {s.name}
                  </p>
                  {s.category && (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{
                        background: "rgba(0,98,255,0.1)",
                        color: "#4D83FF",
                        border: "1px solid rgba(0,98,255,0.2)",
                      }}
                    >
                      {t(`categories.${s.category}` as any)}
                    </span>
                  )}
                  {!s.is_active && (
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={{
                        background: "#212125",
                        color: "#909098",
                        border: "1px solid #2E2E33",
                      }}
                    >
                      {t('status.inactive')}
                    </span>
                  )}
                </div>
                <p
                  className="text-xs mt-0.5 flex items-center gap-3"
                  style={{ color: "#909098" }}
                >
                  <span className="flex items-center gap-1">
                    <Clock size={11} /> {s.duration_min} min
                  </span>
                  <span className="flex items-center gap-1">
                    <DollarSign size={11} /> {s.price.toLocaleString()}
                  </span>
                  {s.description && (
                    <span className="truncate min-w-0 flex-1">
                      {s.description}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => toggleActive(s)}
                  title={s.is_active ? t('actions.deactivate') : t('actions.activate')}
                  className="p-2 rounded-lg transition-colors hover:bg-white/5"
                  style={{ color: "#909098" }}
                >
                  <Tag size={15} />
                </button>
                <button
                  onClick={() => openEdit(s)}
                  className="p-2 rounded-lg transition-colors hover:bg-white/5"
                  style={{ color: "#909098" }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  onClick={() => handleDelete(s.id)}
                  disabled={deletingId === s.id}
                  className="p-2 rounded-lg transition-colors hover:bg-white/5 disabled:opacity-50"
                  style={{ color: "#909098" }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
