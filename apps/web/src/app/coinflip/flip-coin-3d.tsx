'use client';

import dynamic from 'next/dynamic';
import { GameStage } from '@/components/three/game-stage';
import { FlipCoin, type CoinSide } from './flip-coin';

// Bundle-split point: three.js and the scene stay in async chunks.
const CoinStage = dynamic(() => import('./coin-scene'), { ssr: false, loading: () => null });

/**
 * The $SCAD coin toss theater: an android flicks the coin while the crowd
 * watches, the camera rides in as the spin decays, and the result face (robot
 * emblem = heads, 1 SCAD = tails) is only readable at the end. Falls back to
 * the original DOM coin while the chunk loads, without WebGL, or with reduced
 * motion. Same contract as FlipCoin plus `celebrate`.
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
  /** Height of the 2D fallback coin; the 3D stage itself is a 16:9 tableau. */
  size?: number;
  celebrate?: boolean;
  /** Animation speed multiplier (preview slow-motion); clamped > 0 in the scene. */
  speed?: number;
  onSpinComplete?: () => void;
}) {
  return (
    <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-xl">
      <GameStage
        className="h-full w-full"
        fallback={
          <div className="flex h-full w-full items-center justify-center">
            <FlipCoin
              result={result}
              spinning={spinning}
              size={size}
              onSpinComplete={onSpinComplete}
            />
          </div>
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
