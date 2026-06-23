'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { VAULT, boostedAprBps, nextScadBoostTier, scadBoostTier } from '@scadium/shared';
import type { ScadBoostTier } from '@scadium/shared';
import { Droplets, Info, Lock, Sparkles, TrendingUp, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import { useMe } from '@/hooks/use-me';

const SCAD_DECIMALS = 9;
const SCAD_UNIT = 10 ** SCAD_DECIMALS;
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const PENALTY_PCT = VAULT.EARLY_EXIT_PENALTY_BPS / 100;
const YIELD_PCT = VAULT.YIELD_NGR_BPS / 100;
const MIN_DEPOSIT_SCAD = VAULT.MIN_DEPOSIT_SCAD_BASE / SCAD_UNIT;

/** base-unit string → whole-SCAD number (display precision only). */
const toScad = (base: string) => Number(BigInt(base)) / SCAD_UNIT;
/** base-unit bigint → whole-SCAD number (display precision only). */
const toScadN = (base: bigint) => Number(base) / SCAD_UNIT;
const fmtScad = (n: number, dp = 2) =>
  n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
/** Compact whole-SCAD display: 10000 → "10k", 1000000 → "1M". */
const fmtScadCompact = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`
    : n >= 1_000
      ? `${(n / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`
      : n.toLocaleString();
const fmtMult = (multiplierBps: number) =>
  `${(multiplierBps / 10_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}×`;
const fmtApr = (aprBps: number) => `${(aprBps / 100).toFixed(2)}%`;

interface Pool {
  id: string;
  asset: string;
  termDays: number;
  weightBps: number;
  aprBps: number;
  indexRay: string;
  totalAssets: string;
  totalShares: string;
}

interface Position {
  id: string;
  poolId: string;
  termDays: number;
  asset: string;
  shares: string;
  principal: string;
  value: string;
  earned: string;
  maturesAt: string;
  matured: boolean;
  indexRay: string;
  aprBps: number;
}

/**
 * Live value of a position, interpolated from its last server `value` using the
 * pool APR — so the counter ticks between the 30s polls and snaps to the real
 * value on every refetch (the same approach the engine dashboard uses; vault
 * accrual runs in the worker, so there is no server push).
 */
function liveValue(pos: Position, elapsedSec: number): number {
  const base = toScad(pos.value);
  const perSec = pos.aprBps / 10_000 / SECONDS_PER_YEAR;
  return base * (1 + perSec * Math.max(0, elapsedSec));
}

export function VaultDashboard() {
  const token = useAuthStore((s) => s.accessToken);
  const qc = useQueryClient();
  const me = useMe();

  // $SCAD wallet holdings drive the loyalty boost tier (base units, 9 dp).
  const holdingsBase = me.data ? BigInt(me.data.scadiumBalance) : 0n;
  const tier = scadBoostTier(holdingsBase);

  const pools = useQuery({
    queryKey: ['vault', 'pools'],
    queryFn: () => api<Pool[]>('/vault/pools'),
    refetchInterval: 30_000,
  });
  const positions = useQuery({
    queryKey: ['vault', 'positions'],
    queryFn: () => api<Position[]>('/vault/positions', { token }),
    enabled: !!token,
    refetchInterval: 30_000,
  });

  // Timestamp of the last positions refetch — interpolation baseline.
  const fetchedAt = useRef(Date.now());
  useEffect(() => {
    if (positions.dataUpdatedAt) fetchedAt.current = positions.dataUpdatedAt;
  }, [positions.dataUpdatedAt]);

  // ~5fps clock drives the live counter without thrashing React.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 200);
    return () => clearInterval(t);
  }, []);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['vault'] });

  const elapsedSec = (Date.now() - fetchedAt.current) / 1000;
  const liveTotal = (positions.data ?? []).reduce((sum, p) => sum + liveValue(p, elapsedSec), 0);
  const principalTotal = (positions.data ?? []).reduce((sum, p) => sum + toScad(p.principal), 0);
  const liveEarned = Math.max(0, liveTotal - principalTotal);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card>
        <CardContent className="py-8 text-center">
          <div className="flex items-center justify-center gap-2 text-foreground-muted text-xs uppercase tracking-wider">
            <TrendingUp className="h-3.5 w-3.5" /> Total earning, live
          </div>
          <div className="mt-2 text-4xl md:text-5xl font-bold font-mono text-gradient">
            +{fmtScad(liveEarned, 6)} <span className="text-2xl">SCAD</span>
          </div>
          <div className="mt-1 text-sm text-foreground-muted">
            {fmtScad(liveTotal)} SCAD across {(positions.data ?? []).length} position(s)
          </div>
        </CardContent>
      </Card>

      <BoostPanel tier={tier} holdingsBase={holdingsBase} hasToken={!!token} />

      <PoolsPanel
        pools={pools.data}
        hasToken={!!token}
        tier={tier}
        onDeposited={invalidate}
      />

      <RiskPanel pools={pools.data} />

      {token ? (
        <PositionsPanel
          positions={positions.data}
          loading={positions.isLoading}
          elapsedSec={elapsedSec}
          onChange={invalidate}
        />
      ) : (
        <Card>
          <CardContent className="py-12 text-center text-foreground-muted text-sm">
            Connect your wallet to lock $SCAD and earn yield.
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Loyalty boost ladder: the more $SCAD a user holds, the higher their effective
 * APR (a SCAD-denominated multiplier on each pool's base rate). Always renders
 * the full schedule (transparent to logged-out visitors); when authed it
 * highlights the active tier and shows progress to the next one.
 */
function BoostPanel({
  tier,
  holdingsBase,
  hasToken,
}: {
  tier: ScadBoostTier;
  holdingsBase: bigint;
  hasToken: boolean;
}) {
  const next = nextScadBoostTier(holdingsBase);
  const holdings = toScadN(holdingsBase);

  // Progress within the current band: from this tier's floor to the next floor.
  const floor = toScadN(tier.minScadBase);
  const ceil = next ? toScadN(next.minScadBase) : floor;
  const progress = next && ceil > floor ? Math.min(1, (holdings - floor) / (ceil - floor)) : 1;
  const toNext = next ? Math.max(0, toScadN(next.minScadBase) - holdings) : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Sparkles className="h-4 w-4 text-primary-400" />
        <CardTitle>Loyalty APR boost</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasToken ? (
          <div className="rounded-xl border border-primary-400/40 bg-surface-elevated px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-foreground-muted">
                  Your tier
                </div>
                <div className="text-lg font-bold">
                  {tier.label} · <span className="text-primary-400">{fmtMult(tier.multiplierBps)}</span>{' '}
                  APR
                </div>
              </div>
              <div className="text-right text-xs text-foreground-muted">
                holding
                <div className="font-mono text-sm text-foreground">{fmtScad(holdings, 0)} SCAD</div>
              </div>
            </div>
            {next ? (
              <div className="mt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                  <div
                    className="h-full rounded-full bg-primary-400 transition-all"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <div className="mt-1.5 text-xs text-foreground-muted">
                  Hold {fmtScadCompact(toNext)} more $SCAD to reach{' '}
                  <span className="text-foreground">{next.label}</span> (
                  {fmtMult(next.multiplierBps)})
                </div>
              </div>
            ) : (
              <div className="mt-2 text-xs text-success">Top tier reached — max boost active.</div>
            )}
          </div>
        ) : (
          <p className="text-sm text-foreground-muted">
            Connect your wallet to see your tier. The more $SCAD you hold, the higher your APR.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {VAULT.BOOST_TIERS.map((t) => {
            const active = hasToken && t.label === tier.label;
            return (
              <div
                key={t.label}
                className={`rounded-lg border px-3 py-2 text-center ${
                  active ? 'border-primary-400 bg-surface-elevated' : 'border-border bg-surface'
                }`}
              >
                <div className="text-sm font-semibold">{fmtMult(t.multiplierBps)}</div>
                <div className="text-[10px] text-foreground-muted">{t.label}</div>
                <div className="mt-0.5 text-[10px] text-foreground-muted">
                  {t.minScadBase === 0n ? '0+' : `${fmtScadCompact(toScadN(t.minScadBase))}+`}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Risk & liquidity transparency: where the yield comes from, how much is locked,
 * the variable-APR caveat, and the early-exit penalty — so a depositor can judge
 * the trade-off before locking (V13 acceptance: "risk/likidite şeffaf").
 */
function RiskPanel({ pools }: { pools: Pool[] | undefined }) {
  const tvl = (pools ?? []).reduce((sum, p) => sum + toScad(p.totalAssets), 0);
  const rows: { label: string; value: string; hint: string }[] = [
    {
      label: 'Yield source',
      value: `${YIELD_PCT.toFixed(0)}% of house profit`,
      hint: 'Funded by net gaming revenue (NGR), not new emissions — APR is variable and tracks house performance.',
    },
    {
      label: 'Total value locked',
      value: `${fmtScad(tvl, 0)} SCAD`,
      hint: 'Across all term pools. Yield is split by term weight, so longer locks earn a larger share.',
    },
    {
      label: 'Early-exit penalty',
      value: `${PENALTY_PCT}%`,
      hint: 'Withdrawing before maturity keeps this share in the pool, lifting the index for stakers who hold.',
    },
    {
      label: 'Loyalty boost',
      value: 'up to 2.00×',
      hint: 'A SCAD-holdings multiplier on the base pool APR. Base rates are paid today; the on-chain boost lands with liquid staking (V11).',
    },
  ];
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Droplets className="h-4 w-4 text-primary-400" />
        <CardTitle>Risk &amp; liquidity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{r.label}</div>
              <div className="mt-0.5 text-xs text-foreground-muted">{r.hint}</div>
            </div>
            <div className="shrink-0 font-mono text-sm font-semibold text-foreground">
              {r.value}
            </div>
          </div>
        ))}
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs text-foreground-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Play-money demo. APR figures are estimates, not guarantees — yield depends on house
            revenue and can fall to zero. Not financial advice.
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function PoolsPanel({
  pools,
  hasToken,
  tier,
  onDeposited,
}: {
  pools: Pool[] | undefined;
  hasToken: boolean;
  tier: ScadBoostTier;
  onDeposited: () => void;
}) {
  const token = useAuthStore((s) => s.accessToken);
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const deposit = useMutation({
    mutationFn: (poolId: string) => {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) throw new Error('Enter a valid amount');
      const base = BigInt(Math.round(n * SCAD_UNIT)).toString();
      return api('/vault/deposit', { method: 'POST', token, body: { poolId, amount: base } });
    },
    onSuccess: () => {
      setAmount('');
      setSelected(null);
      setErr(null);
      onDeposited();
    },
    onError: (e: Error) => setErr(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Term pools</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(pools ?? []).map((p) => {
            const active = selected === p.id;
            const boosted = boostedAprBps(p.aprBps, tier.multiplierBps);
            const hasBoost = boosted > p.aprBps;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(active ? null : p.id)}
                className={`rounded-xl border px-4 py-4 text-left transition-colors ${
                  active ? 'border-primary-400 bg-surface-elevated' : 'border-border bg-surface'
                }`}
              >
                <div className="text-2xl font-bold">{p.termDays}d</div>
                {hasBoost ? (
                  <>
                    <div className="mt-1 text-xs font-semibold text-primary-400">
                      ~{fmtApr(boosted)} APR
                    </div>
                    <div className="text-[10px] text-foreground-muted line-through">
                      {fmtApr(p.aprBps)} base
                    </div>
                  </>
                ) : (
                  <div className="mt-1 text-xs text-foreground-muted">~{fmtApr(p.aprBps)} APR</div>
                )}
              </button>
            );
          })}
          {!pools && (
            <div className="col-span-full py-6 text-center text-sm text-foreground-muted">
              Loading pools…
            </div>
          )}
        </div>

        {hasToken ? (
          <>
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Amount in SCAD"
                className="flex-1 rounded-xl border border-border bg-surface-elevated px-4 py-3 font-mono text-sm focus:border-primary-400 outline-none"
              />
              <Button
                variant="primary"
                disabled={!selected || !amount || deposit.isPending}
                onClick={() => selected && deposit.mutate(selected)}
              >
                {selected ? 'Lock $SCAD' : 'Pick a term'}
              </Button>
            </div>
            {!!amount && Number(amount) > 0 && Number(amount) < MIN_DEPOSIT_SCAD && (
              <p className="text-xs text-warning">
                Minimum deposit is {MIN_DEPOSIT_SCAD.toLocaleString()} $SCAD.
              </p>
            )}
            {err && <p className="text-xs text-danger">{err}</p>}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PositionsPanel({
  positions,
  loading,
  elapsedSec,
  onChange,
}: {
  positions: Position[] | undefined;
  loading: boolean;
  elapsedSec: number;
  onChange: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <Wallet className="h-4 w-4 text-primary-400" />
        <CardTitle>Your positions</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? (
          <div className="py-12 text-center text-foreground-muted text-sm">Loading…</div>
        ) : !positions || positions.length === 0 ? (
          <div className="py-12 text-center text-foreground-muted text-sm">
            No positions yet — lock some $SCAD above.
          </div>
        ) : (
          <div>
            {positions.map((pos) => (
              <PositionRow key={pos.id} pos={pos} elapsedSec={elapsedSec} onChange={onChange} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PositionRow({
  pos,
  elapsedSec,
  onChange,
}: {
  pos: Position;
  elapsedSec: number;
  onChange: () => void;
}) {
  const token = useAuthStore((s) => s.accessToken);
  const [err, setErr] = useState<string | null>(null);
  const value = liveValue(pos, elapsedSec);
  const principal = toScad(pos.principal);
  const earned = Math.max(0, value - principal);

  const withdraw = useMutation({
    mutationFn: () =>
      api('/vault/withdraw', { method: 'POST', token, body: { positionId: pos.id } }),
    onSuccess: () => {
      setErr(null);
      onChange();
    },
    onError: (e: Error) => setErr(e.message),
  });

  const onWithdraw = () => {
    if (!pos.matured) {
      const ok = window.confirm(
        `This position is not yet mature. Withdrawing now keeps a ${PENALTY_PCT}% early-exit penalty in the pool. Continue?`,
      );
      if (!ok) return;
    }
    withdraw.mutate();
  };

  return (
    <div className="px-6 py-4 border-b border-border/30 last:border-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            {pos.termDays}d term
            {pos.matured ? (
              <span className="text-[10px] uppercase tracking-wider text-success">matured</span>
            ) : (
              <Maturity at={pos.maturesAt} />
            )}
          </div>
          <div className="mt-1 text-xs text-foreground-muted">
            Principal {fmtScad(principal)} SCAD · ~{(pos.aprBps / 100).toFixed(2)}% APR
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono font-bold">{fmtScad(value, 4)} SCAD</div>
          <div className="text-xs text-success font-mono">+{fmtScad(earned, 6)}</div>
        </div>
        <Button variant="secondary" disabled={withdraw.isPending} onClick={onWithdraw}>
          {pos.matured ? 'Withdraw' : 'Exit early'}
        </Button>
      </div>
      {err && <p className="mt-2 text-xs text-danger">{err}</p>}
    </div>
  );
}

/** Live maturity countdown with a lock icon. */
function Maturity({ at }: { at: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  const remaining = new Date(at).getTime() - now;
  if (remaining <= 0) return null;
  const s = Math.floor(remaining / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
  return (
    <span className="flex items-center gap-1 text-[10px] text-warning">
      <Lock className="h-3 w-3" /> {parts}
    </span>
  );
}
