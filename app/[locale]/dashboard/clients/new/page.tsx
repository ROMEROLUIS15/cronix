"use client";

import { useState, useRef } from "react";
import { ArrowLeft, UserPlus, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBusinessContext } from "@/lib/hooks/use-business-context";
import * as notificationsRepo from "@/lib/repositories/notifications.repo";
import { notificationForNewClient } from "@/lib/use-cases/notifications.use-case";
import {
  PhoneInputFlags,
  parsePhone,
  buildPhone,
  COUNTRIES,
  Country,
} from "@/components/ui/phone-input-flags";
import { useContactPicker } from "@/lib/hooks/use-contact-picker";

const TAG_OPTIONS = ["VIP", "Frecuente", "Nuevo"];

export default function NewClientPage() {
  const router = useRouter();
  const { supabase, businessId } = useBusinessContext();
  const [form, setForm] = useState({
    name: "",
    phoneLocal: "",
    email: "",
    notes: "",
  });
  const [selectedCountry, setSelectedCountry] = useState<Country>(
    COUNTRIES[0] as Country,
  );
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { supported: cpSupported, loading: cpLoading, pick: pickContact } = useContactPicker(
    ({ name, phoneLocal, country }) => {
      setForm(prev => ({ ...prev, name: prev.name || name, phoneLocal }));
      setSelectedCountry(country);
    }
  );

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) {
      setError("No se pudo obtener la sesión. Recarga la página.");
      return;
    }
    setSaving(true);
    setError(null);

    // Combinar dial + número local (normalizado)
    const fullPhone = buildPhone(selectedCountry, form.phoneLocal);

    // Verificar teléfono duplicado dentro del mismo negocio
    if (fullPhone) {
      const { data: existing } = await supabase
        .from("clients")
        .select("id, name")
        .eq("business_id", businessId)
        .eq("phone", fullPhone)
        .is("deleted_at", null)
        .maybeSingle();

      if (existing) {
        setSaving(false);
        setError(`Este número ya está registrado para el cliente "${existing.name}". Cada teléfono debe ser único por negocio.`);
        return;
      }
    }

    const { error: insertError } = await supabase.from("clients").insert({
      business_id: businessId,
      name: form.name.trim(),
      phone: fullPhone,
      email: form.email.trim() || null,
      notes: form.notes.trim() || null,
      tags: selectedTags.length > 0 ? selectedTags : null,
    });
    setSaving(false);
    if (insertError) {
      setError("Error al crear el cliente: " + insertError.message);
    } else {
      // In-app notification for new client
      const notifPayload = notificationForNewClient(businessId, form.name.trim(), fullPhone);
      // Fire-and-forget: notification failures don't block the flow
      notificationsRepo.createNotification(supabase, notifPayload);

      router.push("/dashboard/clients");
      router.refresh();
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl w-full overflow-x-hidden">
      {/* Navigation links — solid blue design */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/dashboard/clients" className="flex-1 sm:flex-initial">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<ArrowLeft size={16} />}
            className="w-full h-10 rounded-xl px-4"
          >
            Clientes
          </Button>
        </Link>
        <Link href="/dashboard" className="flex-1 sm:flex-initial">
          <Button
            variant="primary"
            size="sm"
            leftIcon={<ArrowLeft size={16} />}
            className="w-full h-10 rounded-xl px-4"
          >
            Agenda
          </Button>
        </Link>
      </div>

      <div>
        <h1
          className="text-2xl font-black"
          style={{ color: "#F2F2F2", letterSpacing: "-0.025em" }}
        >
          Nuevo Cliente
        </h1>
        <p className="text-sm" style={{ color: "#909098" }}>
          Registra un nuevo cliente en tu base de datos
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div
            className="p-4 rounded-xl flex items-start gap-2 text-sm font-medium"
            style={{
              background: "rgba(255,59,48,0.08)",
              border: "1px solid rgba(255,59,48,0.2)",
              color: "#FF3B30",
            }}
          >
            {error}
          </div>
        )}

        <Card>
          <div className="flex items-center gap-3 mb-5">
            <div
              className="h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(0,98,255,0.1)" }}
            >
              <UserPlus size={18} style={{ color: "#0062FF" }} />
            </div>
            <h2
              className="text-base font-semibold"
              style={{ color: "#F2F2F2" }}
            >
              Información personal
            </h2>
          </div>

          <div className="space-y-4">
            {/* Nombre */}
            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                htmlFor="client-name"
                style={{ color: "#F2F2F2" }}
              >
                Nombre completo *
              </label>
              <input
                id="client-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input-base"
                placeholder="Ej. Juan Pérez"
              />
            </div>

            {/* Teléfono con selector de país */}
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
                onPickContact={cpSupported ? pickContact : undefined}
                pickContactLoading={cpLoading}
              />
            </div>

            {/* Email */}
            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                htmlFor="client-email"
                style={{ color: "#F2F2F2" }}
              >
                Email
              </label>
              <input
                id="client-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="input-base"
                placeholder="juan@ejemplo.com"
              />
            </div>

            {/* Tags */}
            <div>
              <label
                className="block text-sm font-medium mb-2"
                style={{ color: "#F2F2F2" }}
              >
                Etiquetas
              </label>
              <div className="flex gap-2 flex-wrap">
                {TAG_OPTIONS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className="px-4 py-1.5 rounded-full text-sm font-semibold transition-all"
                    style={
                      selectedTags.includes(tag)
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
                    {tag}
                  </button>
                ))}
              </div>
              {selectedTags.length > 0 && (
                <p className="text-xs mt-1.5" style={{ color: "#6A6A72" }}>
                  Seleccionadas: {selectedTags.join(", ")}
                </p>
              )}
            </div>

            {/* Notas */}
            <div>
              <label
                className="block text-sm font-medium mb-1.5"
                htmlFor="client-notes"
                style={{ color: "#F2F2F2" }}
              >
                Notas internas
              </label>
              <textarea
                id="client-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="input-base resize-none"
                placeholder="Preferencias, alergias, historial relevante..."
              />
            </div>
          </div>
        </Card>

        <div className="flex items-center justify-end gap-3">
          <Button
            type="submit"
            loading={saving}
            leftIcon={<UserPlus size={16} />}
          >
            Guardar Cliente
          </Button>
        </div>
      </form>
    </div>
  );
}
