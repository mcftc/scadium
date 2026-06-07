'use client';

import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

export type CoinSide = 'heads' | 'tails';

/**
 * Scadium's own 3D coin — two CSS faces on a preserve-3d stage. `spinning`
 * plays a multi-revolution framer-motion flip that lands on `result`
 * (heads = front, tails = back); when idle it just shows `result` (or heads).
 * The faces are our design: H on the primary-purple face, T on the cyan one,
 * with a ridged rim drawn via repeating-conic-gradient.
 */
export function FlipCoin({
  result = 'heads',
  spinning = false,
  size = 160,
  onSpinComplete,
}: {
  result?: CoinSide;
  spinning?: boolean;
  size?: number;
  onSpinComplete?: () => void;
}) {
  // 5 full revolutions, then settle on the result face.
  const finalDeg = 1800 + (result === 'tails' ? 180 : 0);

  return (
    <div
      className="relative mx-auto"
      style={{ width: size, height: size, perspective: size * 6 }}
    >
      {/* Drop shadow that breathes with the toss */}
      <motion.div
        className="absolute left-1/2 -translate-x-1/2 rounded-[50%] bg-black/50 blur-md"
        style={{ width: size * 0.7, height: size * 0.12, bottom: -size * 0.18 }}
        animate={
          spinning
            ? { scaleX: [1, 0.55, 1], opacity: [0.5, 0.25, 0.5] }
            : { scaleX: 1, opacity: 0.5 }
        }
        transition={{ duration: 2.4, ease: 'easeInOut' }}
      />
      <motion.div
        className="relative h-full w-full"
        style={{ transformStyle: 'preserve-3d' }}
        initial={false}
        animate={
          spinning
            ? { rotateY: finalDeg, y: [0, -size * 0.35, 0] }
            : { rotateY: result === 'tails' ? 180 : 0, y: 0 }
        }
        transition={
          spinning
            ? {
                rotateY: { duration: 2.4, ease: [0.2, 0.6, 0.3, 1] },
                y: { duration: 2.4, ease: 'easeInOut' },
              }
            : { duration: 0 }
        }
        onAnimationComplete={() => {
          if (spinning) onSpinComplete?.();
        }}
      >
        <CoinFace side="heads" size={size} />
        <CoinFace side="tails" size={size} flipped />
      </motion.div>
    </div>
  );
}

function CoinFace({
  side,
  size,
  flipped = false,
}: {
  side: CoinSide;
  size: number;
  flipped?: boolean;
}) {
  const heads = side === 'heads';
  return (
    <div
      className="absolute inset-0 rounded-full"
      style={{
        backfaceVisibility: 'hidden',
        transform: flipped ? 'rotateY(180deg)' : undefined,
        // Ridged rim: alternating light/dark wedges around the edge.
        background: `repeating-conic-gradient(${
          heads ? '#7c5fd4 0deg 6deg, #4c3f8f 6deg 12deg' : '#22a8c4 0deg 6deg, #156a80 6deg 12deg'
        })`,
        boxShadow: heads
          ? '0 0 30px rgba(168,85,247,0.45), inset 0 0 12px rgba(0,0,0,0.5)'
          : '0 0 30px rgba(34,211,238,0.45), inset 0 0 12px rgba(0,0,0,0.5)',
      }}
    >
      {/* Inner face */}
      <div
        className="absolute rounded-full flex items-center justify-center"
        style={{
          inset: size * 0.06,
          background: heads
            ? 'radial-gradient(circle at 35% 30%, #c4a8ff 0%, #8b5cf6 45%, #5b3fa8 100%)'
            : 'radial-gradient(circle at 35% 30%, #a5f3ff 0%, #22d3ee 45%, #0e7490 100%)',
        }}
      >
        {/* Embossed letter */}
        <span
          className="font-black select-none"
          style={{
            fontSize: size * 0.42,
            color: 'rgba(255,255,255,0.92)',
            textShadow: '0 2px 0 rgba(0,0,0,0.25), 0 0 18px rgba(255,255,255,0.35)',
          }}
        >
          {heads ? 'H' : 'T'}
        </span>
        {/* Glint */}
        <div
          className={cn('absolute rounded-full bg-white/25 blur-[2px]')}
          style={{
            width: size * 0.22,
            height: size * 0.1,
            top: size * 0.12,
            left: size * 0.16,
            transform: 'rotate(-30deg)',
          }}
        />
      </div>
    </div>
  );
}
