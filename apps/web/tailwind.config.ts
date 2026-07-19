import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/**/*.{ts,tsx,js,jsx,mdx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // "Aurum" — deep obsidian canvas, jackpot-gold primary, electric-teal accent.
        // A warm premium-arcade identity, deliberately unlike the cold purple/violet
        // crypto-casino look. Source of truth: docs/design-system.md.
        background: '#0A0B0F',
        surface: '#13151C',
        'surface-elevated': '#1C1F2B',
        border: '#2A2E3C',
        muted: '#767B86',
        foreground: '#F5F7FA',
        'foreground-muted': '#9AA1B0',
        // Signature: jackpot gold.
        primary: {
          DEFAULT: '#FFBE3D',
          dark: '#B26B0C',
          50: '#FFF8E8',
          100: '#FFEEC2',
          200: '#FFDE94',
          300: '#FFCE5E',
          400: '#FFBE3D',
          500: '#F5A623',
          600: '#DB8A12',
          700: '#B26B0C',
          800: '#8A5209',
          900: '#5C3606',
        },
        // Accent: electric teal — links, live indicators, secondary highlights.
        accent: {
          DEFAULT: '#2DD4BF',
          light: '#5EEAD4',
          400: '#2DD4BF',
          500: '#14B8A6',
          600: '#0D9488',
        },
        success: '#22C55E',
        danger: '#EF4444',
        warning: '#F59E0B',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
        // Signature display face for hero numbers + game headings (#crash-identity).
        display: ['var(--font-display)', 'var(--font-geist-sans)', 'sans-serif'],
      },
      backgroundImage: {
        // Signature "jackpot glow" — gold → warm coral.
        'gradient-primary': 'linear-gradient(135deg, #FFCE5E 0%, #FF7A45 100%)',
        'gradient-radial': 'radial-gradient(ellipse at center, var(--tw-gradient-stops))',
      },
      boxShadow: {
        glow: '0 0 40px rgba(255, 190, 61, 0.35)',
        'glow-sm': '0 0 20px rgba(255, 190, 61, 0.25)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 8s ease infinite',
        'balance-glow': 'balance-glow 1s ease-out',
        'instant-shimmer': 'instant-shimmer 0.45s linear infinite',
        'screen-shake': 'screen-shake 0.5s cubic-bezier(.36,.07,.19,.97)',
        'bin-pulse': 'bin-pulse 0.6s ease-out',
        'seg-flash': 'seg-flash 0.9s ease-out',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(238, 134, 255, 0.3)' },
          '50%': { boxShadow: '0 0 40px rgba(238, 134, 255, 0.6)' },
        },
        'gradient-shift': {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        'balance-glow': {
          '0%': { color: '#10b981', textShadow: '0 0 14px rgba(16,185,129,0.8)' },
          '100%': { color: 'inherit', textShadow: '0 0 0 rgba(16,185,129,0)' },
        },
        'instant-shimmer': {
          '0%': { opacity: '0.35' },
          '50%': { opacity: '1' },
          '100%': { opacity: '0.35' },
        },
        'screen-shake': {
          '10%, 90%': { transform: 'translate3d(-1px, 0, 0)' },
          '20%, 80%': { transform: 'translate3d(2px, 0, 0)' },
          '30%, 50%, 70%': { transform: 'translate3d(-4px, 0, 0)' },
          '40%, 60%': { transform: 'translate3d(4px, 0, 0)' },
        },
        'bin-pulse': {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.18)' },
          '100%': { transform: 'scale(1.05)' },
        },
        'seg-flash': {
          '0%, 100%': { filter: 'brightness(1)' },
          '30%': { filter: 'brightness(2.2)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
