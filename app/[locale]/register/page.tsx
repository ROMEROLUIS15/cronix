"use client";

import { useState, useTransition, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { AlertCircle, CheckCircle2, Rocket, Zap, Star, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { register } from "./actions";
import { signUpWithGoogle } from "@/lib/actions/auth";
import { PasswordInput } from "@/components/ui/password-input";
import { registerSchema } from "@/lib/validations/auth";
import { BUSINESS_CATEGORIES } from "@/lib/constants/business";

type OAuthError = "google_not_registered" | null;

const BENEFITS = [
  { icon: Rocket, title: "Crece rápido",  desc: "Más reservas con menos esfuerzo manual."   },
  { icon: Zap,    title: "Fácil uso",     desc: "Sin conocimientos técnicos previos."        },
  { icon: Star,   title: "Todo en uno",   desc: "Citas, clientes y finanzas integrados."     },
];

const OAUTH_ERROR_MESSAGES: Record<NonNullable<OAuthError>, { title: string; body: string }> = {
  google_not_registered: {
    title: "Tu cuenta de Google no está registrada",
    body:  "Para ingresar con Google primero debes crear tu cuenta en Cronix. Completa el formulario y luego podrás usar Google para iniciar sesión.",
  },
}

function RegisterForm() {
  const searchParams = useSearchParams();
  const rawError    = searchParams.get("error") as OAuthError;
  const oauthError  = rawError && rawError in OAUTH_ERROR_MESSAGES ? rawError : null;
  const oauthMsg    = oauthError ? OAUTH_ERROR_MESSAGES[oauthError] : null;

  const [error,            setError]            = useState<string | null>(null);
  const [success,          setSuccess]          = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [isPending,        startTransition]     = useTransition();

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setValidationErrors({});

    const formData = new FormData(e.currentTarget);
    const result   = registerSchema.safeParse(Object.fromEntries(formData.entries()));

    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.issues.forEach(i => {
        if (i.path[0]) errors[i.path[0].toString()] = i.message;
      });
      setValidationErrors(errors);
      return;
    }

    startTransition(async () => {
      const res = await register(formData);
      if (res?.error)        setError(res.error);
      else if (res?.success) setSuccess(res.success);
    });
  };

  const inputStyle: React.CSSProperties = {
    background:   "#13131A",
    border:       "1px solid #22222E",
    color:        "#F2F2F2",
    borderRadius: "10px",
    padding:      "0.75rem 1rem",
    fontSize:     "14px",
    outline:      "none",
    width:        "100%",
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row" style={{ backgroundColor: "#060608" }}>

      {/* ── FORM PANEL ── */}
      <div
        className="flex-1 flex flex-col items-center justify-center relative overflow-hidden order-2 lg:order-1"
        style={{
          background: "linear-gradient(180deg,#0A0A0F 0%,#0D0D14 100%)",
          padding:    "clamp(2rem,6vw,5rem) clamp(1.25rem,8vw,5rem)",
        }}
      >
        <div style={{ position:"absolute", bottom:"-5%", left:"-5%", width:"280px", height:"280px",
          borderRadius:"50%", pointerEvents:"none",
          background:"radial-gradient(circle,rgba(56,132,255,0.06) 0%,transparent 70%)" }} />

        <div className="w-full relative z-10" style={{ maxWidth: "400px" }}>

          {/* Mobile logo */}
          <Link href="/" className="flex flex-col items-center lg:hidden"
            style={{ marginBottom: "2rem", textDecoration: "none" }}>
            <div className="h-16 w-16 rounded-2xl overflow-hidden"
              style={{ border:"1px solid rgba(56,132,255,0.3)", boxShadow:"0 0 28px rgba(56,132,255,0.22)", marginBottom:"0.75rem" }}>
              <Image src="/cronix-logo.jpg" alt="Cronix" width={64} height={64}
                className="h-full w-full object-cover" sizes="64px" />
            </div>
            <div className="relative" style={{ height:"28px", width:"112px" }}>
              <Image src="/cronix-letras.jpg" alt="Cronix" fill className="object-contain" sizes="112px" />
            </div>
            <p style={{ color:"#3884FF", fontSize:"11px", fontWeight:700,
              letterSpacing:"0.12em", textTransform:"uppercase", marginTop:"6px" }}>
              Gestión Inteligente
            </p>
          </Link>

          {/* OAuth error banner */}
          {oauthMsg && (
            <div className="animate-fade-in"
              style={{ marginBottom:"1.5rem", padding:"1rem 1.125rem", borderRadius:"14px",
                background:"rgba(255,214,10,0.06)", border:"1px solid rgba(255,214,10,0.25)" }}>
              <div className="flex items-start gap-2.5" style={{ marginBottom:"0.5rem" }}>
                <AlertCircle size={16} style={{ color:"#FFD60A", flexShrink:0, marginTop:"1px" }} />
                <p style={{ fontSize:"13px", fontWeight:700, color:"#FFD60A" }}>{oauthMsg.title}</p>
              </div>
              <p style={{ fontSize:"12px", color:"rgba(255,214,10,0.75)", lineHeight:"1.55", paddingLeft:"1.4rem" }}>
                {oauthMsg.body}
              </p>
              <div className="flex items-center gap-2"
                style={{ marginTop:"0.875rem", paddingTop:"0.75rem",
                  borderTop:"1px solid rgba(255,214,10,0.15)", paddingLeft:"1.4rem" }}>
                <span style={{ fontSize:"12px", color:"rgba(255,214,10,0.55)" }}>¿Ya tienes cuenta?</span>
                <Link href="/login"
                  className="inline-flex items-center gap-1 transition-opacity hover:opacity-70"
                  style={{ fontSize:"12px", fontWeight:700, color:"#FFD60A" }}>
                  <LogIn size={12} /> Iniciar sesión
                </Link>
              </div>
            </div>
          )}

          {/* Success state */}
          {success ? (
            <div style={{ padding:"0.5rem 0" }}>

              {/* Icon + title */}
              <div className="flex flex-col items-center" style={{ marginBottom:"1.75rem" }}>
                <div className="flex items-center justify-center"
                  style={{ height:"72px", width:"72px", borderRadius:"24px",
                    background:"rgba(48,209,88,0.12)", border:"1px solid rgba(48,209,88,0.25)",
                    boxShadow:"0 0 32px rgba(48,209,88,0.15)", marginBottom:"1.25rem" }}>
                  <CheckCircle2 size={36} style={{ color:"#30D158" }} />
                </div>
                <h2 className="font-black text-white"
                  style={{ fontSize:"1.75rem", letterSpacing:"-0.025em", marginBottom:"0.375rem", textAlign:"center" }}>
                  ¡Cuenta creada!
                </h2>
                <p style={{ color:"#6A6A7A", fontSize:"14px", textAlign:"center" }}>
                  Solo falta un paso más para entrar
                </p>
              </div>

              {/* Step-by-step instruction card */}
              <div style={{ padding:"1.25rem", borderRadius:"16px",
                background:"rgba(56,132,255,0.06)", border:"1px solid rgba(56,132,255,0.2)",
                marginBottom:"1.5rem" }}>
                <p style={{ fontSize:"11px", fontWeight:700, letterSpacing:"0.1em",
                  textTransform:"uppercase", color:"#3884FF", marginBottom:"0.875rem" }}>
                  ¿Qué hacer ahora?
                </p>
                {[
                  { step:"1", text:"Revisa tu bandeja de entrada" },
                  { step:"2", text:"Abre el correo de confirmación de Cronix" },
                  { step:"3", text:"Haz clic en el enlace para activar tu cuenta" },
                ].map(({ step, text }) => (
                  <div key={step} className="flex items-center gap-3" style={{ marginBottom:"0.625rem" }}>
                    <div className="flex items-center justify-center flex-shrink-0"
                      style={{ height:"26px", width:"26px", borderRadius:"50%",
                        background:"rgba(56,132,255,0.15)", border:"1px solid rgba(56,132,255,0.3)" }}>
                      <span style={{ fontSize:"11px", fontWeight:900, color:"#3884FF" }}>{step}</span>
                    </div>
                    <p style={{ fontSize:"13px", color:"#C0C0CC", fontWeight:500 }}>{text}</p>
                  </div>
                ))}
                <p style={{ fontSize:"12px", color:"#4A4A5A", marginTop:"0.875rem",
                  paddingTop:"0.75rem", borderTop:"1px solid rgba(56,132,255,0.1)" }}>
                  ¿No ves el correo? Revisa la carpeta de <span style={{ color:"#3884FF", fontWeight:600 }}>spam o correo no deseado</span>.
                </p>
              </div>

              <Link href="/login" className="inline-flex items-center justify-center w-full"
                style={{ padding:"0.875rem 2.5rem", borderRadius:"12px",
                  background:"linear-gradient(135deg,#3884FF 0%,#1A5FDB 100%)",
                  color:"#fff", fontSize:"14px", fontWeight:700,
                  boxShadow:"0 0 24px rgba(56,132,255,0.35)", textDecoration:"none" }}>
                Ir a iniciar sesión
              </Link>
            </div>

          ) : (
            <>
              <h1 className="font-black text-white"
                style={{ fontSize:"clamp(1.7rem,4vw,2.25rem)", letterSpacing:"-0.035em", marginBottom:"0.375rem" }}>
                Crea tu cuenta
              </h1>
              <p style={{ color:"#6A6A7A", fontSize:"14px", marginBottom:"1.75rem" }}>
                Empieza a gestionar tu negocio hoy mismo
              </p>

              <form onSubmit={handleSubmit}
                style={{ display:"flex", flexDirection:"column", gap:"0.875rem" }}>
                <input type="hidden" name="timezone" value={Intl.DateTimeFormat().resolvedOptions().timeZone} />

                {/* Server error */}
                {error && (
                  <div className="flex items-center gap-2.5 animate-fade-in"
                    style={{ padding:"0.875rem", borderRadius:"12px",
                      background:"rgba(255,59,48,0.08)", border:"1px solid rgba(255,59,48,0.2)", color:"#FF6B6B" }}>
                    <AlertCircle size={15} style={{ flexShrink:0 }} />
                    <p style={{ fontSize:"13px", fontWeight:500 }}>{error}</p>
                  </div>
                )}

                {/* Name row */}
                <div className="grid grid-cols-1 xs:grid-cols-2 gap-3">
                  <div>
                    <input name="firstName" placeholder="Nombre" required
                      className={cn("input-base w-full", validationErrors.firstName && "border-red-500")}
                      style={inputStyle} />
                    {validationErrors.firstName && (
                      <p style={{ color:"#FF6B6B", fontSize:"10px", marginTop:"3px" }}>{validationErrors.firstName}</p>
                    )}
                  </div>
                  <div>
                    <input name="lastName" placeholder="Apellido" required
                      className={cn("input-base w-full", validationErrors.lastName && "border-red-500")}
                      style={inputStyle} />
                    {validationErrors.lastName && (
                      <p style={{ color:"#FF6B6B", fontSize:"10px", marginTop:"3px" }}>{validationErrors.lastName}</p>
                    )}
                  </div>
                </div>

                {/* Business */}
                <div>
                  <input name="bizName" placeholder="Nombre del Negocio" required
                    className={cn("input-base w-full", validationErrors.bizName && "border-red-500")}
                    style={inputStyle} />
                  {validationErrors.bizName && (
                    <p style={{ color:"#FF6B6B", fontSize:"10px", marginTop:"3px" }}>{validationErrors.bizName}</p>
                  )}
                </div>

                {/* Business category */}
                <div>
                  <select name="bizCategory" required
                    className={cn("input-base w-full", validationErrors.bizCategory && "border-red-500")}
                    style={{ ...inputStyle, backgroundColor: "#13131A" }}
                    defaultValue="">
                    <option value="" disabled>Tipo de negocio</option>
                    {BUSINESS_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  {validationErrors.bizCategory && (
                    <p style={{ color:"#FF6B6B", fontSize:"10px", marginTop:"3px" }}>{validationErrors.bizCategory}</p>
                  )}
                </div>

                {/* Email */}
                <div>
                  <input name="email" type="email" placeholder="Email" required
                    className={cn("input-base w-full", validationErrors.email && "border-red-500")}
                    style={inputStyle} />
                  {validationErrors.email && (
                    <p style={{ color:"#FF6B6B", fontSize:"10px", marginTop:"3px" }}>{validationErrors.email}</p>
                  )}
                </div>

                {/* Password */}
                <div>
                  <PasswordInput name="password" placeholder="Contraseña" required
                    className={validationErrors.password ? "border-red-500" : undefined} />
                  {validationErrors.password && (
                    <p style={{ color:"#FF6B6B", fontSize:"10px", marginTop:"3px" }}>{validationErrors.password}</p>
                  )}
                </div>

                {/* Confirm password */}
                <div>
                  <PasswordInput name="confirmPassword" placeholder="Confirmar Contraseña" required
                    className={validationErrors.confirmPassword ? "border-red-500" : undefined} />
                  {validationErrors.confirmPassword && (
                    <p style={{ color:"#FF6B6B", fontSize:"10px", marginTop:"3px" }}>{validationErrors.confirmPassword}</p>
                  )}
                </div>

                {/* Submit */}
                <button type="submit" disabled={isPending}
                  className="transition-all duration-200 active:scale-[0.98] disabled:opacity-50"
                  style={{ width:"100%", padding:"0.875rem", borderRadius:"12px",
                    background:"linear-gradient(135deg,#3884FF 0%,#1A5FDB 100%)",
                    color:"#fff", fontSize:"14px", fontWeight:700, border:"none", cursor:"pointer", marginTop:"0.25rem",
                    boxShadow:"0 0 24px rgba(56,132,255,0.35),0 4px 12px rgba(56,132,255,0.2)" }}>
                  {isPending ? "Procesando..." : "Crear cuenta gratis"}
                </button>

                {/* Divider */}
                <div className="relative" style={{ margin:"0.25rem 0" }}>
                  <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center" }}>
                    <div style={{ width:"100%", borderTop:"1px solid #1A1A24" }} />
                  </div>
                  <div style={{ position:"relative", display:"flex", justifyContent:"center" }}>
                    <span style={{ padding:"0 1rem", background:"#0A0A0F", color:"#3A3A4A", fontSize:"12px" }}>
                      o regístrate con
                    </span>
                  </div>
                </div>

                {/* Google */}
                <button type="button" onClick={() => signUpWithGoogle()}
                  className="flex items-center justify-center gap-3 transition-all duration-200 active:scale-[0.98] hover:brightness-125"
                  style={{ width:"100%", padding:"0.875rem", borderRadius:"12px",
                    background:"#13131A", color:"#D0D0DC", border:"1px solid #22222E",
                    fontSize:"14px", fontWeight:600, cursor:"pointer" }}>
                  <svg className="h-4 w-4" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Google
                </button>
              </form>
            </>
          )}

          <p style={{ textAlign:"center", color:"#3A3A4A", fontSize:"14px", marginTop:"1.75rem" }}>
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="font-bold hover:opacity-70 transition-opacity"
              style={{ color:"#3884FF" }}>
              Inicia sesión
            </Link>
          </p>
        </div>
      </div>

      {/* ── BRAND PANEL ── */}
      <div className="hidden lg:flex lg:w-[46%] xl:w-[44%] flex-col relative overflow-hidden order-1 lg:order-2"
        style={{ background:"linear-gradient(160deg,#0A0E1A 0%,#0D1B3E 35%,#0A2472 65%,#1140A0 100%)" }}>

        <div style={{ position:"absolute", top:"-8%", left:"-12%", width:"420px", height:"420px",
          borderRadius:"50%", filter:"blur(10px)", pointerEvents:"none",
          background:"radial-gradient(circle,rgba(56,132,255,0.22) 0%,rgba(56,132,255,0.04) 50%,transparent 70%)" }} />
        <div style={{ position:"absolute", bottom:"-5%", right:"-8%", width:"360px", height:"360px",
          borderRadius:"50%", filter:"blur(22px)", pointerEvents:"none",
          background:"radial-gradient(circle,rgba(99,179,255,0.12) 0%,transparent 65%)" }} />
        <div style={{ position:"absolute", inset:0, pointerEvents:"none",
          backgroundImage:"linear-gradient(rgba(255,255,255,0.022) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.022) 1px,transparent 1px)",
          backgroundSize:"48px 48px" }} />

        <div className="relative z-10 flex flex-col h-full p-10 xl:p-12">

          <Link href="/" className="flex items-center gap-3 flex-shrink-0"
            style={{ marginBottom:"3rem", textDecoration:"none" }}>
            <div className="h-10 w-10 rounded-xl overflow-hidden flex-shrink-0"
              style={{ border:"1px solid rgba(255,255,255,0.15)", boxShadow:"0 0 18px rgba(56,132,255,0.45)" }}>
              <Image src="/cronix-logo.jpg" alt="Cronix" width={40} height={40}
                className="h-full w-full object-cover" sizes="40px" />
            </div>
            <div className="relative" style={{ height:"22px", width:"84px", opacity:0.92 }}>
              <Image src="/cronix-letras.jpg" alt="Cronix" fill className="object-contain object-left" sizes="84px" />
            </div>
          </Link>

          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full self-start"
            style={{ marginBottom:"1.5rem", background:"rgba(56,132,255,0.15)", border:"1px solid rgba(56,132,255,0.3)" }}>
            <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background:"#63B3FF" }} />
            <span style={{ fontSize:"11px", fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase", color:"#63B3FF" }}>
              Únete gratis hoy
            </span>
          </div>

          <h1 className="font-black text-white"
            style={{ fontSize:"clamp(2rem,3.2vw,2.65rem)", letterSpacing:"-0.035em", lineHeight:1.1, marginBottom:"1rem" }}>
            Impulsa tu negocio,<br />
            <span style={{ background:"linear-gradient(90deg,#63B3FF,#A5D8FF)",
              WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
              simplifica tu vida.
            </span>
          </h1>
          <p style={{ color:"rgba(255,255,255,0.52)", fontSize:"15px", lineHeight:"1.65", maxWidth:"310px", marginBottom:"2.5rem" }}>
            Únete a miles de profesionales que ya automatizan sus citas y escalan sus ingresos sin esfuerzo.
          </p>

          <div className="flex gap-6 xl:gap-8"
            style={{ marginBottom:"2rem", paddingBottom:"2rem", borderBottom:"1px solid rgba(56,132,255,0.15)" }}>
            {[
              { value:"+2,400", label:"Negocios activos" },
              { value:"98%",    label:"Satisfacción"     },
              { value:"< 2min", label:"Para comenzar"    },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize:"1.5rem", fontWeight:900, letterSpacing:"-0.03em",
                  background:"linear-gradient(135deg,#fff 30%,#A5D8FF 100%)",
                  WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
                  {s.value}
                </div>
                <div style={{ fontSize:"11px", marginTop:"3px", color:"rgba(165,216,255,0.45)", fontWeight:600 }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display:"flex", flexDirection:"column", gap:"0.625rem" }}>
            {BENEFITS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-center gap-4"
                style={{ padding:"0.9rem 1.1rem", borderRadius:"14px",
                  background:"rgba(56,132,255,0.08)", border:"1px solid rgba(56,132,255,0.22)",
                  boxShadow:"0 2px 12px rgba(56,132,255,0.08),inset 0 1px 0 rgba(255,255,255,0.04)",
                  backdropFilter:"blur(8px)" }}>
                <div className="flex items-center justify-center flex-shrink-0"
                  style={{ height:"38px", width:"38px", borderRadius:"12px",
                    background:"rgba(56,132,255,0.25)", border:"1px solid rgba(99,179,255,0.4)",
                    boxShadow:"0 0 10px rgba(56,132,255,0.35)" }}>
                  <Icon size={16} style={{ color:"#A5D8FF" }} />
                </div>
                <div>
                  <p style={{ fontSize:"13px", fontWeight:800, color:"#E0EEFF", letterSpacing:"-0.01em" }}>{title}</p>
                  <p style={{ fontSize:"12px", marginTop:"2px", color:"rgba(165,216,255,0.55)" }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#060608" }}>
        <div className="animate-pulse" style={{ color: "#3884FF" }}>Cargando...</div>
      </div>
    }>
      <RegisterForm />
    </Suspense>
  );
}