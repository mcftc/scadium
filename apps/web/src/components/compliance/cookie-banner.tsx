'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const LS_KEY = 'scadium_cookie_consent';
export type CookieConsent = 'accepted' | 'rejected';

/** Read the persisted cookie-consent choice (null = not decided / SSR). */
export function getCookieConsent(): CookieConsent | null {
  try {
    const v = window.localStorage.getItem(LS_KEY);
    return v === 'accepted' || v === 'rejected' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Cookie/consent banner (#48). Non-essential analytics/tracking must not run
 * before consent — gate any such script on `getCookieConsent() === 'accepted'`.
 * The choice persists so the banner does not reappear every visit. Defaults to
 * "decided" on the server render to avoid an SSR flash; an effect reveals it for
 * undecided visitors after mount.
 */
export function CookieBanner() {
  // Hidden by default so the server render and first client render match (no
  // SSR flash); the effect reveals it only for an undecided visitor.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (getCookieConsent() === null) setShow(true);
  }, []);

  if (!show) return null;

  const decide = (value: CookieConsent) => {
    try {
      window.localStorage.setItem(LS_KEY, value);
    } catch {
      /* private mode — nothing to persist; essential-only is the safe default */
    }
    setShow(false);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[80] border-t border-border bg-surface/95 p-4 backdrop-blur-sm">
      <div className="mx-auto flex max-w-4xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="text-xs text-foreground-muted">
          We use essential cookies to run the site. Non-essential analytics load only if you accept.
          See our{' '}
          <Link href="/cookie" className="text-primary-400 underline">
            Cookie Policy
          </Link>
          .
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => decide('rejected')}
            className="rounded-lg border border-border px-4 py-2 text-xs font-bold text-foreground-muted transition-colors hover:text-foreground"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => decide('accepted')}
            className="rounded-lg bg-gradient-primary px-4 py-2 text-xs font-bold text-white"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
