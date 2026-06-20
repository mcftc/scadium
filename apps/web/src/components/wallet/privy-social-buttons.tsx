'use client';

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { usePrivyAuth } from '@/hooks/use-privy-auth';
import { cn } from '@/lib/cn';

interface PrivySocialButtonsProps {
  /** Called once the Privy → Scadium JWT exchange has succeeded. */
  onSuccess: () => void;
}

/**
 * "Continue with Google / Apple" buttons (#203). ADDITIVE to the SIWS wallet
 * list — rendered ABOVE it in the connect modal, only when Privy is configured
 * (the parent gates on `env.privyAppId`, so `usePrivyAuth` is always inside
 * <PrivyAppProvider>). The actual login + token-exchange lives in `usePrivyAuth`.
 */
export function PrivySocialButtons({ onSuccess }: PrivySocialButtonsProps) {
  const { signInWith, status, error } = usePrivyAuth();
  const busy = status === 'connecting' || status === 'exchanging';

  // Notify the parent (so it can close the modal) once the exchange succeeds.
  useEffect(() => {
    if (status === 'success') onSuccess();
  }, [status, onSuccess]);

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => signInWith('google')}
        className={cn(
          'w-full flex items-center justify-center gap-3 rounded-xl border border-border bg-surface-elevated p-3 text-sm font-semibold transition-colors',
          'hover:border-primary-400/50 hover:bg-surface disabled:opacity-60 disabled:cursor-not-allowed',
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
        Continue with Google
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => signInWith('apple')}
        className={cn(
          'w-full flex items-center justify-center gap-3 rounded-xl border border-border bg-surface-elevated p-3 text-sm font-semibold transition-colors',
          'hover:border-primary-400/50 hover:bg-surface disabled:opacity-60 disabled:cursor-not-allowed',
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <AppleIcon />}
        Continue with Apple
      </button>

      {status === 'error' && error && <p className="text-xs text-danger">{error}</p>}

      <div className="flex items-center gap-3 pt-1">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs uppercase tracking-wider text-foreground-muted">
          or connect a wallet
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M17.05 12.7c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.01-3.77-2.04-1.6-.16-3.13.94-3.94.94-.81 0-2.07-.92-3.4-.9-1.75.03-3.36 1.02-4.26 2.58-1.82 3.16-.47 7.83 1.3 10.39.86 1.25 1.89 2.66 3.24 2.61 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.39.81 1.4-.02 2.29-1.27 3.15-2.53.99-1.45 1.4-2.86 1.42-2.93-.03-.01-2.72-1.04-2.75-4.13l-.01-.13c.01.21.01.42.01.6ZM14.5 5.1c.72-.87 1.2-2.08 1.07-3.29-1.03.04-2.28.69-3.02 1.56-.66.77-1.24 2-1.09 3.18 1.15.09 2.32-.58 3.04-1.45Z" />
    </svg>
  );
}
