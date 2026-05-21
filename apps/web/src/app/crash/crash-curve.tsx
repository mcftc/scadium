'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState, useMemo } from 'react';
import type { CrashSnapshot } from '@/hooks/use-crash';
import { cn } from '@/lib/cn';

/**
 * Immersive crash visualizer matching solpump.io:
 *  - 3D perspective grid (Tron-style receding floor)
 *  - Rocket emoji traveling along a neon curve
 *  - "CURRENT PAYOUT" + giant multiplier centered
 *  - Big countdown with "NEW ROUND / STARTING" during wait
 *  - Red flash on bust
 */
export function CrashCurve({ state }: { state: CrashSnapshot | null }) {
  const [countdown, setCountdown] = useState(6);

  useEffect(() => {
    if (state?.phase !== 'waiting') return;
    setCountdown(6);
    const interval = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 0.1));
    }, 100);
    return () => clearInterval(interval);
  }, [state?.phase, state?.roundId]);

  if (!state) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#080818]">
        <div className="text-foreground-muted animate-pulse">Connecting...</div>
      </div>
    );
  }

  const m = state.multiplier;
  const busted = state.phase === 'busted';
  const waiting = state.phase === 'waiting';
  const running = state.phase === 'running';

  return (
    <div className="absolute inset-0 bg-[#080818] overflow-hidden">
      {/* 3D Perspective Grid Floor */}
      <PerspectiveGrid />

      {/* Gradient atmosphere */}
      <div
        className={cn(
          'absolute inset-0 transition-all duration-500',
          busted
            ? 'bg-gradient-to-t from-red-900/40 via-transparent to-transparent'
            : running
              ? 'bg-gradient-to-t from-cyan-900/20 via-transparent to-transparent'
              : 'bg-gradient-to-t from-purple-900/15 via-transparent to-transparent',
        )}
      />

      {/* Multiplier ruler + horizontal grid lines */}
      <MultiplierRuler multiplier={m} phase={state.phase} />

      {/* Crash curve + rocket (only when running or busted) */}
      {(running || busted) && <CrashTrail multiplier={m} busted={busted} />}

      {/* Center display */}
      <div className="absolute inset-0 flex flex-col items-center justify-center z-10 pointer-events-none">
        <AnimatePresence mode="wait">
          {waiting && (
            <motion.div
              key="waiting"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="text-center"
            >
              <div className="text-xs uppercase tracking-[0.3em] text-foreground-muted/70 mb-3">
                New Round
              </div>
              <motion.div
                key={Math.ceil(countdown)}
                initial={{ scale: 1.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-8xl md:text-[10rem] font-black text-white/90 leading-none"
                style={{ textShadow: '0 0 60px rgba(168,85,247,0.5)' }}
              >
                {Math.ceil(countdown)}
              </motion.div>
              <div
                className="text-lg uppercase tracking-[0.4em] font-bold mt-2"
                style={{ color: '#a855f7', textShadow: '0 0 20px rgba(168,85,247,0.6)' }}
              >
                Starting
              </div>
              <motion.div
                className="mx-auto mt-3 h-0.5 rounded-full bg-gradient-to-r from-transparent via-purple-500 to-transparent"
                animate={{ width: ['40%', '80%', '40%'] }}
                transition={{ duration: 2, repeat: Infinity }}
                style={{ maxWidth: 200 }}
              />
            </motion.div>
          )}

          {running && (
            <motion.div
              key="running"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-center"
            >
              <div className="text-xs uppercase tracking-[0.3em] text-foreground-muted/70 mb-2">
                Current Payout
              </div>
              <motion.div
                className="text-7xl md:text-9xl font-black leading-none"
                style={{
                  color: m > 2 ? '#22d3ee' : '#ffffff',
                  textShadow:
                    m > 2
                      ? '0 0 60px rgba(34,211,238,0.5), 0 0 120px rgba(34,211,238,0.2)'
                      : '0 0 40px rgba(255,255,255,0.2)',
                }}
                animate={{ scale: [1, 1.01, 1] }}
                transition={{ duration: 0.15 }}
                key={Math.floor(m * 10)}
              >
                {m.toFixed(2)}x
              </motion.div>
            </motion.div>
          )}

          {busted && (
            <motion.div
              key="busted"
              initial={{ scale: 2, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="text-center"
            >
              <div className="text-xs uppercase tracking-[0.3em] text-red-400/80 mb-2">
                Busted at
              </div>
              <div
                className="text-7xl md:text-9xl font-black text-red-500 leading-none"
                style={{ textShadow: '0 0 60px rgba(239,68,68,0.6)' }}
              >
                {m.toFixed(2)}x
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/** CSS-only 3D perspective grid receding into the horizon. */
function PerspectiveGrid() {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ perspective: '400px' }}>
      <div
        className="absolute left-[-50%] right-[-50%] bottom-0 h-[70%]"
        style={{
          transform: 'rotateX(60deg)',
          transformOrigin: 'center bottom',
          backgroundImage: `
            linear-gradient(90deg, rgba(100,100,180,0.12) 1px, transparent 1px),
            linear-gradient(0deg, rgba(100,100,180,0.12) 1px, transparent 1px)
          `,
          backgroundSize: '80px 80px',
        }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-[#080818] via-transparent to-transparent" />
      </div>
      <div
        className="absolute left-0 right-0 h-px"
        style={{
          bottom: '30%',
          background: 'linear-gradient(90deg, transparent, rgba(100,100,180,0.35), transparent)',
        }}
      />
    </div>
  );
}

/** SVG crash curve with a rocket at the tip and a neon trail. */
function CrashTrail({ multiplier, busted }: { multiplier: number; busted: boolean }) {
  const points = useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    const steps = 80;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const curM = 1 + (multiplier - 1) * t;
      const x = 5 + t * 85;
      const maxM = Math.max(2, multiplier * 1.2);
      const y = 90 - (Math.log(curM) / Math.log(maxM)) * 75;
      pts.push({ x, y });
    }
    return pts;
  }, [multiplier]);

  const fillD =
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') +
    ` L${points[points.length - 1]?.x ?? 90},95 L5,95 Z`;

  const last = points[points.length - 1];
  const trailColor = busted ? '#ef4444' : '#22d3ee';
  const glowColor = busted ? 'rgba(239,68,68,0.4)' : 'rgba(34,211,238,0.3)';

  return (
    <div className="absolute inset-0 z-[5]">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <defs>
          <linearGradient id="trail-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={trailColor} stopOpacity="0.05" />
            <stop offset="80%" stopColor={trailColor} stopOpacity="0.6" />
            <stop offset="100%" stopColor={trailColor} stopOpacity="1" />
          </linearGradient>
          <linearGradient id="trail-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={trailColor} stopOpacity="0.12" />
            <stop offset="100%" stopColor={trailColor} stopOpacity="0" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d={fillD} fill="url(#trail-fill)" />
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={glowColor}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="url(#trail-grad)"
          strokeWidth="0.8"
          strokeLinecap="round"
          filter="url(#glow)"
        />
      </svg>

      {/* Rocket at the tip of the curve */}
      {last && !busted && (
        <div
          className="absolute z-10 transition-all duration-75"
          style={{ left: `${last.x}%`, top: `${last.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <div
            className="text-2xl md:text-3xl"
            style={{
              filter: 'drop-shadow(0 0 12px rgba(34,211,238,0.8))',
              transform: 'rotate(-30deg)',
            }}
          >
            🚀
          </div>
          <div
            className="absolute -left-4 top-1/2 w-8 h-4 rounded-full blur-sm animate-pulse"
            style={{ background: 'radial-gradient(circle, rgba(34,211,238,0.5), transparent)' }}
          />
        </div>
      )}

      {/* Explosion on bust */}
      {busted && last && (
        <div
          className="absolute z-10"
          style={{ left: `${last.x}%`, top: `${last.y}%`, transform: 'translate(-50%, -50%)' }}
        >
          <motion.div
            initial={{ scale: 0.5, opacity: 1 }}
            animate={{ scale: 4, opacity: 0 }}
            transition={{ duration: 1.2 }}
            className="w-12 h-12 rounded-full"
            style={{
              background: 'radial-gradient(circle, rgba(239,68,68,0.8), rgba(239,68,68,0) 70%)',
            }}
          />
          <div className="absolute inset-0 flex items-center justify-center text-4xl">💥</div>
        </div>
      )}
    </div>
  );
}

/**
 * Right-edge multiplier ruler with horizontal grid lines.
 * The scale auto-ranges based on the current multiplier so the labels
 * always cover the visible range. Matches solpump's right-side ruler.
 */
function MultiplierRuler({
  multiplier,
  phase,
}: {
  multiplier: number;
  phase: 'waiting' | 'running' | 'busted';
}) {
  // Determine the max label to show — always at least 2x, scales up with multiplier
  const maxLabel = phase === 'waiting' ? 7 : Math.max(2, Math.ceil(multiplier * 1.4));
  // Generate tick values from 0 to maxLabel
  const step = maxLabel <= 5 ? 1 : maxLabel <= 15 ? 2 : 5;
  const ticks: number[] = [];
  for (let v = 0; v <= maxLabel; v += step) {
    ticks.push(v);
  }

  return (
    <>
      {/* Horizontal grid lines */}
      <div className="absolute inset-0 z-[1] pointer-events-none">
        {ticks.map((v) => {
          // Map multiplier value to y-position (bottom=0x, top=maxLabel)
          const pct = (v / maxLabel) * 85;
          return (
            <div
              key={v}
              className="absolute left-0 right-12"
              style={{ bottom: `${5 + pct}%` }}
            >
              <div
                className="w-full h-px"
                style={{
                  background:
                    v === 1
                      ? 'rgba(100,100,180,0.2)'
                      : 'rgba(100,100,180,0.07)',
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Right ruler labels */}
      <div className="absolute right-0 top-0 bottom-0 w-12 z-[8] pointer-events-none flex flex-col justify-end pb-[5%]">
        {ticks.map((v) => {
          const pct = (v / maxLabel) * 85;
          const isActive = phase !== 'waiting' && multiplier >= v;
          return (
            <div
              key={v}
              className="absolute right-2 flex items-center gap-1"
              style={{ bottom: `${5 + pct}%`, transform: 'translateY(50%)' }}
            >
              {/* Tick mark */}
              <div
                className="w-2 h-px"
                style={{ background: isActive ? 'rgba(34,211,238,0.5)' : 'rgba(100,100,180,0.3)' }}
              />
              <span
                className="text-[9px] font-mono tabular-nums"
                style={{
                  color: isActive
                    ? 'rgba(34,211,238,0.8)'
                    : 'rgba(150,150,200,0.35)',
                }}
              >
                {v.toFixed(1)}x
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
