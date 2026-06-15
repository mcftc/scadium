const KEY = 'scadium_ref';
const REF_RE = /^[A-Za-z0-9]{4,16}$/;

/**
 * Capture a `?ref=CODE` affiliate code from the URL on first visit and persist
 * it (localStorage) until sign-in consumes it (#47). First-write-wins so a later
 * link doesn't overwrite the original referrer.
 */
export function captureRef(search: string): void {
  try {
    const ref = new URLSearchParams(search).get('ref');
    if (ref && REF_RE.test(ref) && !window.localStorage.getItem(KEY)) {
      window.localStorage.setItem(KEY, ref);
    }
  } catch {
    /* localStorage unavailable — ref capture is best-effort */
  }
}

/** The captured referral code to send on `POST /auth/verify`, if any. */
export function getRef(): string | undefined {
  try {
    const v = window.localStorage.getItem(KEY);
    return v && REF_RE.test(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Consume the captured code after a successful sign-in. */
export function clearRef(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
