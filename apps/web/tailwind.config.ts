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
        background: '#0B0A14',
        surface: '#13111F',
        'surface-elevated': '#1C1930',
        border: '#2A2640',
        muted: '#767676',
        foreground: '#F5F3FF',
        'foreground-muted': '#B5B0C7',
        primary: {
          DEFAULT: '#EE86FF',
          dark: '#6F5FCC',
          50: '#FBF0FF',
          100: '#F5DBFF',
          200: '#EAB5FF',
          300: '#DC8FFF',
          400: '#EE86FF',
          500: '#C76BFF',
          600: '#9C4FE0',
          700: '#6F5FCC',
          800: '#4D3D99',
          900: '#2D2466',
        },
        success: '#22C55E',
        danger: '#EF4444',
        warning: '#F59E0B',
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'monospace'],
      },
      backgroundImage: {
        'gradient-primary': 'linear-gradient(135deg, #EE86FF 0%, #6F5FCC 100%)',
        'gradient-radial': 'radial-gradient(ellipse at center, var(--tw-gradient-stops))',
      },
      boxShadow: {
        glow: '0 0 40px rgba(238, 134, 255, 0.35)',
        'glow-sm': '0 0 20px rgba(238, 134, 255, 0.25)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'gradient-shift': 'gradient-shift 8s ease infinite',
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
      },
    },
  },
  plugins: [],
};

export default config;
