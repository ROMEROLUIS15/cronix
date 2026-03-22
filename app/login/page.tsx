"use client";

import Link from "next/link";
import Image from "next/image";
import {
  AlertCircle,
  CalendarDays,
  Bell,
  BarChart3,
  Shield,
} from "lucide-react";
import { useState, useTransition, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { loginSchema } from "@/lib/validations/auth";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";
import { login, signInWithGoogle } from "./actions";

const FEATURES = [
  {
    icon: CalendarDays,
    title: "Agenda inteligente",
    desc: "Citas y disponibilidad en tiempo real.",
  },
  {
    icon: Bell,
    title: "Recordatorios automáticos",
    desc: "WhatsApp y email sin esfuerzo.",
  },
  {
    icon: BarChart3,
    title: "Reportes financieros",
    desc: "Métricas de tu negocio al instante.",
  },
  {
    icon: Shield,
    title: "100% seguro",
    desc: "Datos protegidos con cifrado moderno.",
  },
];

/** Reads ?reason=inactivity from URL and calls back if present. Isolated in its
 *  own component so useSearchParams() has a Suspense boundary (Next.js 14 req). */
function InactivityDetector({ onInactivity }: { onInactivity: () => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get('reason') === 'inactivity') onInactivity()
  }, [searchParams, onInactivity])
  return null
}

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setValidationErrors({});
    const formData = new FormData(e.currentTarget);
    const result = loginSchema.safeParse(
      Object.fromEntries(formData.entries()),
    );
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.issues.forEach((i) => {
        if (i.path[0]) errors[i.path[0].toString()] = i.message;
      });
      setValidationErrors(errors);
      return;
    }
    startTransition(async () => {
      const res = await login(formData);
      if (res?.error) setError(res.error);
    });
  };

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row"
      style={{ backgroundColor: "#060608" }}
    >
      <Suspense fallback={null}>
        <InactivityDetector onInactivity={() =>
          setError('Tu sesión expiró por inactividad. Por favor inicia sesión de nuevo.')
        } />
      </Suspense>

      {/* ── BRAND PANEL ── */}
      <div
        className="hidden lg:flex lg:w-[46%] xl:w-[44%] flex-col relative overflow-hidden"
        style={{
          background:
            "linear-gradient(160deg, #0A0E1A 0%, #0D1B3E 35%, #0A2472 65%, #1140A0 100%)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-8%",
            right: "-12%",
            width: "420px",
            height: "420px",
            borderRadius: "50%",
            filter: "blur(10px)",
            pointerEvents: "none",
            background:
              "radial-gradient(circle, rgba(56,132,255,0.22) 0%, rgba(56,132,255,0.04) 50%, transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-5%",
            left: "-8%",
            width: "360px",
            height: "360px",
            borderRadius: "50%",
            filter: "blur(22px)",
            pointerEvents: "none",
            background:
              "radial-gradient(circle, rgba(99,179,255,0.12) 0%, transparent 65%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        <div className="relative z-10 flex flex-col h-full p-10 xl:p-12">
          <Link
            href="/"
            className="flex items-center gap-3 flex-shrink-0"
            style={{ marginBottom: "3rem", textDecoration: "none" }}
          >
            <div
              className="h-10 w-10 rounded-xl overflow-hidden flex-shrink-0"
              style={{
                border: "1px solid rgba(255,255,255,0.15)",
                boxShadow: "0 0 18px rgba(56,132,255,0.45)",
              }}
            >
              <Image
                src="/cronix-logo.jpg"
                alt="Cronix"
                width={40}
                height={40}
                className="h-full w-full object-cover"
                unoptimized
              />
            </div>
            <div
              className="relative"
              style={{ height: "22px", width: "84px", opacity: 0.92 }}
            >
              <Image
                src="/cronix-letras.jpg"
                alt="Cronix"
                fill
                className="object-contain object-left"
                unoptimized
              />
            </div>
          </Link>

          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full self-start"
            style={{
              marginBottom: "1.5rem",
              background: "rgba(56,132,255,0.15)",
              border: "1px solid rgba(56,132,255,0.3)",
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full animate-pulse"
              style={{ background: "#63B3FF" }}
            />
            <span
              className="text-xs font-bold tracking-widest uppercase"
              style={{ color: "#63B3FF" }}
            >
              Plataforma SaaS
            </span>
          </div>

          <h1
            className="text-4xl xl:text-[2.65rem] font-black leading-[1.1] text-white"
            style={{ letterSpacing: "-0.035em", marginBottom: "1.1rem" }}
          >
            Tu negocio en
            <br />
            <span
              style={{
                background: "linear-gradient(90deg,#63B3FF,#A5D8FF)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              control total.
            </span>
          </h1>
          <p
            style={{
              color: "rgba(255,255,255,0.52)",
              fontSize: "15px",
              lineHeight: "1.65",
              maxWidth: "310px",
              marginBottom: "2.2rem",
            }}
          >
            Gestiona citas, clientes y finanzas desde un panel moderno accesible
            desde cualquier dispositivo.
          </p>

          {/* Dashboard mockup */}
          <div
            style={{
              borderRadius: "16px",
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.09)",
              boxShadow:
                "0 24px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(56,132,255,0.08)",
              background: "#0C0C10",
              marginBottom: "2rem",
            }}
          >
            <div
              className="flex items-center gap-1.5 px-4 py-2.5"
              style={{
                background: "#141418",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: "#FF3B30" }}
              />
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: "#FFD60A" }}
              />
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: "#30D158" }}
              />
              <div
                className="ml-3 px-3 py-0.5 rounded-md"
                style={{
                  background: "#0C0C10",
                  color: "#6A6A72",
                  fontSize: "10px",
                  border: "1px solid #1E1E22",
                }}
              >
                app.cronix.io
              </div>
            </div>
            <div className="flex" style={{ minHeight: "128px" }}>
              <div
                className="flex-shrink-0 p-2.5 space-y-1"
                style={{
                  width: "96px",
                  background: "#0E0E12",
                  borderRight: "1px solid #1A1A1E",
                }}
              >
                {["Agenda", "Clientes", "Finanzas", "Reportes"].map(
                  (item, i) => (
                    <div
                      key={item}
                      className="px-2.5 py-1.5 rounded-lg"
                      style={{
                        fontSize: "9px",
                        fontWeight: 700,
                        background:
                          i === 0 ? "rgba(56,132,255,0.15)" : "transparent",
                        color: i === 0 ? "#63B3FF" : "#4A4A52",
                      }}
                    >
                      {item}
                    </div>
                  ),
                )}
              </div>
              <div className="flex-1 p-3 space-y-2">
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { l: "Citas hoy", v: "8", c: "#63B3FF" },
                    { l: "Clientes", v: "124", c: "#30D158" },
                    { l: "Ingresos", v: "$4.2k", c: "#FFD60A" },
                  ].map((s) => (
                    <div
                      key={s.l}
                      className="p-2 rounded-lg"
                      style={{
                        background: "#161619",
                        border: "1px solid #222226",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: 900,
                          color: s.c,
                        }}
                      >
                        {s.v}
                      </div>
                      <div
                        style={{
                          fontSize: "8px",
                          marginTop: "2px",
                          color: "#4A4A52",
                        }}
                      >
                        {s.l}
                      </div>
                    </div>
                  ))}
                </div>
                <div
                  className="rounded-lg p-2.5"
                  style={{ background: "#161619", border: "1px solid #222226" }}
                >
                  <div
                    style={{
                      fontSize: "8px",
                      fontWeight: 700,
                      marginBottom: "6px",
                      color: "#F2F2F2",
                    }}
                  >
                    Próximas citas
                  </div>
                  {[
                    { name: "María G.", time: "09:00", c: "#63B3FF" },
                    { name: "Carlos R.", time: "10:30", c: "#30D158" },
                  ].map((a) => (
                    <div
                      key={a.name}
                      className="flex items-center gap-1.5 mb-1"
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{ background: a.c }}
                      />
                      <span style={{ fontSize: "8px", color: "#C0C0C8" }}>
                        {a.name}
                      </span>
                      <span
                        style={{
                          fontSize: "8px",
                          color: "#4A4A52",
                          marginLeft: "auto",
                        }}
                      >
                        {a.time}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5 mt-auto">
            {FEATURES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="flex items-start gap-2.5 p-3 rounded-xl"
                style={{
                  background: "rgba(56,132,255,0.08)",
                  border: "1px solid rgba(56,132,255,0.22)",
                  boxShadow:
                    "0 2px 12px rgba(56,132,255,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
                  backdropFilter: "blur(8px)",
                }}
              >
                <div
                  className="h-7 w-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{
                    background: "rgba(56,132,255,0.25)",
                    border: "1px solid rgba(99,179,255,0.4)",
                    boxShadow: "0 0 8px rgba(56,132,255,0.3)",
                  }}
                >
                  <Icon size={13} style={{ color: "#A5D8FF" }} />
                </div>
                <div>
                  <p
                    style={{
                      fontSize: "11px",
                      fontWeight: 800,
                      color: "#E0EEFF",
                      lineHeight: "1.3",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {title}
                  </p>
                  <p
                    style={{
                      fontSize: "10px",
                      marginTop: "3px",
                      color: "rgba(165,216,255,0.55)",
                      lineHeight: "1.35",
                    }}
                  >
                    {desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── FORM PANEL ── */}
      <div
        className="flex-1 flex flex-col items-center justify-center relative overflow-hidden"
        style={{
          background: "linear-gradient(180deg,#0A0A0F 0%,#0D0D14 100%)",
          padding: "clamp(2rem,6vw,5rem) clamp(1.25rem,8vw,5rem)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-5%",
            right: "-5%",
            width: "280px",
            height: "280px",
            borderRadius: "50%",
            pointerEvents: "none",
            background:
              "radial-gradient(circle,rgba(56,132,255,0.06) 0%,transparent 70%)",
          }}
        />

        <div className="w-full relative z-10" style={{ maxWidth: "400px" }}>
          {/* Mobile logo */}
          <Link
            href="/"
            className="flex flex-col items-center lg:hidden"
            style={{ marginBottom: "2rem", textDecoration: "none" }}
          >
            <div
              className="h-16 w-16 rounded-2xl overflow-hidden"
              style={{
                border: "1px solid rgba(56,132,255,0.3)",
                boxShadow: "0 0 28px rgba(56,132,255,0.22)",
                marginBottom: "0.75rem",
              }}
            >
              <Image
                src="/cronix-logo.jpg"
                alt="Cronix"
                width={64}
                height={64}
                className="h-full w-full object-cover"
                unoptimized
              />
            </div>
            <div
              className="relative"
              style={{ height: "28px", width: "112px" }}
            >
              <Image
                src="/cronix-letras.jpg"
                alt="Cronix"
                fill
                className="object-contain"
                unoptimized
              />
            </div>
            <p
              style={{
                color: "#3884FF",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginTop: "6px",
              }}
            >
              Gestión Inteligente
            </p>
          </Link>

          <h1
            className="font-black text-white"
            style={{
              fontSize: "clamp(1.7rem,4vw,2.25rem)",
              letterSpacing: "-0.035em",
              marginBottom: "0.375rem",
            }}
          >
            Bienvenido de nuevo
          </h1>
          <p
            style={{ color: "#6A6A7A", fontSize: "14px", marginBottom: "2rem" }}
          >
            Inicia sesión para gestionar tu negocio
          </p>

          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            {/* ── Error banner estilo GitHub/Notion ── */}
            {error && (
              <div
                className="animate-fade-in"
                style={{
                  padding: "0.875rem 1rem",
                  borderRadius: "12px",
                  background: "rgba(255,59,48,0.08)",
                  border: "1px solid rgba(255,59,48,0.2)",
                }}
              >
                <div
                  className="flex items-start gap-2.5"
                  style={{ marginBottom: "0.5rem" }}
                >
                  <AlertCircle
                    size={16}
                    style={{
                      color: "#FF6B6B",
                      marginTop: "1px",
                      flexShrink: 0,
                    }}
                  />
                  <p
                    style={{
                      fontSize: "13px",
                      fontWeight: 500,
                      color: "#FF6B6B",
                    }}
                  >
                    {error}
                  </p>
                </div>
                {/* Caminos de salida — estilo GitHub */}
                <div
                  className="flex items-center gap-3"
                  style={{ paddingLeft: "1.5rem" }}
                >
                  <Link
                    href="/register"
                    className="hover:opacity-70 transition-opacity"
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#FF6B6B",
                      textDecoration: "underline",
                    }}
                  >
                    ¿No tienes cuenta? Regístrate
                  </Link>
                  <span
                    style={{ color: "rgba(255,107,107,0.3)", fontSize: "12px" }}
                  >
                    ·
                  </span>
                  <Link
                    href="/forgot-password"
                    className="hover:opacity-70 transition-opacity"
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#FF6B6B",
                      textDecoration: "underline",
                    }}
                  >
                    Recuperar contraseña
                  </Link>
                </div>
              </div>
            )}

            {/* Email */}
            <div>
              <label
                htmlFor="email"
                className="block"
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "#4A4A5A",
                  marginBottom: "8px",
                }}
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="hola@tuempresa.com"
                className={cn(
                  "input-base w-full",
                  validationErrors.email && "border-red-500",
                )}
                style={{
                  background: "#13131A",
                  border: "1px solid #22222E",
                  color: "#F2F2F2",
                  borderRadius: "10px",
                  padding: "0.75rem 1rem",
                  fontSize: "14px",
                  outline: "none",
                  width: "100%",
                }}
              />
              {validationErrors.email && (
                <p
                  style={{
                    color: "#FF6B6B",
                    fontSize: "12px",
                    marginTop: "4px",
                  }}
                >
                  {validationErrors.email}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <div
                className="flex items-center justify-between"
                style={{ marginBottom: "8px" }}
              >
                <label
                  htmlFor="password"
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.12em",
                    color: "#4A4A5A",
                  }}
                >
                  Contraseña
                </label>
                <Link
                  href="/forgot-password"
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#3884FF",
                  }}
                  className="hover:opacity-70 transition-opacity"
                >
                  ¿Olvidaste tu contraseña?
                </Link>
              </div>
              <PasswordInput
                id="password"
                name="password"
                placeholder="••••••••"
                className={
                  validationErrors.password ? "border-red-500" : undefined
                }
              />
              {validationErrors.password && (
                <p
                  style={{
                    color: "#FF6B6B",
                    fontSize: "12px",
                    marginTop: "4px",
                  }}
                >
                  {validationErrors.password}
                </p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isPending}
              className="flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
              style={{
                width: "100%",
                padding: "0.875rem",
                borderRadius: "12px",
                background: "linear-gradient(135deg,#3884FF 0%,#1A5FDB 100%)",
                color: "#fff",
                fontSize: "14px",
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                boxShadow: isPending
                  ? "none"
                  : "0 0 24px rgba(56,132,255,0.35),0 4px 12px rgba(56,132,255,0.2)",
              }}
            >
              {isPending ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Iniciando sesión...
                </>
              ) : (
                "Iniciar sesión"
              )}
            </button>

            {/* Divider */}
            <div className="relative" style={{ margin: "0.25rem 0" }}>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                <div
                  style={{ width: "100%", borderTop: "1px solid #1A1A24" }}
                />
              </div>
              <div
                style={{
                  position: "relative",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <span
                  style={{
                    padding: "0 1rem",
                    background: "#0A0A0F",
                    color: "#3A3A4A",
                    fontSize: "12px",
                  }}
                >
                  o continúa con
                </span>
              </div>
            </div>

            {/* Google */}
            <button
              type="button"
              onClick={() => signInWithGoogle()}
              className="flex items-center justify-center gap-3 transition-all duration-200 active:scale-[0.98] hover:brightness-125"
              style={{
                width: "100%",
                padding: "0.875rem",
                borderRadius: "12px",
                background: "#13131A",
                color: "#D0D0DC",
                border: "1px solid #22222E",
                fontSize: "14px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Ingresar con Google
            </button>
          </form>

          <p
            className="text-center"
            style={{ color: "#3A3A4A", fontSize: "14px", marginTop: "1.75rem" }}
          >
            ¿No tienes cuenta?{" "}
            <Link
              href="/register"
              className="font-bold hover:opacity-70 transition-opacity"
              style={{ color: "#3884FF" }}
            >
              Regístrate gratis
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
