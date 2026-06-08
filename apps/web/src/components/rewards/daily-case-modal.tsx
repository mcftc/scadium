'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, Sparkles } from 'lucide-react';
import { SCAD } from '@scadium/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { cn } from '@/lib/cn';

type TierName = 'legendary' | 'epic' | 'rare' | 'common';

interface CaseOpenResult {
  tier: TierName;
  rewardScad: string;
  nextAvailableAt: string;
}

const RARITY: Record<TierName, { label: string; color: string; ring: string }> = {
  legendary: { label: 'Legendary', color: '#f59e0b', ring: 'shadow-[0_0_28px_rgba(245,158,11,0.65)]' },
  epic: { label: 'Epic', color: '#a855f7', ring: 'shadow-[0_0_26px_rgba(168,85,247,0.55)]' },
  rare: { label: 'Rare', color: '#60a5fa', ring: 'shadow-[0_0_22px_rgba(96,165,250,0.5)]' },
  common: { label: 'Common', color: '#64748b', ring: '' },
};

const TIERS = SCAD.CASE_TIERS as readonly { tier: TierName; chance: number; scadBase: number }[];
const SCAD_BY_TIER = Object.fromEntries(TIERS.map((t) => [t.tier, t.scadBase])) as Record<
  TierName,
  number
>;
// Display probability of each tier from its cumulative threshold.
const PROB: Record<TierName, number> = (() => {
  const asc = [...TIERS].sort((a, b) => a.chance - b.chance);
  const out = {} as Record<TierName, number>;
  let prev = 0;
  for (const t of asc) {
    out[t.tier] = t.chance - prev;
    prev = t.chance;
  }
  return out;
})();

const fmtScad = (base: number | bigint | string) =>
  (Number(base) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 0 });

const TILE_W = 112;
const STRIP_LEN = 44;
const LAND_IDX = STRIP_LEN - 6; // a few tiles trail past the pointer
const SPIN_MS = 5200;
// How often each rarity shows on the reel (cosmetic — the landing tile is fixed).
const REEL_WEIGHT: Record<TierName, number> = { common: 60, rare: 25, epic: 10, legendary: 5 };

/** Shared Daily Case opener: potential drops → spin reel → SCAD win banner. */
export function DailyCaseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const [phase, setPhase] = useState<'ready' | 'spin' | 'won'>('ready');
  const [strip, setStrip] = useState<TierName[]>([]);
  const [result, setResult] = useState<CaseOpenResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openMut = useMutation({
    mutationFn: () => api<CaseOpenResult>('/airdrop/case/open', { method: 'POST', token }),
    onSuccess: (res) => {
      setResult(res);
      setStrip(buildStrip(res.tier));
      setPhase('spin');
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Could not open the case'),
  });

  // Reset to a fresh state whenever the modal is (re)opened.
  useEffect(() => {
    if (open) {
      setPhase('ready');
      setResult(null);
      setError(null);
      setStrip([]);
    }
  }, [open]);

  function handleClose() {
    // Refresh case availability + balances after a reveal.
    if (phase === 'won') {
      void qc.invalidateQueries({ queryKey: ['rewards'] });
      void qc.invalidateQueries({ queryKey: ['airdrop', 'case'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    }
    onClose();
  }

  return (
    <Dialog open={open} onClose={handleClose} title="Daily Case" className="max-w-lg">
      {phase === 'ready' && (
        <div className="space-y-5">
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-primary shadow-glow">
              <Gift className="h-12 w-12 text-white" />
            </div>
            <div className="text-xs text-foreground-muted">One free case every 24 hours.</div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-foreground-muted mb-2 font-semibold">
              Potential drops
            </div>
            <div className="grid grid-cols-4 gap-2">
              {TIERS.map((t) => {
                const r = RARITY[t.tier];
                return (
                  <div
                    key={t.tier}
                    className="rounded-xl border bg-surface-elevated/60 p-2 text-center"
                    style={{ borderColor: `${r.color}55` }}
                  >
                    <div
                      className="mx-auto mb-1 flex h-7 w-7 items-center justify-center rounded-lg"
                      style={{ background: `${r.color}22`, color: r.color }}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                    </div>
                    <div className="font-mono text-xs font-bold">{fmtScad(t.scadBase)}</div>
                    <div className="text-[9px] uppercase tracking-wide" style={{ color: r.color }}>
                      {r.label}
                    </div>
                    <div className="text-[9px] text-foreground-muted">
                      {(PROB[t.tier] * 100).toFixed(PROB[t.tier] < 0.01 ? 1 : 0)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}

          <Button
            size="lg"
            className="w-full"
            disabled={openMut.isPending}
            onClick={() => {
              setError(null);
              openMut.mutate();
            }}
          >
            <Gift className="h-5 w-5" />
            {openMut.isPending ? 'Opening…' : 'Open Free Case'}
          </Button>
        </div>
      )}

      {(phase === 'spin' || phase === 'won') && result && (
        <div className="space-y-4">
          <CaseReel strip={strip} onSettled={() => setPhase('won')} />
          {phase === 'won' && (
            <div className="flex flex-col items-center gap-1 animate-in fade-in">
              <div className="text-[10px] uppercase tracking-[0.3em] text-foreground-muted">
                You won
              </div>
              <div
                className="text-3xl font-black"
                style={{ color: RARITY[result.tier].color }}
              >
                {fmtScad(result.rewardScad)} <span className="text-lg">SCAD</span>
              </div>
              <div
                className="text-xs font-bold uppercase tracking-wider"
                style={{ color: RARITY[result.tier].color }}
              >
                {RARITY[result.tier].label}
              </div>
              <Button variant="secondary" className="mt-3 w-full" onClick={handleClose}>
                Collect
              </Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

function buildStrip(wonTier: TierName): TierName[] {
  const pool: TierName[] = [];
  for (const t of TIERS) for (let i = 0; i < REEL_WEIGHT[t.tier]; i++) pool.push(t.tier);
  const strip = Array.from(
    { length: STRIP_LEN },
    () => pool[Math.floor(Math.random() * pool.length)]!,
  );
  strip[LAND_IDX] = wonTier;
  return strip;
}

/** Horizontal prize reel that decelerates so LAND_IDX rests under the pointer. */
function CaseReel({ strip, onSettled }: { strip: TierName[]; onSettled: () => void }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  const [tx, setTx] = useState(0);
  const [settled, setSettled] = useState(false);

  useLayoutEffect(() => {
    if (wrapRef.current) setCw(wrapRef.current.offsetWidth);
  }, []);

  useEffect(() => {
    if (cw === 0) return;
    const finalTx = cw / 2 - (LAND_IDX * TILE_W + TILE_W / 2);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setTx(finalTx)));
    const fb = setTimeout(() => setSettled(true), SPIN_MS + 300);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fb);
    };
  }, [cw]);

  useEffect(() => {
    if (settled) onSettled();
  }, [settled, onSettled]);

  return (
    <div
      ref={wrapRef}
      className="relative h-28 overflow-hidden rounded-xl border border-border bg-background"
    >
      <div className="absolute left-1/2 top-0 bottom-0 z-20 -translate-x-1/2 w-0.5 bg-amber-400 shadow-[0_0_14px_rgba(245,158,11,0.9)]" />
      <div className="absolute left-1/2 top-0 z-20 -translate-x-1/2 text-amber-400 text-xs leading-none pt-0.5">
        ▼
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-20 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-20 bg-gradient-to-l from-background to-transparent" />
      <div
        className="absolute top-0 bottom-0 flex will-change-transform"
        style={{
          transform: `translateX(${tx}px)`,
          transition: `transform ${SPIN_MS}ms cubic-bezier(0.12,0.7,0.16,1)`,
        }}
        onTransitionEnd={(e) => {
          if (e.propertyName === 'transform') setSettled(true);
        }}
      >
        {strip.map((tier, i) => {
          const r = RARITY[tier];
          const isLanded = settled && i === LAND_IDX;
          return (
            <div
              key={i}
              className={cn(
                'flex h-full shrink-0 flex-col items-center justify-center gap-1.5 border-r border-border/40 transition-opacity',
                settled && !isLanded && 'opacity-25',
              )}
              style={{ width: TILE_W, background: `${r.color}14` }}
            >
              <div
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-xl',
                  isLanded && r.ring,
                )}
                style={{ background: `${r.color}26`, color: r.color }}
              >
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="font-mono text-xs font-bold">{fmtScad(SCAD_BY_TIER[tier])}</div>
              <div className="text-[9px] uppercase tracking-wide" style={{ color: r.color }}>
                {r.label}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
