'use client';

import { useEffect, useState } from 'react';
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
 * Default-shown: the server render and the first client render both paint the
 * overlay (no hydration mismatch, no flash of interactive app for an un-acked
 * visitor); an effect hides it once a prior ack is found.
 */
export function AgeGate() {
  const { data: me } = useMe();
  const ackAge = useAckAge();
  const [localAck, setLocalAck] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(ACK_KEY) === '1') setLocalAck(true);
    } catch {
      /* localStorage blocked (private mode) — server ack still gates authed users */
    }
  }, []);

  const acked = localAck || !!me?.ageConfirmedAt;
  if (acked) return null;

  const handleConfirm = () => {
    try {
      window.localStorage.setItem(ACK_KEY, '1');
    } catch {
      /* private mode — in-memory state + server ack still cover this session */
    }
    setLocalAck(true);
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
