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
    if (!publicKey) {
      setLamports(null);
      return;
    }

    let cancelled = false;
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

  return {
    lamports,
    sol: lamports !== null ? lamports / LAMPORTS_PER_SOL : null,
    loading,
  };
}
