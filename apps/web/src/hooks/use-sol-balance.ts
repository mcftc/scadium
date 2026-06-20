'use client';

import { useEffect, useState } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * Live SOL balance for the connected wallet. Subscribes to
 * `connection.onAccountChange` so the number updates in real time as the
 * wallet receives or spends lamports.
 */
export function useSolBalance() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [lamports, setLamports] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!publicKey) return;

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- enters the loading state before kicking off the async balance fetch (resolved by the .then/.catch/.finally below); standard subscribe-to-external-system fetch pattern.
    setLoading(true);

    connection
      .getBalance(publicKey)
      .then((bal) => {
        if (!cancelled) setLamports(bal);
      })
      .catch(() => {
        if (!cancelled) setLamports(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const sub = connection.onAccountChange(publicKey, (info) => {
      setLamports(info.lamports);
    });

    return () => {
      cancelled = true;
      void connection.removeAccountChangeListener(sub);
    };
  }, [connection, publicKey]);

  // Derive null when no wallet is connected rather than resetting state in the
  // effect — keeps the disconnect path setState-free and avoids a stale balance.
  const effectiveLamports = publicKey ? lamports : null;

  return {
    lamports: effectiveLamports,
    sol: effectiveLamports !== null ? effectiveLamports / LAMPORTS_PER_SOL : null,
    loading,
  };
}
