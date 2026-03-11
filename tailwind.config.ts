import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Cronix Electric Blue ───────────────────────────────
        brand: {
          50: "#E6EEFF",
          100: "#C0D4FF",
          200: "#85ABFF",
          300: "#4D83FF",
          400: "#1A5FFF",
          500: "#0062FF",
          600: "#0052D6",
          700: "#0041AB",
          800: "#003180",
          900: "#001F52",
        },
        // ── Cronix Carbon Surfaces ─────────────────────────────
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: "hsl(var(--surface))",
        border: "hsl(var(--border))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        // ── Semantic ──────────────────────────────────────────
        success: "#30D158",
        warning: "#FFD60A",
        danger: "#FF3B30",
        info: "#0062FF",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
        "4xl": "2rem",
      },
      boxShadow: {
        "brand-sm": "0 1px 3px rgba(0, 98, 255, 0.15)",
        "brand-md": "0 4px 12px rgba(0, 98, 255, 0.25)",
        "brand-lg": "0 8px 30px rgba(0, 98, 255, 0.30)",
        card: "0 4px 20px rgba(0, 0, 0, 0.40)",
        "card-dark": "0 4px 20px rgba(0, 0, 0, 0.60)",
        glow: "0 0 20px rgba(0, 98, 255, 0.35)",
        "glow-sm": "0 0 10px rgba(0, 98, 255, 0.20)",
      },
      animation: {
        "fade-in": "fadeIn 0.25s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        "spin-slow": "spin 2s linear infinite",
        "pulse-brand": "pulseBrand 2s ease-in-out infinite",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulseBrand: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(0,98,255,0.4)" },
          "50%": { boxShadow: "0 0 0 8px rgba(0,98,255,0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
