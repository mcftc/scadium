'use client';

import type { ReactNode } from 'react';
import { useChainEnabled } from '@/hooks/use-chain-enabled';

/**
 * Renders the on-chain settlement claim only when on-chain settlement is
 * genuinely live; otherwise honest play-money copy. Lets server components gate
 * marketing copy on the runtime `chain.enabled` flag without each one
 * re-fetching the config (#42). All gating flows through `useChainEnabled`.
 */
export function ChainCopy({ onchain, playMoney }: { onchain: ReactNode; playMoney: ReactNode }) {
  const enabled = useChainEnabled();
  return <>{enabled ? onchain : playMoney}</>;
}
