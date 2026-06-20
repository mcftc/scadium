'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * SSR-safe `matchMedia` hook. Returns `false` on the server (so SSR markup is
 * deterministic), but on the client the FIRST render already reflects the real
 * match via the external-store snapshot — so the first dropdown open on mobile
 * renders the bottom sheet (and locks scroll) instead of flashing the desktop
 * popover. `useSyncExternalStore` keeps it in sync with later viewport changes
 * without a setState-in-effect. Used by the header dropdowns to switch between
 * a desktop popover and a mobile bottom sheet.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);
  const getServerSnapshot = () => false;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
