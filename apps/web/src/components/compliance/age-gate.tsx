'use client';

import { useHydrated } from '@/hooks/use-hydrated';
import { useLocalStorageValue, writeLocalStorageValue } from '@/hooks/use-local-storage-value';
import { useMe, useAckAge } from '@/hooks/use-me';

const ACK_KEY = 'scadium_age_ok';
const DECLINE_URL = 'https://www.google.com';

/**
 * Blocking 18+ age gate (#44). A full-screen modal covers the app until the
 * user confirms they are of legal age. The acknowledgement persists in
 * localStorage for anonymous users and via `POST /me/age-ack`
 * (`User.ageConfirmedAt`) for authed users, so a confirmed user never sees it
 * again. Declining navigates away.
 *
 * Hydration-gated (mirrors `CookieBanner`): `useLocalStorageValue` returns
 * `null` on the server and the first client render, so a previously-acked user
 * would otherwise see the overlay painted in the SSR HTML and flash on EVERY
 * refresh before the effect re-reads localStorage. We therefore render nothing
 * until hydrated, then show the gate only when there is no prior ack. No SSR
 * flash, and an acked user never sees it again.
 */
export function AgeGate() {
  const hydrated = useHydrated();
  const { data: me } = useMe();
  const ackAge = useAckAge();
  const localAck = useLocalStorageValue(ACK_KEY) === '1';

  const acked = localAck || !!me?.ageConfirmedAt;
  if (!hydrated || acked) return null;

  const handleConfirm = () => {
    writeLocalStorageValue(ACK_KEY, '1');
    if (me) ackAge.mutate();
  };

  const handleLeave = () => {
    window.location.href = DECLINE_URL;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="age-gate-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-2xl">
        <div className="mb-4 text-4xl">🔞</div>
        <h2 id="age-gate-title" className="text-xl font-black">
          You must be 18+ to use Scadium
        </h2>
        <p className="mt-3 text-sm text-foreground-muted">
          Scadium is a gambling platform. By entering you confirm you are at least 18 years old (or
          the legal age in your jurisdiction) and accept the risks of play.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            autoFocus
            onClick={handleConfirm}
            className="rounded-xl bg-gradient-primary px-6 py-3 text-sm font-bold text-white shadow-glow-sm"
          >
            I am 18 or older — Enter
          </button>
          <button
            type="button"
            onClick={handleLeave}
            className="rounded-xl border border-border px-6 py-3 text-sm font-bold text-foreground-muted transition-colors hover:text-foreground"
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
