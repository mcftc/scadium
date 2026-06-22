'use client';

import { useEffect, useRef, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useReducedMotion } from 'framer-motion';
import type { InstantSettleResult } from '@/hooks/use-instant-game';
import type { GameSound } from '@/components/instant/use-game-sound';
import { formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Shared celebration for the instant games. Fires a `canvas-confetti` burst on a
 * win (scaled by multiplier — bigger win, more particles), counts the payout up,
 * and glows the balance. Server-authoritative: it only renders/animates the
 * server's `last` result; it never derives an outcome. Honors reduced-motion by
 * skipping confetti and snapping the count-up.
 */
export function WinEffect({
  last,
  sound,
}: {
  last: InstantSettleResult | null;
  sound?: GameSound;
}) {
  const reduce = useReducedMotion();
  const lastBetId = useRef<string | null>(null);

  // Fire confetti + win sound exactly once per fresh winning result.
  useEffect(() => {
    if (!last || last.betId === lastBetId.current) return;
    lastBetId.current = last.betId;
    if (!last.won) {
      sound?.lose();
      return;
    }
    sound?.win(last.multiplier);
    if (reduce) return;
    void fireConfetti(last.multiplier);
  }, [last, reduce, sound]);

  if (!last) return null;

  return (
    <div
      className={cn(
        'rounded-2xl border p-4 flex items-center justify-between transition-colors',
        last.won ? 'border-success/40 bg-success/5' : 'border-danger/30',
      )}
    >
      <div>
        <div className="text-[10px] uppercase tracking-wider text-foreground-muted">
          {last.won ? `Win · ${last.multiplier}×` : 'Loss'}
        </div>
        <div className={cn('text-lg font-bold', last.won ? 'text-success' : 'text-danger')}>
          {last.won ? (
            <span>
              +<CountUpSol lamports={last.payoutLamports} animate={!reduce} />
            </span>
          ) : (
            'No payout'
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-foreground-muted">Balance</div>
          <div
            className={cn(
              'font-mono text-sm transition-all',
              last.won && !reduce && 'animate-balance-glow',
            )}
          >
            {formatSol(last.balanceLamports, 3)}
          </div>
        </div>
        {sound && (
          <button
            type="button"
            onClick={sound.toggle}
            aria-label={sound.enabled ? 'Mute sound' : 'Unmute sound'}
            title={sound.enabled ? 'Mute sound' : 'Unmute sound'}
            className="rounded-lg border border-border p-1.5 text-foreground-muted hover:text-foreground hover:border-primary-400/40 transition-colors"
          >
            {sound.enabled ? (
              <Volume2 className="h-3.5 w-3.5" />
            ) : (
              <VolumeX className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/** Count a lamports payout up from 0 → value over ~600ms (ease-out). */
function CountUpSol({ lamports, animate }: { lamports: string; animate: boolean }) {
  const target = Number(lamports);
  const [val, setVal] = useState(animate ? 0 : target);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (!animate || !Number.isFinite(target)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- snaps the count-up to the final value when animation is skipped; the effect also drives the RAF animation toward `target`, so the displayed number is animation state, not derivable during render.
      setVal(target);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 600);
      const eased = 1 - (1 - t) * (1 - t);
      setVal(target * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, animate]);

  return <span className="tabular-nums">{formatSol(String(Math.round(val)), 3)}</span>;
}

/** Lazy-load canvas-confetti so it never ships in the SSR/initial bundle path. */
async function fireConfetti(multiplier: number): Promise<void> {
  try {
    const confetti = (await import('canvas-confetti')).default;
    const intensity = Math.min(3, Math.max(1, Math.log2(Math.max(1, multiplier) + 1)));
    const particleCount = Math.round(60 * intensity);
    const colors = ['#EE86FF', '#C76BFF', '#10b981', '#9C4FE0'];
    confetti({
      particleCount,
      spread: 70 + intensity * 15,
      startVelocity: 38 + intensity * 6,
      origin: { y: 0.6 },
      colors,
      scalar: 0.9 + intensity * 0.15,
    });
    if (intensity > 1.6) {
      // Big-win second burst from the sides.
      setTimeout(() => {
        confetti({ particleCount: 40, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors });
        confetti({ particleCount: 40, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors });
      }, 180);
    }
  } catch {
    /* confetti is best-effort; never block the result */
  }
}
