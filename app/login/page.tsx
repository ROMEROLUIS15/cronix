"use client";

import Link from "next/link";
import Image from "next/image";
import { AlertCircle } from "lucide-react";
import { useState, useTransition } from "react";
import { loginSchema } from "@/lib/validations/auth";
import { PasswordInput } from "@/components/ui/password-input";
import { cn } from "@/lib/utils";
import { login, signInWithGoogle } from "./actions";

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
    const data = Object.fromEntries(formData.entries());
    const result = loginSchema.safeParse(data);
    if (!result.success) {
      const errors: Record<string, string> = {};
      result.error.issues.forEach((issue) => {
        if (issue.path[0]) errors[issue.path[0].toString()] = issue.message;
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
      className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ backgroundColor: "#0F0F12" }}
    >
      {/* ── Ambient orbs ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-15%",
            right: "-10%",
            width: "500px",
            height: "500px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(0,98,255,0.10) 0%, transparent 70%)",
            filter: "blur(50px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-10%",
            left: "-5%",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(0,209,255,0.06) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        {/* Subtle grid */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `
            linear-gradient(rgba(0,98,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,98,255,0.025) 1px, transparent 1px)
          `,
            backgroundSize: "60px 60px",
          }}
        />
      </div>

      {/* ── Card ── */}
      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Logo block */}
        <div className="flex flex-col items-center mb-8">
          {/* Symbol */}
          <div
            className="h-16 w-16 rounded-2xl overflow-hidden mb-4 flex-shrink-0"
            style={{
              border: "1px solid rgba(0,98,255,0.2)",
              boxShadow:
                "0 0 30px rgba(0,98,255,0.25), 0 0 60px rgba(0,98,255,0.08)",
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
          {/* Wordmark */}
          <div className="relative h-8 w-32">
            <Image
              src="/cronix-letras.jpg"
              alt="Cronix"
              fill
              className="object-contain"
              unoptimized
            />
          </div>
          {/* Tagline */}
          <p
            className="text-xs font-bold uppercase tracking-widest mt-2"
            style={{ color: "#0062FF" }}
          >
            Gestión inteligente
          </p>
        </div>

        {/* Form card */}
        <div
          className="rounded-2xl p-7"
          style={{ background: "#1A1A1F", border: "1px solid #2E2E33" }}
        >
          <h1
            className="text-xl font-black mb-1"
            style={{ color: "#F2F2F2", letterSpacing: "-0.025em" }}
          >
            Bienvenido de nuevo
          </h1>
          <p className="text-sm mb-6" style={{ color: "#909098" }}>
            Inicia sesión para gestionar tu negocio
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Error */}
            {error && (
              <div
                className="p-3.5 rounded-xl flex items-start gap-2 text-sm font-medium animate-fade-in"
                style={{
                  background: "rgba(255,59,48,0.08)",
                  border: "1px solid rgba(255,59,48,0.2)",
                  color: "#FF3B30",
                }}
              >
                <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                <p>{error}</p>
              </div>
            )}

            {/* Email */}
            <div>
              <label
                className="block text-xs font-bold uppercase tracking-wider mb-2"
                htmlFor="email"
                style={{ color: "#909098" }}
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                placeholder="hola@tuempresa.com"
                className={cn(
                  "input-base",
                  validationErrors.email && "border-red-500",
                )}
              />
              {validationErrors.email && (
                <p className="text-xs mt-1" style={{ color: "#FF3B30" }}>
                  {validationErrors.email}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  className="block text-xs font-bold uppercase tracking-wider"
                  htmlFor="password"
                  style={{ color: "#909098" }}
                >
                  Contraseña
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-semibold transition-colors hover:opacity-80"
                  style={{ color: "#0062FF" }}
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
                <p className="text-xs mt-1" style={{ color: "#FF3B30" }}>
                  {validationErrors.password}
                </p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isPending}
              className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.98] disabled:opacity-50 mt-2"
              style={{
                background: "linear-gradient(135deg, #0062FF, #0041AB)",
                color: "#fff",
                boxShadow: isPending ? "none" : "0 0 20px rgba(0,98,255,0.3)",
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
            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center">
                <div
                  className="w-full"
                  style={{ borderTop: "1px solid #2E2E33" }}
                />
              </div>
              <div className="relative flex justify-center">
                <span
                  className="px-3 text-xs font-medium"
                  style={{ background: "#1A1A1F", color: "#909098" }}
                >
                  o continúa con
                </span>
              </div>
            </div>

            {/* Google */}
            <button
              type="button"
              onClick={() => signInWithGoogle()}
              className="w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-3 transition-all duration-200 active:scale-[0.98] hover:brightness-110"
              style={{
                background: "#212125",
                color: "#F2F2F2",
                border: "1px solid #2E2E33",
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
        </div>

        {/* Register link */}
        <p className="text-center text-sm mt-6" style={{ color: "#909098" }}>
          ¿No tienes cuenta?{" "}
          <Link
            href="/register"
            className="font-bold transition-colors hover:opacity-80"
            style={{ color: "#0062FF" }}
          >
            Regístrate gratis
          </Link>
        </p>
      </div>
    </div>
  );
}
