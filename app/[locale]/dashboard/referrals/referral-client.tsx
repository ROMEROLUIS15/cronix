"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, CheckCircle2, Gift, Users, Star, ArrowRight } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import type { ReferralBusiness, ReferralInvite } from "@/types";
import { getReferralRewardInfo } from "@/lib/referrals/rewards";

interface ReferralClientProps {
  business: ReferralBusiness;
  invited: ReferralInvite[];
  appUrl: string;
}

export function ReferralClient({ business, invited, appUrl }: ReferralClientProps) {
  const t = useTranslations("referrals");
  const [copied, setCopied] = useState(false);

  const referralLink = `${appUrl}/invite/${business.referral_code ?? "PENDING"}`;
  const reward = getReferralRewardInfo(business.plan, business.bonus_appointments_limit);
  const paidInvitesCount = invited.filter((b) => b.plan !== "free" && b.plan !== null).length;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked (HTTP context or permissions denied) — silent fail
    }
  };

  return (
    <div className="space-y-6">
      {/* Hero Card */}
      <Card
        className="relative overflow-hidden border-0"
        style={{
          background: "linear-gradient(135deg, rgba(168,85,247,0.1) 0%, rgba(59,130,246,0.1) 100%)",
          boxShadow: "inset 0 1px 1px rgba(255,255,255,0.05)",
        }}
      >
        <div className="hidden md:block absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <Gift size={120} />
        </div>

        <div className="relative z-10 p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400">
              <Star size={24} />
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white">
              {reward.isFree ? t("heroBannerFree") : t("heroBannerPaid")}
            </h2>
          </div>
          <p className="text-gray-400 max-w-lg mb-4 sm:mb-8">
            {reward.isFree ? t("heroDescFree") : t("heroDescPaid")}
          </p>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 max-w-2xl">
            <div className="flex-1 flex items-center bg-[#16161C] border border-[#2E2E33] rounded-xl px-4 py-3">
              <span className="text-gray-300 font-mono text-sm truncate select-all">
                {referralLink}
              </span>
            </div>
            <Button
              onClick={copyToClipboard}
              className={`h-12 px-6 rounded-xl font-semibold transition-all ${
                copied ? "bg-green-500 hover:bg-green-600" : "bg-purple-600 hover:bg-purple-700"
              }`}
            >
              {copied ? (
                <><CheckCircle2 size={18} className="mr-2" /> {t("copied")}</>
              ) : (
                <><Copy size={18} className="mr-2" /> {t("copyLink")}</>
              )}
            </Button>
          </div>
        </div>
      </Card>

      {/* Stats & Progress */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-4 sm:p-6 bg-[#1C1C21] border-[#2E2E33]">
          <div className="flex items-center gap-3 mb-4 sm:mb-6">
            <Users className="text-blue-400" size={20} />
            <h3 className="font-semibold text-white">{t("rewardStatusTitle")}</h3>
          </div>

          {reward.isFree ? (
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{t("extraApptsLabel")}</span>
                <span className="text-white font-bold">
                  {reward.currentBonus}{" "}
                  <span className="text-gray-500">/ {reward.maxBonus} max</span>
                </span>
              </div>
              <div className="w-full bg-[#2E2E33] rounded-full h-3 overflow-hidden">
                <div
                  className="bg-blue-500 h-full rounded-full transition-all duration-1000 ease-out"
                  style={{ width: `${reward.progressPercentage}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 text-right">
                {t("baseLimitText", {
                  base: reward.baseLimit,
                  current: reward.baseLimit + reward.currentBonus,
                })}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center p-4 rounded-xl bg-purple-500/10 border border-purple-500/20">
                <div>
                  <p className="text-sm text-gray-400">{t("monthsEarnedLabel")}</p>
                  <p className="text-2xl font-bold text-white">{paidInvitesCount}</p>
                </div>
                <Gift className="text-purple-400" size={32} />
              </div>
              {business.subscription_ends_at && (
                <p className="text-xs text-gray-400">
                  {t("expiryText", {
                    date: format(
                      new Date(business.subscription_ends_at),
                      "dd 'de' MMMM, yyyy",
                      { locale: es },
                    ),
                  })}
                </p>
              )}
            </div>
          )}
        </Card>

        <Card className="p-4 sm:p-6 bg-[#1C1C21] border-[#2E2E33] flex flex-col justify-center">
          <h3 className="font-semibold text-white mb-4">{t("howItWorksTitle")}</h3>
          <ul className="space-y-4 text-sm text-gray-400">
            {(["step1", "step2", "step3"] as const).map((key) => (
              <li key={key} className="flex items-start gap-3">
                <div className="mt-0.5 bg-[#2E2E33] rounded-full p-1 text-white flex-shrink-0">
                  <ArrowRight size={12} />
                </div>
                {t(key)}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {/* Invited List */}
      <Card className="bg-[#1C1C21] border-[#2E2E33] overflow-hidden">
        <div className="p-4 sm:p-6 border-b border-[#2E2E33]">
          <h3 className="font-semibold text-white">
            {t("referralsListTitle", { count: invited.length })}
          </h3>
        </div>

        {invited.length === 0 ? (
          <div className="p-6 sm:p-8 text-center text-gray-500 text-sm">
            {t("emptyReferrals")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-400 uppercase bg-[#212125]">
                <tr>
                  <th className="px-3 sm:px-6 py-3 sm:py-4">{t("colBusiness")}</th>
                  <th className="px-3 sm:px-6 py-3 sm:py-4 hidden sm:table-cell">{t("colDate")}</th>
                  <th className="px-3 sm:px-6 py-3 sm:py-4">{t("colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {invited.map((inv) => (
                  <tr
                    key={inv.id}
                    className="border-b border-[#2E2E33] last:border-0 hover:bg-[#212125]/50 transition-colors"
                  >
                    <td className="px-3 sm:px-6 py-3 sm:py-4 font-medium text-white">{inv.name ?? "—"}</td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4 text-gray-400 hidden sm:table-cell">
                      {inv.created_at
                        ? format(new Date(inv.created_at), "dd MMM yyyy")
                        : "—"}
                    </td>
                    <td className="px-3 sm:px-6 py-3 sm:py-4">
                      {inv.plan === "free" ? (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                          {t("statusFree")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                          {t("statusPaid")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
