import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getRepos } from "@/lib/repositories";
import Image from "next/image";
import { Link } from "@/i18n/navigation";
import { Gift, ArrowRight, Star, Zap, Calendar } from "lucide-react";

interface InvitePageProps {
  params: Promise<{ code: string; locale: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
  const { code, locale } = await params;
  const normalizedCode = code.toUpperCase();

  const admin = createAdminClient();
  const { businesses } = getRepos(admin);
  const result = await businesses.getByReferralCode(normalizedCode);

  if (!result.data) {
    redirect(`/${locale}/register`);
  }

  const inviterName = result.data.name;
  const t = await getTranslations("invite");

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: "linear-gradient(160deg, #060608 0%, #0A0A14 50%, #0D0D1A 100%)" }}
    >
      <div
        style={{
          position: "absolute",
          top: "10%",
          left: "50%",
          transform: "translateX(-50%)",
          width: "600px",
          height: "300px",
          borderRadius: "50%",
          filter: "blur(80px)",
          pointerEvents: "none",
          background: "radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 w-full max-w-md text-center">
        <Link href="/" className="inline-flex flex-col items-center mb-8">
          <div
            className="h-16 w-16 rounded-2xl overflow-hidden mb-3"
            style={{
              border: "1px solid rgba(168,85,247,0.4)",
              boxShadow: "0 0 32px rgba(168,85,247,0.25)",
            }}
          >
            <Image src="/cronix-logo.jpg" alt="Cronix" width={64} height={64} className="h-full w-full object-cover" />
          </div>
          <div className="relative h-7 w-28">
            <Image src="/cronix-letras.jpg" alt="Cronix" fill className="object-contain" sizes="112px" />
          </div>
        </Link>

        <div
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full mb-6"
          style={{
            background: "rgba(168,85,247,0.15)",
            border: "1px solid rgba(168,85,247,0.35)",
          }}
        >
          <Gift size={14} style={{ color: "#A855F7" }} />
          <span style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#A855F7" }}>
            {t('badge')}
          </span>
        </div>

        <h1
          className="font-black text-white mb-3"
          style={{ fontSize: "clamp(1.75rem, 5vw, 2.5rem)", letterSpacing: "-0.035em", lineHeight: 1.15 }}
        >
          {t('invitesYou', { name: inviterName })}{" "}
          <span
            style={{
              background: "linear-gradient(90deg, #A855F7, #6366F1)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Cronix
          </span>
        </h1>
        <p style={{ color: "#6A6A7A", fontSize: "15px", lineHeight: "1.6", marginBottom: "2rem" }}>
          {t('subtitle')}
        </p>

        <div
          className="rounded-2xl p-5 mb-6 text-left space-y-3"
          style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)" }}
        >
          {[
            { icon: Calendar, text: t('feature1') },
            { icon: Star, text: t('feature2') },
            { icon: Zap, text: t('feature3') },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-3">
              <div
                className="flex-shrink-0 flex items-center justify-center"
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "10px",
                  background: "rgba(168,85,247,0.2)",
                  border: "1px solid rgba(168,85,247,0.3)",
                }}
              >
                <Icon size={15} style={{ color: "#A855F7" }} />
              </div>
              <span style={{ fontSize: "14px", color: "#C0C0CC", fontWeight: 500 }}>{text}</span>
            </div>
          ))}
        </div>

        <Link
          href={`/register?ref=${normalizedCode}`}
          className="inline-flex items-center justify-center gap-2 w-full"
          style={{
            padding: "1rem 2rem",
            borderRadius: "14px",
            background: "linear-gradient(135deg, #A855F7 0%, #6366F1 100%)",
            color: "#fff",
            fontSize: "15px",
            fontWeight: 700,
            textDecoration: "none",
            boxShadow: "0 0 32px rgba(168,85,247,0.35), 0 4px 16px rgba(99,102,241,0.2)",
          }}
        >
          {t('cta')}
          <ArrowRight size={18} />
        </Link>

        <p style={{ color: "#3A3A4A", fontSize: "12px", marginTop: "1rem" }}>
          {t('disclaimer')}
        </p>
      </div>
    </div>
  );
}
