import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PwaInstallBanner } from "@/components/ui/pwa-install-banner";
import { PwaInstallFloating } from "@/components/ui/pwa-install-floating";

export default async function RootPage() {
  const t = await getTranslations('landing');

  const FEATURE_PILLS = [
    { icon: "📅", key: "calendar" as const },
    { icon: "👥", key: "clients" as const },
    { icon: "💰", key: "finances" as const },
    { icon: "📊", key: "reports" as const },
  ] as const;

  const MOCKUP_SIDEBAR_ITEMS = [
    t('mockup.agenda'),
    t('mockup.clientsNav'),
    t('mockup.servicesNav'),
    t('mockup.financesNav'),
    t('mockup.reportsNav'),
  ];

  const MOCKUP_STATS = [
    { label: t('mockup.todayAppointments'), val: "8",    color: "#0062FF" },
    { label: t('mockup.clients'),           val: "124",  color: "#30D158" },
    { label: t('mockup.revenue'),           val: "$4.2k",color: "#FFD60A" },
    { label: t('mockup.pending'),           val: "3",    color: "#FF3B30" },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#0F0F12",
        fontFamily: "'Inter', system-ui, sans-serif",
        overflowX: "hidden",
        position: "relative",
      }}
    >
      {/* ── Ambient background effects ── */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          overflow: "hidden",
        }}
      >
        {/* Blue orb top-right */}
        <div
          style={{
            position: "absolute",
            top: "-20%",
            right: "-10%",
            width: "min(600px, 150vw)",
            height: "min(600px, 150vw)",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,98,255,0.12) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
        {/* Cyan orb bottom-left */}
        <div
          style={{
            position: "absolute",
            bottom: "-10%",
            left: "-5%",
            width: "min(500px, 120vw)",
            height: "min(500px, 120vw)",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,209,255,0.07) 0%, transparent 70%)",
            filter: "blur(60px)",
          }}
        />
        {/* Grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `
            linear-gradient(rgba(0,98,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,98,255,0.03) 1px, transparent 1px)
          `,
            backgroundSize: "60px 60px",
          }}
        />
        {/* Horizontal scan line */}
        <div
          style={{
            position: "absolute",
            top: "45%",
            left: 0,
            right: 0,
            height: "1px",
            background: "linear-gradient(90deg, transparent, rgba(0,98,255,0.15), rgba(0,209,255,0.1), transparent)",
          }}
        />
      </div>

      {/* ── Top nav ── */}
      <nav
        className="px-5 sm:px-8 md:px-12 py-5 sm:py-6"
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              overflow: "hidden",
              flexShrink: 0,
            }}
          >
            <Image
              src="/cronix-logo.jpg"
              alt="Cronix"
              width={36}
              height={36}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              sizes="36px"
            />
          </div>
          <div
            style={{
              width: "100px",
              height: "22px",
              position: "relative",
              flexShrink: 0,
            }}
          >
            <Image
              src="/cronix-letras.jpg"
              alt="Cronix"
              fill
              style={{ objectFit: "contain", objectPosition: "left" }}
              sizes="100px"
            />
          </div>
        </div>

        {/* Nav actions (PWA Install Button ALWAYS visible for design) */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <PwaInstallBanner variant="navbar" />
        </div>
      </nav>

      {/* ── Hero ── */}
      <main
        className="px-5 sm:px-8 pt-6 pb-28 sm:py-14 md:py-20"
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          minHeight: "calc(100vh - 89px)",
        }}
      >
        {/* Badge */}
        <div
          className="mb-4 sm:mb-8"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 14px",
            borderRadius: "999px",
            background: "rgba(0,98,255,0.08)",
            border: "1px solid rgba(0,98,255,0.2)",
            maxWidth: "calc(100vw - 40px)",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "#0062FF",
              boxShadow: "0 0 8px rgba(0,98,255,0.8)",
              animation: "pulse 2s ease-in-out infinite",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#4D83FF",
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {t('badge')}
          </span>
        </div>

        {/* Logo mark large */}
        <div
          className="w-[72px] h-[72px] sm:w-[88px] sm:h-[88px] rounded-[20px] sm:rounded-[24px] mb-4 sm:mb-7"
          style={{
            overflow: "hidden",
            flexShrink: 0,
            boxShadow: "0 0 40px rgba(0,98,255,0.3), 0 0 80px rgba(0,98,255,0.1)",
            border: "1px solid rgba(0,98,255,0.2)",
          }}
        >
          <Image
            src="/cronix-logo.jpg"
            alt="Cronix"
            width={88}
            height={88}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            sizes="88px"
          />
        </div>

        {/* Wordmark */}
        <div
          className="w-[180px] h-[36px] sm:w-[260px] sm:h-[54px] mb-3 sm:mb-6"
          style={{ position: "relative" }}
        >
          <Image
            src="/cronix-letras.jpg"
            alt="Cronix"
            fill
            style={{ objectFit: "contain" }}
            sizes="(min-width: 640px) 260px, 180px"
          />
        </div>

        {/* Tagline */}
        <p
          className="mb-6 sm:mb-10"
          style={{
            fontSize: "clamp(14px, 4vw, 18px)",
            fontWeight: 400,
            lineHeight: 1.6,
            color: "#909098",
            maxWidth: "520px",
          }}
        >
          {t('tagline')}
        </p>

        {/* CTAs */}
        <div
          className="mb-6 sm:mb-14 w-full sm:w-auto"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            alignItems: "stretch",
            maxWidth: "320px",
          }}
        >
          <div className="flex flex-col sm:flex-row" style={{ gap: "10px" }}>
            <Link
              href="/register"
              className="flex-1 sm:flex-none"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "14px 28px",
                borderRadius: "14px",
                fontSize: "15px",
                fontWeight: 700,
                color: "#fff",
                textDecoration: "none",
                background: "linear-gradient(135deg, #0062FF 0%, #0041AB 100%)",
                boxShadow: "0 0 30px rgba(0,98,255,0.4), 0 4px 20px rgba(0,98,255,0.3)",
                transition: "transform 0.2s, box-shadow 0.2s",
              }}
            >
              {t('ctaStart')}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8h10M9 4l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Link>
            <Link
              href="/login"
              className="flex-1 sm:flex-none"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                padding: "14px 28px",
                borderRadius: "14px",
                fontSize: "15px",
                fontWeight: 600,
                color: "#F2F2F2",
                textDecoration: "none",
                background: "#1A1A1F",
                border: "1px solid #272729",
                transition: "border-color 0.2s, box-shadow 0.2s",
              }}
            >
              {t('ctaLogin')}
            </Link>
          </div>
        </div>

        {/* Feature pills — hidden on mobile to keep CTAs in viewport */}
        <div
          className="hidden sm:flex mb-10 sm:mb-14"
          style={{ gap: "10px", flexWrap: "wrap", justifyContent: "center" }}
        >
          {FEATURE_PILLS.map((f) => (
            <div
              key={f.key}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 16px",
                borderRadius: "999px",
                background: "#1A1A1F",
                border: "1px solid #272729",
                fontSize: "13px",
                fontWeight: 500,
                color: "#909098",
              }}
            >
              <span>{f.icon}</span> {t(`features.${f.key}`)}
            </div>
          ))}
        </div>

        {/* Dashboard preview mockup — hidden on mobile */}
        <div
          className="hidden sm:block w-full max-w-[860px] rounded-[20px]"
          style={{
            overflow: "hidden",
            border: "1px solid rgba(0,98,255,0.15)",
            boxShadow: "0 0 80px rgba(0,98,255,0.1), 0 40px 100px rgba(0,0,0,0.6)",
            background: "#141417",
            position: "relative",
          }}
        >
          {/* Fake browser chrome */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "12px 16px",
              background: "#1A1A1F",
              borderBottom: "1px solid #272729",
            }}
          >
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#FF3B30" }} />
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#FFD60A" }} />
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#30D158" }} />
            <div
              style={{
                flex: 1,
                marginLeft: "12px",
                padding: "4px 12px",
                background: "#0F0F12",
                borderRadius: "6px",
                fontSize: "11px",
                color: "#909098",
                fontWeight: 500,
              }}
            >
              app.cronix.io/dashboard
            </div>
          </div>

          {/* Dashboard UI mockup */}
          <div className="p-3 sm:p-5 flex gap-4 overflow-x-auto">
            {/* Sidebar mock */}
            <div
              style={{
                width: "140px",
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              {MOCKUP_SIDEBAR_ITEMS.map((item, i) => (
                <div
                  key={item}
                  style={{
                    padding: "8px 12px",
                    borderRadius: "10px",
                    fontSize: "11px",
                    fontWeight: 600,
                    background: i === 0 ? "rgba(0,98,255,0.12)" : "transparent",
                    color: i === 0 ? "#4D83FF" : "#909098",
                    border: i === 0 ? "1px solid rgba(0,98,255,0.2)" : "1px solid transparent",
                  }}
                >
                  {item}
                </div>
              ))}
            </div>

            {/* Content mock */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
              {/* Stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {MOCKUP_STATS.map((s) => (
                  <div
                    key={s.label}
                    style={{
                      padding: "10px",
                      borderRadius: "10px",
                      background: "#1E1E21",
                      border: "1px solid #272729",
                    }}
                  >
                    <div style={{ fontSize: "16px", fontWeight: 800, color: s.color }}>
                      {s.val}
                    </div>
                    <div style={{ fontSize: "9px", color: "#909098", fontWeight: 600, marginTop: "2px" }}>
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Calendar mock */}
              <div
                style={{
                  padding: "12px",
                  borderRadius: "12px",
                  background: "#1A1A1F",
                  border: "1px solid #272729",
                }}
              >
                <div style={{ fontSize: "10px", fontWeight: 800, color: "#F2F2F2", marginBottom: "8px" }}>
                  {t('mockup.march2026')}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: "3px" }}>
                  {Array.from({ length: 35 }, (_, i) => {
                    const day = i - 5;
                    const hasApt = [9, 16, 22, 28].includes(day);
                    const isToday = day === 10;
                    return (
                      <div
                        key={i}
                        style={{
                          height: "22px",
                          borderRadius: "6px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "9px",
                          fontWeight: 700,
                          background: isToday ? "#0062FF" : hasApt ? "rgba(0,98,255,0.12)" : "transparent",
                          color: isToday ? "#fff" : day > 0 && day <= 31 ? "#F2F2F2" : "#3A3A3F",
                          border: hasApt && !isToday ? "1px solid rgba(0,98,255,0.2)" : "1px solid transparent",
                        }}
                      >
                        {day > 0 && day <= 31 ? day : ""}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Gradient fade at bottom */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "80px",
              background: "linear-gradient(transparent, #0F0F12)",
            }}
          />
        </div>

        {/* Bottom tagline */}
        <p
          className="hidden sm:block"
          style={{ marginTop: "40px", fontSize: "12px", color: "#3A3A3F", fontWeight: 500 }}
        >
          {t('disclaimer')}
        </p>

        {/* PWA floating install prompt */}
        <PwaInstallFloating />
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
        a:hover { opacity: 0.9; }
      `}</style>
    </div>
  );
}
