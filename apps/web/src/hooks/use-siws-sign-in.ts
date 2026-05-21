'use client';

import { useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';

interface NonceResponse {
  nonce: string;
  message: string;
}

interface VerifyResponse {
  accessToken: string;
  walletAddress: string;
}

/**
 * Sign-In With Solana (SIWS) flow.
 *
 *   1. POST /auth/nonce with walletAddress → backend returns a fresh nonce
 *      plus the exact canonical message to sign.
 *   2. Ask the wallet adapter to sign the message bytes (ed25519).
 *   3. POST /auth/verify with the base58-encoded signature → backend
 *      verifies and returns a short-lived JWT.
 *   4. Persist the JWT + wallet in the Zustand auth store.
 *
 * Any wallet that implements `signMessage` works. The returned promise
 * rejects with a descriptive Error so the UI can render it inline.
 */
export function useSiwsSignIn() {
  const { publicKey, signMessage, connected } = useWallet();
  const setAuth = useAuthStore((s) => s.setAuth);

  const signIn = useCallback(async () => {
    if (!connected || !publicKey) {
      throw new Error('Wallet not connected');
    }
    if (!signMessage) {
      throw new Error('This wallet does not support message signing');
    }

    const walletAddress = publicKey.toBase58();

    // 1. Request nonce
    const { nonce, message } = await api<NonceResponse>('/auth/nonce', {
      method: 'POST',
      body: { walletAddress },
    });

    // 2. Sign the exact message bytes
    const messageBytes = new TextEncoder().encode(message);
    let signatureBytes: Uint8Array;
    try {
      signatureBytes = await signMessage(messageBytes);
    } catch (e) {
      if (e instanceof Error && /reject|denied|user/i.test(e.message)) {
        throw new Error('Signature request rejected');
      }
      throw new Error('Wallet failed to sign message');
    }

    // 3. Verify & get JWT
    const { accessToken } = await api<VerifyResponse>('/auth/verify', {
      method: 'POST',
      body: {
        walletAddress,
        nonce,
        signature: bs58.encode(signatureBytes),
        message,
      },
    });

    // 4. Persist
    setAuth({ accessToken, walletAddress });
  }, [connected, publicKey, signMessage, setAuth]);

  return { signIn };
}
