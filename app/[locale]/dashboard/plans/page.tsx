import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAuthUser, getAuthUserProfile } from "@/lib/supabase/server-cache";
import type { ReferralBusiness, ReferralInvite } from "@/types";
import { PlanManager } from "@/app/[locale]/dashboard/settings/plan-manager";
import { ReferralClient } from "@/app/[locale]/dashboard/referrals/referral-client";

const ADMIN_PREVIEW: ReferralBusiness = {
  id: "mock-id",
  name: "Admin Preview",
  plan: "pro",
  referral_code: "ADMIN-PREVIEW",
  bonus_appointments_limit: 0,
  subscription_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
};

export default async function PlansPage() {
  const [t, user] = await Promise.all([
    getTranslations("plans"),
    getAuthUser(),
  ]);

  if (!user) return null;

  const dbUser = await getAuthUserProfile(user.id);
  const adminSupabase = createAdminClient();

  let business: ReferralBusiness | null = null;

  if (dbUser?.business_id) {
    const { data, error } = await adminSupabase
      .from("businesses")
      .select("id, name, plan, referral_code, bonus_appointments_limit, subscription_ends_at")
      .eq("id", dbUser.business_id)
      .single();

    if (!error) business = data;
  }

  if (!business) {
    if (dbUser?.role === "platform_admin") {
      business = ADMIN_PREVIEW;
    } else {
      return (
        <div className="p-6 text-center text-gray-500">
          No tienes un negocio asociado para ver esta página.
        </div>
      );
    }
  }

  const { data: invited } = await adminSupabase
    .from("businesses")
    .select("id, name, plan, created_at")
    .eq("referred_by_id", business.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-10 max-w-4xl animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "#F2F2F2" }}>
          {t("pageTitle")}
        </h1>
        <p className="text-sm mt-1" style={{ color: "#909098" }}>
          {t("pageSubtitle")}
        </p>
      </div>

      {/* ── Plan section ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "#F2F2F2" }}>
            {t("planSectionTitle")}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "#909098" }}>
            {t("planSectionSub")}
          </p>
        </div>
        <PlanManager currentPlan={business.plan} businessId={business.id} />
      </section>

      {/* Divider */}
      <div style={{ borderTop: "1px solid #262629" }} />

      {/* ── Referral section ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "#F2F2F2" }}>
            {t("referralSectionTitle")}
          </h2>
          <p className="text-xs mt-0.5" style={{ color: "#909098" }}>
            {t("referralSectionSub")}
          </p>
        </div>
        <ReferralClient
          business={business}
          invited={(invited ?? []) as ReferralInvite[]}
          appUrl={process.env.NEXT_PUBLIC_APP_URL ?? "https://cronix.co"}
        />
      </section>
    </div>
  );
}
