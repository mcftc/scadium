'use client';

import dynamic from 'next/dynamic';
import { GameStage } from '@/components/three/game-stage';
import { FlipCoin, type CoinSide } from './flip-coin';

// Bundle-split point: three.js and the scene stay in async chunks.
const CoinStage = dynamic(() => import('./coin-scene'), { ssr: false, loading: () => null });

/**
 * Drop-in 3D upgrade of FlipCoin — identical contract, plus an optional
 * `celebrate` flag that fires a confetti burst when the toss lands. Falls back
 * to the original DOM coin while the chunk loads, without WebGL, or with
 * reduced motion.
 */
export function FlipCoin3D({
  result = 'heads',
  spinning = false,
  size = 160,
  celebrate = false,
  speed = 1,
  onSpinComplete,
}: {
  result?: CoinSide;
  spinning?: boolean;
  size?: number;
  celebrate?: boolean;
  /** Animation speed multiplier (preview slow-motion); leave at 1 in games. */
  speed?: number;
  onSpinComplete?: () => void;
}) {
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <GameStage
        className="h-full w-full"
        fallback={
          <FlipCoin
            result={result}
            spinning={spinning}
            size={size}
            onSpinComplete={onSpinComplete}
          />
        }
      >
        <CoinStage
          result={result}
          spinning={spinning}
          celebrate={celebrate}
          speed={speed}
          onSpinComplete={onSpinComplete}
        />
      </GameStage>
    </div>
  );
}
