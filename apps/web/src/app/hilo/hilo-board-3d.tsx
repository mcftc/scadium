'use client';

import dynamic from 'next/dynamic';
import { GameStage } from '@/components/three/game-stage';
import type { HiloDirection } from '@scadium/shared';

const HiloStage = dynamic(() => import('@/components/three/hilo-scene'), {
  ssr: false,
  loading: () => null,
});

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];

/** 2D fallback card (SSR / chunk load / no WebGL / reduced motion). */
function Fallback({ card }: { card: number }) {
  const suit = Math.floor(card / 13);
  const red = suit === 1 || suit === 2;
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div
        data-testid="hilo-card"
        className={
          'flex h-44 w-32 flex-col items-center justify-center rounded-xl border border-border bg-surface-elevated ' +
          (red ? 'text-red-400' : 'text-foreground')
        }
      >
        <span className="text-4xl font-bold">{RANKS[card % 13]}</span>
        <span className="text-5xl">{SUITS[suit]}</span>
      </div>
    </div>
  );
}

/** The Hi-Lo card theater: approved flat 3D card + a 2D fallback card. */
export function HiloBoard3D({
  card,
  busted,
  celebrate,
  locked,
  onGuess,
}: {
  card: number;
  busted?: boolean;
  celebrate?: boolean;
  locked?: boolean;
  onGuess?: (d: HiloDirection) => void;
}) {
  return (
    <div className="relative mx-auto aspect-video w-full">
      <GameStage className="h-full w-full" interactive fallback={<Fallback card={card} />}>
        <HiloStage card={card} busted={busted} celebrate={celebrate} locked={locked} onGuess={onGuess} />
      </GameStage>
    </div>
  );
}
