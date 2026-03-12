"use client";

import { useFormState } from "react-dom";
import { createBusiness } from "./actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Store, ArrowRight, Sparkles, AlertCircle } from "lucide-react";
import Image from "next/image";

const CATEGORIES = [
  "Barbería",
  "Estética / Belleza",
  "Salón de belleza",
  "Clínica",
  "Consultorio médico",
  "Spa",
  "Entrenador personal",
  "Restaurante",
  "Consultoría",
  "Salud / Medicina",
  "Deportes / Gimnasio",
  "Otros",
];

export default function SetupPage() {
  const [state, formAction] = useFormState(createBusiness, null);

  return (
    <div className="min-h-[80vh] flex items-center justify-center p-4">
      <div className="w-full max-w-lg animate-slide-up">
        {/* Logo Cronix */}
        <div className="flex flex-col items-center mb-10 gap-3">
          <div
            className="h-20 w-20 rounded-3xl overflow-hidden flex-shrink-0"
            style={{
              border: "1px solid rgba(0,98,255,0.25)",
              boxShadow:
                "0 0 40px rgba(0,98,255,0.3), 0 0 80px rgba(0,98,255,0.1)",
            }}
          >
            <Image
              src="/cronix-logo.jpg"
              alt="Cronix"
              width={80}
              height={80}
              className="h-full w-full object-cover"
              unoptimized
            />
          </div>
          <div className="relative h-9 w-36">
            <Image
              src="/cronix-letras.jpg"
              alt="Cronix"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
          <h1
            className="text-3xl sm:text-4xl font-black tracking-tight text-center"
            style={{ color: "#F2F2F2", letterSpacing: "-0.03em" }}
          >
            ¡Bienvenido a Cronix!
          </h1>
          <p className="text-center font-medium" style={{ color: "#909098" }}>
            Sencillez y elegancia para gestionar tu negocio.
          </p>
        </div>

        <Card
          className="p-8 sm:p-10 rounded-[2rem] sm:rounded-[2.5rem]"
          style={{
            borderTop: "4px solid #0062FF",
            background: "rgba(26,26,31,0.95)",
          }}
        >
          <form action={formAction} className="space-y-6">
            {state?.error && (
              <div
                className="p-4 rounded-2xl flex items-start gap-2 text-sm font-bold animate-fade-in"
                style={{
                  background: "rgba(255,59,48,0.08)",
                  border: "1px solid rgba(255,59,48,0.2)",
                  color: "#FF3B30",
                }}
              >
                <AlertCircle size={18} className="mt-0.5 shrink-0" />
                <p>{state.error}</p>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="name"
                  className="flex items-center gap-2 text-sm font-semibold mb-2"
                  style={{ color: "#F2F2F2" }}
                >
                  <Store size={16} style={{ color: "#0062FF" }} />
                  Nombre de tu negocio
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  placeholder="Ej. Barbería El Elegante"
                  className="input-base text-base sm:text-lg py-4 sm:py-6"
                />
              </div>

              <div>
                <label
                  htmlFor="category"
                  className="flex items-center gap-2 text-sm font-semibold mb-2"
                  style={{ color: "#F2F2F2" }}
                >
                  <Sparkles size={16} style={{ color: "#0062FF" }} />
                  Categoría o rubro
                </label>
                <select
                  id="category"
                  name="category"
                  required
                  className="input-base text-base sm:text-lg py-3"
                  style={{ backgroundColor: "#212125" }}
                >
                  <option value="">Selecciona una opción</option>
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-2">
              <Button
                type="submit"
                className="w-full py-4 sm:py-6 text-base sm:text-lg group"
              >
                Crear mi cuenta de negocio
                <ArrowRight
                  size={20}
                  className="ml-2 group-hover:translate-x-1 transition-transform"
                />
              </Button>
            </div>
          </form>
        </Card>

        <p
          className="text-center text-xs mt-8 px-8"
          style={{ color: "#3A3A3F" }}
        >
          Al crear tu negocio, aceptas nuestros términos de servicio y políticas
          de privacidad.
        </p>
      </div>
    </div>
  );
}
