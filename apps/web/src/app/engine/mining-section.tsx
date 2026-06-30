'use client';

import { useEffect, useState } from 'react';
import { Pickaxe, Trophy, Timer, Gauge, Layers, Coins } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  useEngineState,
  useMinerState,
  useEngineBlocks,
  useMiningLeaderboard,
  useLiveEmittedScad,
} from '@/hooks/use-engine-mining';
import { useAuthStore } from '@/store/auth-store';

const WHOLE = 1_000_000_000n; // $SCAD base units per whole token
const whole = (base: string) => Number(BigInt(base) / WHOLE);
const fmtScad = (base: string, dp = 0) =>
  whole(base).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fmtNum = (n: number, dp = 0) =>
  n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** Live mm:ss countdown to the next hourly block. */
function useCountdown(msInitial: number | undefined): string {
  const [ms, setMs] = useState(msInitial ?? 0);
  useEffect(() => {
    if (msInitial == null) return;
    setMs(msInitial);
    const id = setInterval(() => setMs((m) => Math.max(0, m - 1000)), 1000);
    return () => clearInterval(id);
  }, [msInitial]);
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function MiningSection() {
  const token = useAuthStore((s) => s.accessToken);
  const { data: state } = useEngineState();
  const { data: me } = useMinerState();
  const { data: blocks } = useEngineBlocks(8);
  const { data: lb } = useMiningLeaderboard(10);
  const liveEmitted = useLiveEmittedScad(state);
  const countdown = useCountdown(state?.msToNextDistribution);

  const minedPct = state ? (whole(state.totalEmittedScad) / whole(state.p2ePoolScad)) * 100 : 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Pickaxe className="h-5 w-5 text-primary-400" />
          Proof-of-Play Mining
          {state && (
            <span className="ml-auto text-xs font-medium rounded-full bg-surface-elevated px-3 py-1 text-primary-400 ring-1 ring-primary-400/30">
              Phase {state.phase} · halving
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Live $SCAD ticker */}
        <div className="text-center py-4">
          <div className="text-xs uppercase tracking-wider text-foreground-muted mb-1">
            $SCAD mined
          </div>
          <div className="text-4xl md:text-5xl font-bold text-gradient tabular-nums">
            {fmtNum(liveEmitted)}
          </div>
          <div className="mt-3 mx-auto max-w-md">
            <div className="h-2 rounded-full bg-surface-elevated overflow-hidden">
              <div
                className="h-full bg-gradient-primary transition-all duration-500"
                style={{ width: `${Math.min(100, minedPct).toFixed(2)}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[11px] text-foreground-muted">
              <span>{minedPct.toFixed(2)}% of 500M pool</span>
              <span>{state ? `${fmtScad(state.remainingPoolScad)} left` : '…'}</span>
            </div>
          </div>
        </div>

        {/* Block stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MiniStat
            icon={Coins}
            label="Block reward"
            value={state ? `${fmtScad(state.currentBlockRewardScad)} SCAD` : '…'}
          />
          <MiniStat
            icon={Trophy}
            label="Big reward"
            value={state ? `${fmtScad(state.bigRewardScad)} SCAD` : '…'}
          />
          <MiniStat icon={Timer} label="Next block" value={countdown} />
          <MiniStat
            icon={Layers}
            label="To next halving"
            value={state ? `${fmtScad(state.toNextHalvingScad)} SCAD` : '…'}
          />
        </div>

        {/* Your mining */}
        {token && me && (
          <div className="rounded-xl border border-border/60 bg-surface/40 p-4">
            <div className="flex items-center gap-2 mb-3 text-sm font-semibold">
              <Gauge className="h-4 w-4 text-primary-400" /> Your mining
              {me.miningPassively && (
                <span className="ml-auto text-[11px] rounded-full bg-primary-400/10 px-2 py-0.5 text-primary-300">
                  mining passively from stake
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <KV label="Play-rate share" value={`${(me.shareBps / 100).toFixed(2)}%`} />
              <KV label="Projected block" value={`${fmtScad(me.projectedShareScad, 2)} SCAD`} />
              <KV label="From wager" value={fmtScad(me.activePlayRate)} />
              <KV label="From stake" value={fmtScad(me.stakePlayRate)} />
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          {/* Recent blocks */}
          <div>
            <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
              Recent blocks
            </div>
            <div className="space-y-1">
              {(blocks ?? []).slice(0, 6).map((b) => (
                <div
                  key={b.period}
                  className="flex items-center justify-between text-xs rounded-lg bg-surface/40 px-3 py-2"
                >
                  <span className="text-foreground-muted">#{b.period}</span>
                  <span className="font-medium">{fmtScad(b.rewardScad)} SCAD</span>
                  <span className="text-primary-300">
                    {Number(b.bigRewardScad) > 0 ? `🏆 ${fmtScad(b.bigRewardScad)}` : '—'}
                  </span>
                  <span className="text-foreground-muted">{b.participantCount} miners</span>
                </div>
              ))}
              {!blocks?.length && (
                <div className="text-xs text-foreground-muted py-4 text-center">
                  No blocks mined yet.
                </div>
              )}
            </div>
          </div>

          {/* Leaderboard */}
          <div>
            <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
              This hour&apos;s top miners
            </div>
            <div className="space-y-1">
              {(lb?.miners ?? []).slice(0, 6).map((m) => (
                <div
                  key={m.userId}
                  className="flex items-center justify-between text-xs rounded-lg bg-surface/40 px-3 py-2"
                >
                  <span className="text-foreground-muted w-6">#{m.rank}</span>
                  <span className="flex-1 truncate font-medium">
                    {m.username ?? `${m.walletAddress?.slice(0, 4)}…${m.walletAddress?.slice(-4)}`}
                  </span>
                  <span className="text-primary-300">{(m.shareBps / 100).toFixed(1)}%</span>
                </div>
              ))}
              {!lb?.miners?.length && (
                <div className="text-xs text-foreground-muted py-4 text-center">
                  No miners this hour yet.
                </div>
              )}
            </div>
          </div>
        </div>

        <p className="text-center text-[11px] text-foreground-muted">
          Like a miner contributing hashrate, your play earns $SCAD — no hashrate, just playrate.
          Each hour&apos;s block is split by play-rate and halves by phase.
        </p>
      </CardContent>
    </Card>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-surface/40 p-3 text-center">
      <Icon className="h-4 w-4 text-primary-400 mx-auto mb-1" />
      <div className="text-sm font-bold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-foreground-muted mt-0.5">
        {label}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-bold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-foreground-muted">{label}</div>
    </div>
  );
}
