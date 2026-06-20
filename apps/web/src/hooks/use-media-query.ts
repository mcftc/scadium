'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe `matchMedia` hook. Returns `false` on the server (so SSR markup is
 * deterministic), but on the client the FIRST render already reflects the real
 * match via a lazy initializer — so the first dropdown open on mobile renders
 * the bottom sheet (and locks scroll) instead of flashing the desktop popover.
 * The effect+listener keep it in sync with later viewport changes. Used by the
 * header dropdowns to switch between a desktop popover and a mobile bottom sheet.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
