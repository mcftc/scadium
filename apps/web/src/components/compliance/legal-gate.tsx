'use client';

import Link from 'next/link';
import { useHydrated } from '@/hooks/use-hydrated';
import { useLocalStorageValue, writeLocalStorageValue } from '@/hooks/use-local-storage-value';
import { useMe, useAcceptLegal } from '@/hooks/use-me';
import { LEGAL_VERSION } from '@/lib/legal/versions';

const LS_KEY = 'scadium_legal_version';

/**
 * Blocking legal-acceptance gate (#48). Requires accepting the CURRENT
 * `LEGAL_VERSION` before use; re-triggers automatically when the version is
 * bumped (the stored/accepted version no longer matches). Anonymous users
 * accept via localStorage; authed users via `POST /me/accept-legal`
 * (`User.acceptedLegalVersion`). Mounted below the age gate (lower z-index) so
 * the 18+ confirmation comes first.
 *
 * Hydration-gated (mirrors `AgeGate`): `useLocalStorageValue` returns `null` on
 * the server and the first client render, so a user who already accepted would
 * otherwise see the overlay painted into the SSR HTML and flash on EVERY refresh
 * before the effect re-reads localStorage. We render nothing until hydrated, then
 * show the gate only when the current version hasn't been accepted. No SSR flash.
 */
export function LegalGate() {
  const hydrated = useHydrated();
  const { data: me } = useMe();
  const acceptLegal = useAcceptLegal();
  const localVersion = useLocalStorageValue(LS_KEY);

  const accepted = me?.acceptedLegalVersion === LEGAL_VERSION || localVersion === LEGAL_VERSION;
  if (!hydrated || accepted) return null;

  const handleAccept = () => {
    writeLocalStorageValue(LS_KEY, LEGAL_VERSION);
    if (me) acceptLegal.mutate();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-gate-title"
      className="fixed inset-0 z-[95] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-2xl">
        <h2 id="legal-gate-title" className="text-xl font-black">
          Accept our terms to continue
        </h2>
        <p className="mt-3 text-sm text-foreground-muted">
          By continuing you agree to our{' '}
          <Link href="/tos" className="text-primary-400 underline">
            Terms
          </Link>
          ,{' '}
          <Link href="/privacy" className="text-primary-400 underline">
            Privacy
          </Link>
          ,{' '}
          <Link href="/aml" className="text-primary-400 underline">
            AML
          </Link>{' '}
          and{' '}
          <Link href="/cookie" className="text-primary-400 underline">
            Cookie
          </Link>{' '}
          policies (version {LEGAL_VERSION}).
        </p>
        <button
          type="button"
          autoFocus
          onClick={handleAccept}
          className="mt-6 rounded-xl bg-gradient-primary px-6 py-3 text-sm font-bold text-white shadow-glow-sm"
        >
          I accept
        </button>
      </div>
    </div>
  );
}
