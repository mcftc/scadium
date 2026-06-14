'use client';

import { motion } from 'framer-motion';

/**
 * Scadium's rocket sprite — a hand-drawn inline SVG: sleek metallic capsule
 * with a cockpit, swept accent fins, panel lines and a layered plasma thruster
 * (white-blue core → amber → orange) that flickers. Drawn nose-up; the parent
 * rotates it along the curve tangent. Sized via the `size` prop (px, long axis).
 */
export function CrashRocket({ size = 56 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      style={{ overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="rkt-body" x1="0.2" y1="0" x2="0.85" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="40%" stopColor="#e6e1fb" />
          <stop offset="72%" stopColor="#b6abe4" />
          <stop offset="100%" stopColor="#7d6fc0" />
        </linearGradient>
        <linearGradient id="rkt-sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="42%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="rkt-fin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="100%" stopColor="#6f5fcc" />
        </linearGradient>
        <radialGradient id="rkt-glass" cx="38%" cy="32%" r="80%">
          <stop offset="0%" stopColor="#eafdff" />
          <stop offset="45%" stopColor="#34d6ee" />
          <stop offset="100%" stopColor="#0b6c86" />
        </radialGradient>
        <radialGradient id="rkt-flame-core" cx="50%" cy="14%" r="85%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="30%" stopColor="#cdeaff" />
          <stop offset="62%" stopColor="#ffd36b" />
          <stop offset="100%" stopColor="#ff6a00" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="rkt-nose" cx="50%" cy="20%" r="80%">
          <stop offset="0%" stopColor="#f7b5ff" />
          <stop offset="100%" stopColor="#a855f7" />
        </radialGradient>
      </defs>

      {/* Plasma thruster — flickers via framer-motion scale on the nozzle origin. */}
      <motion.g
        style={{ originX: '32px', originY: '47px' }}
        animate={{ scaleY: [1, 1.4, 0.92, 1.28, 1], scaleX: [1, 0.88, 1.06, 0.9, 1] }}
        transition={{ duration: 0.3, repeat: Infinity, ease: 'easeInOut' }}
      >
        {/* outer glow */}
        <path d="M25 47 C25 60 29 65 32 70 C35 65 39 60 39 47 Z" fill="#ff6a00" opacity="0.55" />
        {/* mid body */}
        <path d="M27 47 C27 57 30 61 32 65 C34 61 37 57 37 47 Z" fill="#ffae3d" opacity="0.9" />
        {/* white-blue core */}
        <path d="M29 47 C29 54 31 57 32 60 C33 57 35 54 35 47 Z" fill="url(#rkt-flame-core)" />
      </motion.g>

      {/* Swept fins with a cyan edge */}
      <path d="M23 33 C16 38 14 45 15 51 C20 47 23 45 26 42 Z" fill="url(#rkt-fin)" />
      <path d="M41 33 C48 38 50 45 49 51 C44 47 41 45 38 42 Z" fill="url(#rkt-fin)" />
      <path d="M23 33 C16 38 14 45 15 51" stroke="#5eead4" strokeWidth="0.8" opacity="0.7" fill="none" />
      <path d="M41 33 C48 38 50 45 49 51" stroke="#5eead4" strokeWidth="0.8" opacity="0.7" fill="none" />

      {/* Body — sleek pointed capsule */}
      <path
        d="M32 1 C40 9 43.5 20 43.5 31 C43.5 39 39.5 45.5 32 48 C24.5 45.5 20.5 39 20.5 31 C20.5 20 24 9 32 1 Z"
        fill="url(#rkt-body)"
        stroke="#6f5fcc"
        strokeWidth="0.9"
      />
      {/* Vertical sheen highlight */}
      <path d="M30 4 C26 12 24 22 24.5 33 C25 40 27 44 29.5 46 C28.5 40 28 33 28.5 24 C29 16 29.5 9 31 4 Z" fill="url(#rkt-sheen)" opacity="0.5" />
      {/* Nose accent */}
      <path d="M32 1 C36 6 39 12 40.6 18 L23.4 18 C25 12 28 6 32 1 Z" fill="url(#rkt-nose)" />
      {/* Cockpit window */}
      <circle cx="32" cy="25" r="5.6" fill="url(#rkt-glass)" stroke="#f2eaff" strokeWidth="1.5" />
      <circle cx="30" cy="23" r="1.6" fill="#ffffff" opacity="0.85" />
      {/* Panel lines */}
      <path d="M23.5 31 C26 33 38 33 40.5 31" stroke="#6f5fcc" strokeWidth="0.7" opacity="0.55" fill="none" />
      <path d="M25 39 C28 41 36 41 39 39" stroke="#6f5fcc" strokeWidth="0.7" opacity="0.5" fill="none" />
      {/* Booster band + nozzle */}
      <path d="M26 44 L38 44 L37 47 L27 47 Z" fill="#5b5286" />
      <path d="M28 47 L36 47 L34.5 50.5 L29.5 50.5 Z" fill="#3a335c" />
    </svg>
  );
}
