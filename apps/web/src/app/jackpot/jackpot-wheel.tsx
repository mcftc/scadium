'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useState } from 'react';
import { Crown } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { GameStage } from '@/components/three/game-stage';
import { formatSol, shortAddress } from '@/lib/format';
import { cn } from '@/lib/cn';
import { JackpotReel, type JackpotReveal } from './jackpot-reel';

const WheelStage = dynamic(() => import('./wheel-scene'), { ssr: false, loading: () => null });

const HOLD_MS = 3500; // winner banner dwell — same as the reel

/**
 * 3D winner reveal: a roulette of players (wedge ∝ pot share) spins under an
 * amber pointer and decelerates onto the winner; marquee bulbs chase, the
 * winning wedge pops and pulses, gold confetti for the crowd. Same contract
 * as JackpotReel, which remains the no-WebGL fallback.
 */
export function JackpotWheel({ reveal, onDone }: { reveal: JackpotReveal; onDone: () => void }) {
  const [won, setWon] = useState(false);

  const handleLanded = useCallback(() => setWon(true), []);

  useEffect(() => {
    if (!won) return;
    const timer = setTimeout(onDone, HOLD_MS);
    return () => clearTimeout(timer);
  }, [won, onDone]);

  const winner = reveal.players.find((p) => p.userId === reveal.winnerId);
  const winnerName =
    reveal.winnerName ?? (winner ? shortAddress(winner.walletAddress) : 'anon');
  const iWon = !!reveal.meId && reveal.winnerId === reveal.meId;

  return (
    <Card className="p-5 relative overflow-hidden">
      <div className="text-[10px] uppercase tracking-[0.4em] text-amber-400/80 mb-3 text-center">
        {won ? 'Winner' : 'Drawing winner…'}
      </div>
      <GameStage
        className="h-80 w-full overflow-hidden rounded-xl"
        fallback={<JackpotReel reveal={reveal} onDone={onDone} />}
      >
        <WheelStage reveal={reveal} onLanded={handleLanded} />
      </GameStage>
      {won && (
        <div className="mt-4 flex items-center justify-center gap-2 text-base animate-in fade-in">
          <Crown className="h-5 w-5 text-amber-400" />
          <span className={cn('font-bold', iWon && 'text-success')}>
            {iWon ? 'You won' : `${winnerName} won`}
          </span>
          <span className="font-mono font-bold text-success">
            +{formatSol(reveal.payoutLamports, 3)}
          </span>
        </div>
      )}
    </Card>
  );
}
