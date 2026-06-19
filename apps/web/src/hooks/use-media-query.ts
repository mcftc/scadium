'use client';

import { useEffect, useState } from 'react';

/**
 * SSR-safe `matchMedia` hook. Returns `false` on the server and on the first
 * client render (so markup is deterministic), then syncs to the real match
 * after mount. Used by the header dropdowns to switch between a desktop popover
 * and a mobile bottom sheet.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
