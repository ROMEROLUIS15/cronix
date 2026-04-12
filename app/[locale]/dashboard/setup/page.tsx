"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useFormState } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { createBusiness } from "./actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Store, ArrowRight, Sparkles, AlertCircle, Loader2 } from "lucide-react";
import Image from "next/image";
import { BUSINESS_CATEGORIES } from "@/lib/constants/business";
import { useTranslations } from "next-intl";

export default function SetupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [state, formAction] = useFormState(createBusiness, null);
  const [initialData, setInitialData] = useState<{ name: string; category: string } | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const t = useTranslations("setup");

  // When the server action returns success, clear the stale React Query cache for
  // business-context before navigating. Without this, the dashboard page renders
  // with the cached null businessId and shows "Configurar mi negocio" again,
  // causing the setup → dashboard → setup redirect loop.
  useEffect(() => {
    if (state?.success) {
      queryClient.removeQueries({ queryKey: ['business-context'] });
      router.push('/dashboard');
    }
  }, [state, queryClient, router]);

  useEffect(() => {
    async function getUserData() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user?.user_metadata) {
        setInitialData({
          name: user.user_metadata.biz_name || "",
          category: user.user_metadata.biz_category || "",
        });
      }
      setLoadingUser(false);
    }
    getUserData();
  }, [router]);

  if (loadingUser) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

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
              sizes="80px"
              priority
            />
          </div>
          <div className="relative h-9 w-36">
            <Image
              src="/cronix-letras.jpg"
              alt="Cronix"
              fill
              className="object-contain"
              sizes="144px"
              priority
            />
          </div>
          <h1
            className="text-3xl sm:text-4xl font-black tracking-tight text-center"
            style={{ color: "#F2F2F2", letterSpacing: "-0.03em" }}
          >
            {t('welcome')}
          </h1>
          <p className="text-center font-medium" style={{ color: "#909098" }}>
            {t('subtitle')}
          </p>
        </div>

        <Card
          className="p-5 sm:p-8 md:p-10 rounded-[2rem] sm:rounded-[2.5rem]"
          style={{
            borderTop: "4px solid #0062FF",
            background: "rgba(26,26,31,0.95)",
          }}
        >
          <form action={formAction} className="space-y-6">
            <input type="hidden" name="timezone" value={typeof window !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'America/Caracas'} />
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
                  {t('bizNameLabel')}
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  defaultValue={initialData?.name}
                  placeholder={t('bizNamePlace')}
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
                  {t('categoryLabel')}
                </label>
                <select
                  id="category"
                  name="category"
                  required
                  defaultValue={initialData?.category}
                  className="input-base text-base sm:text-lg py-3"
                  style={{ backgroundColor: "#212125" }}
                >
                  <option value="">{t('categoryPlace')}</option>
                  {BUSINESS_CATEGORIES.map((cat) => (
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
                {t('createBtn')}
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
          {t('terms')}
        </p>
      </div>
    </div>
  );
}
