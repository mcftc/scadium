'use client';

import { useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useAuthStore } from '@/store/auth-store';
import { useSiwsSignIn } from '@/hooks/use-siws-sign-in';

/**
 * Heals adapter↔session mismatches. The JWT session survives reloads via
 * localStorage, but a regenerating wallet (the burner) comes back with a
 * NEW keypair — transactions would then be signed by a wallet the session
 * doesn't belong to (and typically an unfunded one). When a live adapter
 * key differs from the session address, re-run SIWS so the session follows
 * the signer.
 */
export function WalletSessionGuard() {
  const { publicKey, connected } = useWallet();
  const walletAddress = useAuthStore((s) => s.walletAddress);
  const { signIn } = useSiwsSignIn();
  const busy = useRef(false);

  useEffect(() => {
    if (!connected || !publicKey || busy.current) return;
    if (!walletAddress || walletAddress === publicKey.toBase58()) return;
    busy.current = true;
    void signIn()
      .catch(() => {
        /* user may reject the signature — leave the old session in place */
      })
      .finally(() => {
        busy.current = false;
      });
  }, [connected, publicKey, walletAddress, signIn]);

  return null;
}
