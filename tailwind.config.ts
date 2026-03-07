import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Naranja Fuego (marca principal) ───────────────────
        brand: {
          50:  '#FFF7ED',
          100: '#FFEDD5',
          200: '#FED7AA',
          300: '#FDBA74',
          400: '#FB923C',
          500: '#F97316',
          600: '#EA580C', // ← primary: botones, links, iconos activos
          700: '#C2410C',
          800: '#9A3412',
          900: '#7C2D12',
        },
        // ── Neutros cálidos (fondos y textos) ─────────────────
        warm: {
          50:  '#FFFBF7',
          100: '#FEF3C7',
          200: '#FDE68A',
          800: '#3D1F00',
          900: '#1C0A00',
        },
        // ── Tokens semánticos (resuelven en CSS vars) ─────────
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface:    'hsl(var(--surface))',
        border:     'hsl(var(--border))',
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        // Semánticos de estado
        success:   '#22C55E',
        warning:   '#EAB308',
        danger:    '#EF4444',
        info:      '#3B82F6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        'xl':  '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      boxShadow: {
        'brand-sm': '0 1px 3px rgba(234, 88, 12, 0.12)',
        'brand-md': '0 4px 12px rgba(234, 88, 12, 0.18)',
        'brand-lg': '0 8px 30px rgba(234, 88, 12, 0.22)',
        'card':     '0 2px 8px rgba(0, 0, 0, 0.06)',
        'card-dark':'0 2px 8px rgba(0, 0, 0, 0.35)',
      },
      animation: {
        'fade-in':      'fadeIn 0.25s ease-out',
        'slide-up':     'slideUp 0.3s ease-out',
        'spin-slow':    'spin 2s linear infinite',
        'pulse-brand':  'pulseBrand 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' },
        },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        pulseBrand: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(234,88,12,0.4)' },
          '50%':      { boxShadow: '0 0 0 8px rgba(234,88,12,0)' },
        },
      },
    },
  },
  plugins: [],
}
export default config
