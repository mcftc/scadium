'use client';

import { motion } from 'framer-motion';

/**
 * Scadium's own rocket sprite — a hand-drawn inline SVG (sleek capsule body,
 * porthole, swept fins) with a flickering thruster flame. Drawn nose-up;
 * the parent rotates it along the curve tangent. Sized via the `size` prop
 * (px of the long axis).
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
        <linearGradient id="rkt-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f4f1ff" />
          <stop offset="55%" stopColor="#cfc7ee" />
          <stop offset="100%" stopColor="#8f82c4" />
        </linearGradient>
        <linearGradient id="rkt-fin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6f5fcc" />
        </linearGradient>
        <radialGradient id="rkt-glass" cx="35%" cy="35%" r="75%">
          <stop offset="0%" stopColor="#bdf3ff" />
          <stop offset="60%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#0e7490" />
        </radialGradient>
        <radialGradient id="rkt-flame-core" cx="50%" cy="20%" r="80%">
          <stop offset="0%" stopColor="#fff7e6" />
          <stop offset="45%" stopColor="#ffd36b" />
          <stop offset="100%" stopColor="#ff6a00" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Thruster flame — flickers via framer-motion scale on the nozzle origin. */}
      <motion.g
        style={{ originX: '32px', originY: '46px' }}
        animate={{ scaleY: [1, 1.35, 0.95, 1.25, 1], scaleX: [1, 0.9, 1.05, 0.92, 1] }}
        transition={{ duration: 0.35, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path d="M27 46 C27 56 30 60 32 63 C34 60 37 56 37 46 Z" fill="#ff6a00" opacity="0.85" />
        <path d="M29 46 C29 53 31 56 32 58 C33 56 35 53 35 46 Z" fill="url(#rkt-flame-core)" />
      </motion.g>

      {/* Fins (swept back) */}
      <path d="M24 34 C18 38 16 44 17 49 C21 46 24 44 26 42 Z" fill="url(#rkt-fin)" />
      <path d="M40 34 C46 38 48 44 47 49 C43 46 40 44 38 42 Z" fill="url(#rkt-fin)" />

      {/* Body — capsule with pointed nose */}
      <path
        d="M32 2 C39 10 42 20 42 30 C42 38 38 44 32 46 C26 44 22 38 22 30 C22 20 25 10 32 2 Z"
        fill="url(#rkt-body)"
        stroke="#6f5fcc"
        strokeWidth="1"
      />
      {/* Nose tint */}
      <path d="M32 2 C35.5 6 38 11 39.3 16 L24.7 16 C26 11 28.5 6 32 2 Z" fill="#a855f7" opacity="0.9" />
      {/* Porthole */}
      <circle cx="32" cy="24" r="5.4" fill="url(#rkt-glass)" stroke="#efeaff" strokeWidth="1.4" />
      {/* Nozzle */}
      <path d="M27 44 L37 44 L35.5 48 L28.5 48 Z" fill="#4c4470" />
    </svg>
  );
}
