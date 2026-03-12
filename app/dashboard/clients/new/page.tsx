"use client";

import { useState, useEffect, useRef } from "react";
import { ArrowLeft, UserPlus, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const TAG_OPTIONS = ["VIP", "Frecuente", "Nuevo"];

// ── Países con bandera emoji + prefijo ──────────────────────────────────────
type Country = {
  code: string;
  flag: string;
  name: string;
  dial: string;
  placeholder: string;
};

const COUNTRIES: Country[] = [
  {
    code: "VE",
    flag: "🇻🇪",
    name: "Venezuela",
    dial: "+58",
    placeholder: "412 000 0000",
  },
  {
    code: "CO",
    flag: "🇨🇴",
    name: "Colombia",
    dial: "+57",
    placeholder: "300 123 4567",
  },
  {
    code: "MX",
    flag: "🇲🇽",
    name: "México",
    dial: "+52",
    placeholder: "55 1234 5678",
  },
  {
    code: "US",
    flag: "🇺🇸",
    name: "Estados Unidos",
    dial: "+1",
    placeholder: "212 555 1234",
  },
  {
    code: "AR",
    flag: "🇦🇷",
    name: "Argentina",
    dial: "+54",
    placeholder: "11 2345 6789",
  },
  {
    code: "CL",
    flag: "🇨🇱",
    name: "Chile",
    dial: "+56",
    placeholder: "9 8765 4321",
  },
  {
    code: "PE",
    flag: "🇵🇪",
    name: "Perú",
    dial: "+51",
    placeholder: "912 345 678",
  },
  {
    code: "EC",
    flag: "🇪🇨",
    name: "Ecuador",
    dial: "+593",
    placeholder: "99 123 4567",
  },
  {
    code: "UY",
    flag: "🇺🇾",
    name: "Uruguay",
    dial: "+598",
    placeholder: "91 234 567",
  },
  {
    code: "BO",
    flag: "🇧🇴",
    name: "Bolivia",
    dial: "+591",
    placeholder: "7 123 4567",
  },
  {
    code: "PY",
    flag: "🇵🇾",
    name: "Paraguay",
    dial: "+595",
    placeholder: "981 234 567",
  },
  {
    code: "ES",
    flag: "🇪🇸",
    name: "España",
    dial: "+34",
    placeholder: "612 345 678",
  },
  {
    code: "BR",
    flag: "🇧🇷",
    name: "Brasil",
    dial: "+55",
    placeholder: "11 91234 5678",
  },
  {
    code: "PA",
    flag: "🇵🇦",
    name: "Panamá",
    dial: "+507",
    placeholder: "6123 4567",
  },
  {
    code: "DO",
    flag: "🇩🇴",
    name: "Rep. Dominicana",
    dial: "+1809",
    placeholder: "809 123 4567",
  },
];

export default function NewClientPage() {
  const router = useRouter();
  const supabase = createClient();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    phoneLocal: "",
    email: "",
    notes: "",
  });
  const [selectedCountry, setSelectedCountry] = useState<Country>(
    COUNTRIES[0] as Country,
  );
  const [countryOpen, setCountryOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function init() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: dbUser } = await supabase
        .from("users")
        .select("business_id")
        .eq("id", user.id)
        .single();
      if (dbUser?.business_id) setBusinessId(dbUser.business_id);
    }
    init();
  }, []);

  // Cerrar dropdown al click fuera
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setCountryOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

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

    // Combinar dial + número local
    const fullPhone = form.phoneLocal.trim()
      ? `${selectedCountry.dial} ${form.phoneLocal.trim()}`
      : null;

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
      router.push("/dashboard/clients");
      router.refresh();
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <Link
        href="/dashboard/clients"
        className="btn-ghost inline-flex text-sm gap-2"
        style={{ color: "#909098" }}
      >
        <ArrowLeft size={16} /> Volver a Clientes
      </Link>

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
              <div className="flex gap-2">
                {/* Selector de país */}
                <div className="relative flex-shrink-0" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setCountryOpen((o) => !o)}
                    className="flex items-center gap-1.5 h-full px-3 rounded-xl text-sm font-semibold transition-all"
                    style={{
                      background: "#212125",
                      border: "1px solid #2E2E33",
                      color: "#F2F2F2",
                      minWidth: "90px",
                      boxShadow: countryOpen
                        ? "0 0 0 2px rgba(0,98,255,0.3)"
                        : "none",
                    }}
                  >
                    <span className="text-lg leading-none">
                      {selectedCountry.flag}
                    </span>
                    <span
                      style={{
                        color: "#4D83FF",
                        fontSize: "12px",
                        fontWeight: 700,
                      }}
                    >
                      {selectedCountry.dial}
                    </span>
                    <ChevronDown
                      size={12}
                      style={{
                        color: "#909098",
                        transform: countryOpen ? "rotate(180deg)" : "none",
                        transition: "transform 0.2s",
                      }}
                    />
                  </button>

                  {/* Dropdown */}
                  {countryOpen && (
                    <div
                      className="absolute top-full left-0 mt-1 z-50 rounded-xl overflow-hidden overflow-y-auto"
                      style={{
                        background: "#1A1A1F",
                        border: "1px solid #2E2E33",
                        boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
                        maxHeight: "240px",
                        minWidth: "220px",
                      }}
                    >
                      {COUNTRIES.map((country) => (
                        <button
                          key={country.code}
                          type="button"
                          onClick={() => {
                            setSelectedCountry(country);
                            setCountryOpen(false);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors hover:bg-white/5"
                          style={{
                            background:
                              selectedCountry.code === country.code
                                ? "rgba(0,98,255,0.1)"
                                : "transparent",
                            color:
                              selectedCountry.code === country.code
                                ? "#4D83FF"
                                : "#F2F2F2",
                          }}
                        >
                          <span className="text-xl leading-none">
                            {country.flag}
                          </span>
                          <span className="flex-1 truncate">
                            {country.name}
                          </span>
                          <span
                            className="text-xs font-bold flex-shrink-0"
                            style={{ color: "#4D83FF" }}
                          >
                            {country.dial}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Número local */}
                <input
                  type="tel"
                  value={form.phoneLocal}
                  onChange={(e) =>
                    setForm({ ...form, phoneLocal: e.target.value })
                  }
                  className="input-base flex-1"
                  placeholder={selectedCountry.placeholder}
                />
              </div>
              <p className="text-xs mt-1" style={{ color: "#6A6A72" }}>
                Se guardará como: {selectedCountry.dial}{" "}
                {form.phoneLocal || selectedCountry.placeholder}
              </p>
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
