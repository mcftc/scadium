'use client';

import { useCallback, useState } from 'react';
import { usePrivy, useLogin, PrivyErrorCode } from '@privy-io/react-auth';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { getRef, clearRef } from '@/lib/ref-capture';

interface PrivyVerifyResponse {
  accessToken: string;
  refreshToken: string;
  walletAddress: string;
}

type PrivyLoginMethod = 'google' | 'apple';

/**
 * Privy social-login → Scadium JWT exchange (#203). The mirror image of
 * `useSiwsSignIn`, but the proof of identity is a Privy access token instead of
 * an ed25519 signature:
 *
 *   1. `login({ loginMethods: ['google'|'apple'] })` opens Privy's modal.
 *   2. On `onComplete` (authenticated), fetch the Privy access token via
 *      `getAccessToken()`.
 *   3. POST it to /auth/privy → backend VERIFIES the token server-side and
 *      returns the same access+refresh pair as SIWS.
 *   4. Persist into the existing auth store, exactly like SIWS.
 *
 * The browser never asserts the user's email/wallet — the backend derives those
 * from the verified token. This hook MUST be rendered inside <PrivyAppProvider>
 * (i.e. only when NEXT_PUBLIC_PRIVY_APP_ID is set); see `PrivySocialButtons`.
 */
export function usePrivyAuth() {
  const { getAccessToken, logout } = usePrivy();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'exchanging' | 'success' | 'error'>(
    'idle',
  );
  const [error, setError] = useState<string | null>(null);

  // Runs once Privy reports the user authenticated (new OR already-logged-in).
  const exchange = useCallback(async () => {
    setStatus('exchanging');
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Could not retrieve Privy session');

      const { accessToken, refreshToken, walletAddress } = await api<PrivyVerifyResponse>(
        '/auth/privy',
        { method: 'POST', body: { accessToken: token, ref: getRef() } },
      );

      clearRef();
      setAuth({ accessToken, refreshToken, walletAddress });
      setStatus('success');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Social sign-in failed');
      // Drop the Privy session so a retry starts clean and the user isn't left
      // "logged into Privy" but not into Scadium.
      try {
        await logout();
      } catch {
        /* noop */
      }
    }
  }, [getAccessToken, logout, setAuth]);

  const { login } = useLogin({
    onComplete: () => {
      void exchange();
    },
    onError: (err) => {
      // User-cancelled is not an error worth surfacing loudly.
      if (err === PrivyErrorCode.USER_EXITED_AUTH_FLOW) {
        setStatus('idle');
        return;
      }
      setStatus('error');
      setError('Social sign-in failed');
    },
  });

  const signInWith = useCallback(
    (method: PrivyLoginMethod) => {
      setError(null);
      setStatus('connecting');
      login({ loginMethods: [method] });
    },
    [login],
  );

  return { signInWith, status, error };
}
