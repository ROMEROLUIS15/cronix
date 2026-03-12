"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { AlertCircle, CheckCircle2, Rocket, Zap, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { register } from "./actions";
import { PasswordInput } from "@/components/ui/password-input";
import { registerSchema } from "@/lib/validations/auth";

const BENEFITS = [
  {
    icon: Rocket,
    title: "Crece rápido",
    desc: "Más reservas con menos esfuerzo manual.",
  },
  {
    icon: Zap,
    title: "Fácil uso",
    desc: "Sin conocimientos técnicos previos.",
  },
  {
    icon: Star,
    title: "Todo en uno",
    desc: "Citas, clientes y finanzas integrados.",
  },
];

export default function RegisterPage() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<
    Record<string, string>
  >({});
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setValidationErrors({});
    const formData = new FormData(e.currentTarget);
    const result = registerSchema.safeParse(
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
      const res = await register(formData);
      if (res?.error) setError(res.error);
      else if (res?.success) setSuccess(res.success);
    });
  };

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row"
      style={{ backgroundColor: "#060608" }}
    >
      {/* ═══════════════════════════════════════
          FORM PANEL — full width mobile, 54% desktop (LEFT on desktop)
      ═══════════════════════════════════════ */}
      <div
        className="flex-1 flex flex-col items-center justify-center relative overflow-hidden order-2 lg:order-1"
        style={{
          background: "linear-gradient(180deg,#0A0A0F 0%,#0D0D14 100%)",
          padding: "clamp(2rem,6vw,5rem) clamp(1.25rem,8vw,5rem)",
        }}
      >
        {/* ambient orb */}
        <div
          style={{
            position: "absolute",
            bottom: "-5%",
            left: "-5%",
            width: "280px",
            height: "280px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle,rgba(56,132,255,0.06) 0%,transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div className="w-full relative z-10" style={{ maxWidth: "400px" }}>
          {/* ── MOBILE header ── */}
          <div
            className="flex flex-col items-center lg:hidden"
            style={{ marginBottom: "2rem" }}
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
          </div>

          {success ? (
            /* ── Success state ── */
            <div style={{ textAlign: "center", padding: "1.5rem 0" }}>
              <div
                className="mx-auto flex items-center justify-center"
                style={{
                  height: "64px",
                  width: "64px",
                  borderRadius: "20px",
                  background: "rgba(48,209,88,0.1)",
                  border: "1px solid rgba(48,209,88,0.2)",
                  marginBottom: "1.25rem",
                }}
              >
                <CheckCircle2 size={32} style={{ color: "#30D158" }} />
              </div>
              <h2
                className="font-black text-white"
                style={{
                  fontSize: "1.75rem",
                  letterSpacing: "-0.025em",
                  marginBottom: "0.5rem",
                }}
              >
                ¡Cuenta creada!
              </h2>
              <p
                style={{
                  color: "#6A6A7A",
                  fontSize: "14px",
                  marginBottom: "1.75rem",
                }}
              >
                {success}
              </p>
              <Link
                href="/login"
                className="inline-flex items-center justify-center"
                style={{
                  padding: "0.875rem 2.5rem",
                  borderRadius: "12px",
                  background: "linear-gradient(135deg,#3884FF 0%,#1A5FDB 100%)",
                  color: "#fff",
                  fontSize: "14px",
                  fontWeight: 700,
                  boxShadow: "0 0 24px rgba(56,132,255,0.35)",
                  textDecoration: "none",
                }}
              >
                Ir a iniciar sesión
              </Link>
            </div>
          ) : (
            <>
              <h1
                className="font-black text-white"
                style={{
                  fontSize: "clamp(1.7rem,4vw,2.25rem)",
                  letterSpacing: "-0.035em",
                  marginBottom: "0.375rem",
                }}
              >
                Crea tu cuenta
              </h1>
              <p
                style={{
                  color: "#6A6A7A",
                  fontSize: "14px",
                  marginBottom: "1.75rem",
                }}
              >
                Empieza a gestionar tu negocio hoy mismo
              </p>

              <form
                onSubmit={handleSubmit}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.875rem",
                }}
              >
                {error && (
                  <div
                    className="flex items-center gap-2.5 animate-fade-in"
                    style={{
                      padding: "0.875rem",
                      borderRadius: "12px",
                      background: "rgba(255,59,48,0.08)",
                      border: "1px solid rgba(255,59,48,0.2)",
                      color: "#FF6B6B",
                    }}
                  >
                    <AlertCircle size={15} style={{ flexShrink: 0 }} />
                    <p style={{ fontSize: "13px", fontWeight: 500 }}>{error}</p>
                  </div>
                )}

                {/* Name row */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "0.75rem",
                  }}
                >
                  <div>
                    <input
                      name="firstName"
                      placeholder="Nombre"
                      className={cn(
                        "input-base w-full",
                        validationErrors.firstName && "border-red-500",
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
                      required
                    />
                    {validationErrors.firstName && (
                      <p
                        style={{
                          color: "#FF6B6B",
                          fontSize: "10px",
                          marginTop: "3px",
                        }}
                      >
                        {validationErrors.firstName}
                      </p>
                    )}
                  </div>
                  <div>
                    <input
                      name="lastName"
                      placeholder="Apellido"
                      className={cn(
                        "input-base w-full",
                        validationErrors.lastName && "border-red-500",
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
                      required
                    />
                    {validationErrors.lastName && (
                      <p
                        style={{
                          color: "#FF6B6B",
                          fontSize: "10px",
                          marginTop: "3px",
                        }}
                      >
                        {validationErrors.lastName}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <input
                    name="bizName"
                    placeholder="Nombre del Negocio"
                    className={cn(
                      "input-base w-full",
                      validationErrors.bizName && "border-red-500",
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
                    required
                  />
                  {validationErrors.bizName && (
                    <p
                      style={{
                        color: "#FF6B6B",
                        fontSize: "10px",
                        marginTop: "3px",
                      }}
                    >
                      {validationErrors.bizName}
                    </p>
                  )}
                </div>

                <div>
                  <input
                    name="email"
                    type="email"
                    placeholder="Email"
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
                    required
                  />
                  {validationErrors.email && (
                    <p
                      style={{
                        color: "#FF6B6B",
                        fontSize: "10px",
                        marginTop: "3px",
                      }}
                    >
                      {validationErrors.email}
                    </p>
                  )}
                </div>

                <div>
                  <PasswordInput
                    name="password"
                    placeholder="Contraseña"
                    className={
                      validationErrors.password ? "border-red-500" : undefined
                    }
                    required
                  />
                  {validationErrors.password && (
                    <p
                      style={{
                        color: "#FF6B6B",
                        fontSize: "10px",
                        marginTop: "3px",
                      }}
                    >
                      {validationErrors.password}
                    </p>
                  )}
                </div>

                <div>
                  <PasswordInput
                    name="confirmPassword"
                    placeholder="Confirmar Contraseña"
                    className={
                      validationErrors.confirmPassword
                        ? "border-red-500"
                        : undefined
                    }
                    required
                  />
                  {validationErrors.confirmPassword && (
                    <p
                      style={{
                        color: "#FF6B6B",
                        fontSize: "10px",
                        marginTop: "3px",
                      }}
                    >
                      {validationErrors.confirmPassword}
                    </p>
                  )}
                </div>

                <button
                  disabled={isPending}
                  type="submit"
                  className="transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
                  style={{
                    width: "100%",
                    padding: "0.875rem",
                    borderRadius: "12px",
                    background:
                      "linear-gradient(135deg,#3884FF 0%,#1A5FDB 100%)",
                    color: "#fff",
                    fontSize: "14px",
                    fontWeight: 700,
                    boxShadow:
                      "0 0 24px rgba(56,132,255,0.35),0 4px 12px rgba(56,132,255,0.2)",
                    border: "none",
                    cursor: "pointer",
                    marginTop: "0.25rem",
                  }}
                >
                  {isPending ? "Procesando..." : "Crear cuenta gratis"}
                </button>
              </form>
            </>
          )}

          <p
            style={{
              textAlign: "center",
              color: "#3A3A4A",
              fontSize: "14px",
              marginTop: "1.75rem",
            }}
          >
            ¿Ya tienes cuenta?{" "}
            <Link
              href="/login"
              className="font-bold hover:opacity-70 transition-opacity"
              style={{ color: "#3884FF" }}
            >
              Inicia sesión
            </Link>
          </p>
        </div>
      </div>

      {/* ═══════════════════════════════════════
          BRAND PANEL — hidden on mobile, 46% desktop (RIGHT on desktop)
      ═══════════════════════════════════════ */}
      <div
        className="hidden lg:flex lg:w-[46%] xl:w-[44%] flex-col relative overflow-hidden order-1 lg:order-2"
        style={{
          background:
            "linear-gradient(160deg,#0A0E1A 0%,#0D1B3E 35%,#0A2472 65%,#1140A0 100%)",
        }}
      >
        {/* decorative orbs */}
        <div
          style={{
            position: "absolute",
            top: "-8%",
            left: "-12%",
            width: "420px",
            height: "420px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle,rgba(56,132,255,0.22) 0%,rgba(56,132,255,0.04) 50%,transparent 70%)",
            filter: "blur(10px)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-5%",
            right: "-8%",
            width: "360px",
            height: "360px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle,rgba(99,179,255,0.12) 0%,transparent 65%)",
            filter: "blur(22px)",
            pointerEvents: "none",
          }}
        />
        {/* grid */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.022) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.022) 1px,transparent 1px)",
            backgroundSize: "48px 48px",
            pointerEvents: "none",
          }}
        />

        <div className="relative z-10 flex flex-col h-full p-10 xl:p-12">
          {/* ── Logo row — big bottom margin ── */}
          <div
            className="flex items-center gap-3 flex-shrink-0"
            style={{ marginBottom: "3rem" }}
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
          </div>

          {/* ── Badge ── */}
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
              style={{
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#63B3FF",
              }}
            >
              Únete gratis hoy
            </span>
          </div>

          {/* ── Headline ── */}
          <h1
            className="font-black text-white"
            style={{
              fontSize: "clamp(2rem,3.2vw,2.65rem)",
              letterSpacing: "-0.035em",
              lineHeight: 1.1,
              marginBottom: "1rem",
            }}
          >
            Impulsa tu negocio,
            <br />
            <span
              style={{
                background: "linear-gradient(90deg,#63B3FF,#A5D8FF)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              simplifica tu vida.
            </span>
          </h1>
          <p
            style={{
              color: "rgba(255,255,255,0.52)",
              fontSize: "15px",
              lineHeight: "1.65",
              maxWidth: "310px",
              marginBottom: "2.5rem",
            }}
          >
            Únete a miles de profesionales que ya automatizan sus citas y
            escalan sus ingresos sin esfuerzo.
          </p>

          {/* ── Stats ── */}
          <div
            className="flex gap-6 xl:gap-8"
            style={{
              marginBottom: "2rem",
              paddingBottom: "2rem",
              borderBottom: "1px solid rgba(56,132,255,0.15)",
            }}
          >
            {[
              { value: "+2,400", label: "Negocios activos" },
              { value: "98%", label: "Satisfacción" },
              { value: "< 2min", label: "Para comenzar" },
            ].map((s) => (
              <div key={s.label}>
                <div
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 900,
                    letterSpacing: "-0.03em",
                    background: "linear-gradient(135deg,#fff 30%,#A5D8FF 100%)",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  {s.value}
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    marginTop: "3px",
                    color: "rgba(165,216,255,0.45)",
                    fontWeight: 600,
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* ── Benefits ── */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.625rem",
            }}
          >
            {BENEFITS.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="flex items-center gap-4"
                style={{
                  padding: "0.9rem 1.1rem",
                  borderRadius: "14px",
                  background: "rgba(56,132,255,0.08)",
                  border: "1px solid rgba(56,132,255,0.22)",
                  boxShadow:
                    "0 2px 12px rgba(56,132,255,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
                  backdropFilter: "blur(8px)",
                }}
              >
                <div
                  className="flex items-center justify-center flex-shrink-0"
                  style={{
                    height: "38px",
                    width: "38px",
                    borderRadius: "12px",
                    background: "rgba(56,132,255,0.25)",
                    border: "1px solid rgba(99,179,255,0.4)",
                    boxShadow: "0 0 10px rgba(56,132,255,0.35)",
                  }}
                >
                  <Icon size={16} style={{ color: "#A5D8FF" }} />
                </div>
                <div>
                  <p
                    style={{
                      fontSize: "13px",
                      fontWeight: 800,
                      color: "#E0EEFF",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {title}
                  </p>
                  <p
                    style={{
                      fontSize: "12px",
                      marginTop: "2px",
                      color: "rgba(165,216,255,0.55)",
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
    </div>
  );
}
