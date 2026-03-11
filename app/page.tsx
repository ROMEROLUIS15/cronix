import Link from "next/link";
import Image from "next/image";

export default function RootPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#0F0F12",
        fontFamily: "'Inter', system-ui, sans-serif",
        overflow: "hidden",
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
            width: "600px",
            height: "600px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(0,98,255,0.12) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />
        {/* Cyan orb bottom-left */}
        <div
          style={{
            position: "absolute",
            bottom: "-10%",
            left: "-5%",
            width: "500px",
            height: "500px",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(0,209,255,0.07) 0%, transparent 70%)",
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
            background:
              "linear-gradient(90deg, transparent, rgba(0,98,255,0.15), rgba(0,209,255,0.1), transparent)",
          }}
        />
      </div>

      {/* ── Top nav ── */}
      <nav
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "24px 48px",
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
              unoptimized
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
              unoptimized
            />
          </div>
        </div>

        {/* Nav links */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Link
            href="/login"
            style={{
              padding: "8px 20px",
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: 600,
              color: "#909098",
              textDecoration: "none",
              transition: "color 0.2s",
            }}
          >
            Iniciar Sesión
          </Link>
          <Link
            href="/register"
            style={{
              padding: "9px 22px",
              borderRadius: "10px",
              fontSize: "13px",
              fontWeight: 700,
              color: "#fff",
              textDecoration: "none",
              background: "linear-gradient(135deg, #0062FF, #0041AB)",
              boxShadow: "0 0 20px rgba(0,98,255,0.3)",
            }}
          >
            Crear Cuenta
          </Link>
        </div>
      </nav>

      {/* ── Hero ── */}
      <main
        style={{
          position: "relative",
          zIndex: 10,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "80px 24px 60px",
          minHeight: "calc(100vh - 89px)",
        }}
      >
        {/* Badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 16px",
            borderRadius: "999px",
            marginBottom: "32px",
            background: "rgba(0,98,255,0.08)",
            border: "1px solid rgba(0,98,255,0.2)",
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
            }}
          />
          <span
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "#4D83FF",
              letterSpacing: "0.05em",
            }}
          >
            PLATAFORMA DE GESTIÓN INTELIGENTE
          </span>
        </div>

        {/* Logo mark large */}
        <div
          style={{
            width: "88px",
            height: "88px",
            borderRadius: "24px",
            overflow: "hidden",
            marginBottom: "28px",
            flexShrink: 0,
            boxShadow:
              "0 0 40px rgba(0,98,255,0.3), 0 0 80px rgba(0,98,255,0.1)",
            border: "1px solid rgba(0,98,255,0.2)",
          }}
        >
          <Image
            src="/cronix-logo.jpg"
            alt="Cronix"
            width={88}
            height={88}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            unoptimized
          />
        </div>

        {/* Wordmark */}
        <div
          style={{
            width: "260px",
            height: "54px",
            position: "relative",
            marginBottom: "24px",
          }}
        >
          <Image
            src="/cronix-letras.jpg"
            alt="Cronix"
            fill
            style={{ objectFit: "contain" }}
            unoptimized
          />
        </div>

        {/* Tagline */}
        <p
          style={{
            fontSize: "18px",
            fontWeight: 400,
            lineHeight: 1.6,
            color: "#909098",
            maxWidth: "520px",
            marginBottom: "48px",
          }}
        >
          Gestiona citas, clientes y finanzas de tu negocio en{" "}
          <span style={{ color: "#F2F2F2", fontWeight: 600 }}>
            un solo lugar
          </span>
          . Diseñado para profesionales que no se conforman.
        </p>

        {/* CTAs */}
        <div
          style={{
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
            justifyContent: "center",
            marginBottom: "64px",
          }}
        >
          <Link
            href="/register"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "14px 32px",
              borderRadius: "14px",
              fontSize: "15px",
              fontWeight: 700,
              color: "#fff",
              textDecoration: "none",
              background: "linear-gradient(135deg, #0062FF 0%, #0041AB 100%)",
              boxShadow:
                "0 0 30px rgba(0,98,255,0.4), 0 4px 20px rgba(0,98,255,0.3)",
              transition: "transform 0.2s, box-shadow 0.2s",
            }}
          >
            Comenzar gratis
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
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "14px 32px",
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
            Iniciar Sesión
          </Link>
        </div>

        {/* Feature pills */}
        <div
          style={{
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
            justifyContent: "center",
            marginBottom: "64px",
          }}
        >
          {[
            { icon: "📅", text: "Calendario inteligente" },
            { icon: "👥", text: "Gestión de clientes" },
            { icon: "💰", text: "Control financiero" },
            { icon: "📊", text: "Reportes en tiempo real" },
          ].map((f) => (
            <div
              key={f.text}
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
              <span>{f.icon}</span> {f.text}
            </div>
          ))}
        </div>

        {/* Dashboard preview mockup */}
        <div
          style={{
            width: "100%",
            maxWidth: "860px",
            borderRadius: "20px",
            overflow: "hidden",
            border: "1px solid rgba(0,98,255,0.15)",
            boxShadow:
              "0 0 80px rgba(0,98,255,0.1), 0 40px 100px rgba(0,0,0,0.6)",
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
            <span
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#FF3B30",
              }}
            />
            <span
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#FFD60A",
              }}
            />
            <span
              style={{
                width: "10px",
                height: "10px",
                borderRadius: "50%",
                background: "#30D158",
              }}
            />
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
          <div style={{ padding: "24px", display: "flex", gap: "16px" }}>
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
              {["Agenda", "Clientes", "Servicios", "Finanzas", "Reportes"].map(
                (item, i) => (
                  <div
                    key={item}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "10px",
                      fontSize: "11px",
                      fontWeight: 600,
                      background:
                        i === 0 ? "rgba(0,98,255,0.12)" : "transparent",
                      color: i === 0 ? "#4D83FF" : "#909098",
                      border:
                        i === 0
                          ? "1px solid rgba(0,98,255,0.2)"
                          : "1px solid transparent",
                    }}
                  >
                    {item}
                  </div>
                ),
              )}
            </div>

            {/* Content mock */}
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              {/* Stats row */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4,1fr)",
                  gap: "8px",
                }}
              >
                {[
                  { label: "Citas hoy", val: "8", color: "#0062FF" },
                  { label: "Clientes", val: "124", color: "#30D158" },
                  { label: "Ingresos", val: "$4.2k", color: "#FFD60A" },
                  { label: "Pendientes", val: "3", color: "#FF3B30" },
                ].map((s) => (
                  <div
                    key={s.label}
                    style={{
                      padding: "10px",
                      borderRadius: "10px",
                      background: "#1E1E21",
                      border: "1px solid #272729",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "16px",
                        fontWeight: 800,
                        color: s.color,
                      }}
                    >
                      {s.val}
                    </div>
                    <div
                      style={{
                        fontSize: "9px",
                        color: "#909098",
                        fontWeight: 600,
                        marginTop: "2px",
                      }}
                    >
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
                <div
                  style={{
                    fontSize: "10px",
                    fontWeight: 800,
                    color: "#F2F2F2",
                    marginBottom: "8px",
                  }}
                >
                  Marzo 2026
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7,1fr)",
                    gap: "3px",
                  }}
                >
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
                          background: isToday
                            ? "#0062FF"
                            : hasApt
                              ? "rgba(0,98,255,0.12)"
                              : "transparent",
                          color: isToday
                            ? "#fff"
                            : day > 0 && day <= 31
                              ? "#F2F2F2"
                              : "#3A3A3F",
                          border:
                            hasApt && !isToday
                              ? "1px solid rgba(0,98,255,0.2)"
                              : "1px solid transparent",
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
          style={{
            marginTop: "40px",
            fontSize: "12px",
            color: "#3A3A3F",
            fontWeight: 500,
          }}
        >
          Sin tarjeta de crédito · Configuración en 2 minutos · Cancela cuando
          quieras
        </p>
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
