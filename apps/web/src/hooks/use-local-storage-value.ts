'use client';

import { useCallback, useSyncExternalStore } from 'react';

const NOTIFY_EVENT = 'scadium:localstorage';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    /* localStorage blocked (private mode) */
    return null;
  }
}

/**
 * Persist a value under `key` and notify same-tab subscribers so any
 * `useLocalStorageValue(key)` re-reads immediately (the native `storage` event
 * only fires in OTHER tabs).
 */
export function writeLocalStorageValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode — nothing to persist */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(NOTIFY_EVENT, { detail: key }));
  }
}

/**
 * Reactive, SSR-safe read of a `localStorage` string. Returns `null` on the
 * server and the first client render (so server/client markup match — no
 * hydration mismatch, no flash), then the real value once hydrated. Re-reads on
 * cross-tab `storage` events and on same-tab writes via `writeLocalStorageValue`.
 *
 * Replaces the `useEffect(() => setX(localStorage.getItem(...)), [])` pattern
 * (a setState-in-effect) used by the compliance gates.
 */
export function useLocalStorageValue(key: string): string | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const onStorage = (e: StorageEvent) => {
        if (e.key === key || e.key === null) onChange();
      };
      const onLocal = (e: Event) => {
        if ((e as CustomEvent<string>).detail === key) onChange();
      };
      window.addEventListener('storage', onStorage);
      window.addEventListener(NOTIFY_EVENT, onLocal);
      return () => {
        window.removeEventListener('storage', onStorage);
        window.removeEventListener(NOTIFY_EVENT, onLocal);
      };
    },
    [key],
  );

  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
}
