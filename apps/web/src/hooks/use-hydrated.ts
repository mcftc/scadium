'use client';

import { useSyncExternalStore } from 'react';

const emptySubscribe = () => () => {};

/**
 * Returns `false` during SSR and the first (hydration) client render, then
 * `true` once mounted on the client — without a setState-in-effect. Uses
 * `useSyncExternalStore`'s server/client snapshot split so React flips the
 * value as part of hydration rather than via a cascading effect render.
 *
 * Replaces the `const [mounted, setMounted] = useState(false);
 * useEffect(() => setMounted(true), [])` hydration-gate pattern.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}
