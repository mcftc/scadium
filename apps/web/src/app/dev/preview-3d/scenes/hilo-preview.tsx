'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { hiloStepMultiplier, HILO, type HiloDirection } from '@scadium/shared';
import { GameStage } from '@/components/three/game-stage';

const HiloStage = dynamic(() => import('@/components/three/hilo-scene'), {
  ssr: false,
  loading: () => null,
});

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const rankOf = (card: number) => card % 13;
const floor2 = (x: number) => Math.floor(x * 100) / 100;
const randomCard = () => Math.floor(Math.random() * 52);

function Fallback({ card }: { card: number }) {
  const red = Math.floor(card / 13) === 1 || Math.floor(card / 13) === 2;
  return (
    <div className="flex h-full w-full items-center justify-center bg-background">
      <div
        className={
          'flex h-40 w-28 flex-col items-center justify-center rounded-xl border border-border bg-surface-elevated ' +
          (red ? 'text-red-400' : 'text-foreground')
        }
      >
        <span className="text-3xl font-bold">{RANKS[rankOf(card)]}</span>
        <span className="text-4xl">{SUITS[Math.floor(card / 13)]}</span>
      </div>
    </div>
  );
}

export function HiloPreview() {
  const [card, setCard] = useState(randomCard);
  const [cumMult, setCumMult] = useState(1);
  const [steps, setSteps] = useState(0);
  const [busted, setBusted] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const ended = busted || celebrate;
  const rank = rankOf(card);
  const higherMult = hiloStepMultiplier(rank, 'higher');
  const lowerMult = hiloStepMultiplier(rank, 'lower');

  const guess = (direction: HiloDirection) => {
    if (ended) return;
    const next = randomCard();
    const nextRank = rankOf(next);
    const correct = direction === 'higher' ? nextRank >= rank : nextRank <= rank;
    if (!correct) {
      setCard(next);
      setBusted(true);
      return;
    }
    setCard(next);
    setCumMult(floor2(cumMult * hiloStepMultiplier(rank, direction)));
    const newSteps = steps + 1;
    setSteps(newSteps);
    if (newSteps >= HILO.MAX_STEPS) setCelebrate(true);
  };

  const newRound = () => {
    setCard(randomCard());
    setCumMult(1);
    setSteps(0);
    setBusted(false);
    setCelebrate(false);
  };

  return (
    <div className="space-y-5">
      <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-2xl border border-border bg-background">
        <GameStage className="h-full w-full" interactive fallback={<Fallback card={card} />}>
          <HiloStage
            card={card}
            busted={busted}
            celebrate={celebrate}
            locked={ended}
            onGuess={guess}
          />
        </GameStage>

        <div className="pointer-events-none absolute left-4 top-4 rounded-xl border border-border bg-background/70 px-4 py-2 backdrop-blur">
          <div className="text-2xl font-bold text-cyan-300">
            {steps > 0 ? cumMult.toFixed(2) : '1.00'}×
          </div>
          <div className="text-xs text-foreground-muted">
            {ended
              ? busted
                ? '💥 busted'
                : '✨ max streak'
              : `▲ higher ${higherMult.toFixed(2)}× · ▼ lower ${lowerMult.toFixed(2)}×`}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => guess('higher')}
          disabled={ended}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          ▲ Higher or same ({higherMult.toFixed(2)}×)
        </button>
        <button
          type="button"
          onClick={() => guess('lower')}
          disabled={ended}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          ▼ Lower or same ({lowerMult.toFixed(2)}×)
        </button>
        <button
          type="button"
          onClick={newRound}
          className="rounded-lg border border-border bg-surface-elevated px-4 py-2 text-sm font-semibold text-foreground hover:text-primary-400"
        >
          New round
        </button>
        <span className="ml-auto text-sm text-foreground-muted">
          streak {steps} · click an arrow on the card or a button
        </span>
      </div>
    </div>
  );
}
