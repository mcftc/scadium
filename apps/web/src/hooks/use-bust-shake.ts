'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/**
 * Returns `true` for ~500ms whenever a NEW bust arrives (keyed by `bustKey`,
 * e.g. the losing settle's betId), so a board can apply `animate-screen-shake`.
 * No-op under reduced motion. Shared by the stateful game pages.
 */
export function useBustShake(bustKey: string | null): boolean {
  const reduce = useReducedMotion();
  const [shaking, setShaking] = useState(false);
  const prev = useRef<string | null>(null);

  useEffect(() => {
    if (bustKey && bustKey !== prev.current && !reduce) {
      prev.current = bustKey;
      setShaking(true);
      const t = setTimeout(() => setShaking(false), 500);
      return () => clearTimeout(t);
    }
    prev.current = bustKey;
  }, [bustKey, reduce]);

  return shaking;
}
