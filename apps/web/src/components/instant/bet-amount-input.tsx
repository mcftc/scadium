'use client';

import { cn } from '@/lib/cn';

const PRESETS = ['0.1', '0.5', '1', '5'];
const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Shared bet-amount control for the instant games — mirrors the crash bet panel
 * (½ / ×2 / MAX inside the input + preset row). Value is the SOL string; the
 * parent converts to lamports for the API. MAX/×2 clamp to the game's MAX bet.
 */
export function BetAmountInput({
  sol,
  setSol,
  minLamports,
  maxLamports,
  disabled,
}: {
  sol: string;
  setSol: (v: string) => void;
  minLamports: number;
  maxLamports: number;
  disabled?: boolean;
}) {
  const minSol = minLamports / LAMPORTS_PER_SOL;
  const maxSol = maxLamports / LAMPORTS_PER_SOL;
  // Clamp into [min, max]; a non-finite/empty input falls back to the game min
  // rather than emitting 'NaN' into the field.
  const clamp = (n: number) =>
    Number.isFinite(n) ? Math.min(maxSol, Math.max(minSol, n)) : minSol;

  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
        Bet amount (SOL)
      </div>
      <div className="relative">
        <input
          type="number"
          step="0.001"
          min={minSol}
          value={sol}
          onChange={(e) => setSol(e.target.value)}
          disabled={disabled}
          className="w-full rounded-xl border border-border bg-surface-elevated pl-4 pr-28 h-11 text-sm font-mono focus:outline-none focus:border-primary-400 disabled:opacity-50"
        />
        <div className="absolute right-1 top-1 bottom-1 flex gap-0.5">
          <button
            type="button"
            onClick={() => setSol(String(clamp(Number(sol) / 2)))}
            disabled={disabled}
            className="px-2 rounded-lg bg-surface text-[10px] font-bold text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
          >
            ½
          </button>
          <button
            type="button"
            onClick={() => setSol(String(clamp(Number(sol) * 2)))}
            disabled={disabled}
            className="px-2 rounded-lg bg-surface text-[10px] font-bold text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
          >
            ×2
          </button>
          <button
            type="button"
            onClick={() => setSol(String(clamp(maxSol)))}
            disabled={disabled}
            className="px-2 rounded-lg bg-surface text-[10px] font-bold text-foreground-muted hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
          >
            MAX
          </button>
        </div>
      </div>
      <div className="mt-2 flex gap-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setSol(p)}
            disabled={disabled}
            className={cn(
              'flex-1 py-1.5 text-xs font-semibold rounded-lg border transition-colors disabled:opacity-50',
              sol === p
                ? 'border-primary-400/50 bg-primary-400/10 text-primary-400'
                : 'border-border text-foreground-muted hover:border-primary-400/30',
            )}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Is the SOL string a real, positive bet that meets the game minimum? Empty,
 * zero, negative, and non-numeric inputs are all invalid (callers disable submit
 * so a cleared field can't silently place the minimum bet).
 */
export function isValidBetSol(sol: string, minLamports: number): boolean {
  const lamports = parseSolToLamports(sol);
  return lamports !== null && lamports > 0n && lamports >= BigInt(minLamports);
}

/** SOL string → lamports string, clamped to the game's MIN/MAX. */
export function solToLamportsClamped(
  sol: string,
  minLamports: number,
  maxLamports: number,
): string {
  const raw = parseSolToLamports(sol);
  // Empty/zero/negative/NaN are not valid bets — fall back to the min so the API
  // still receives a well-formed value, but submit is gated by `isValidBetSol`.
  if (raw === null || raw <= 0n) return String(minLamports);
  const clamped =
    raw < BigInt(minLamports)
      ? BigInt(minLamports)
      : raw > BigInt(maxLamports)
        ? BigInt(maxLamports)
        : raw;
  return clamped.toString();
}

/**
 * Exact decimal SOL → lamports. `Math.floor(Number(sol) * 1e9)` is off by one
 * lamport for ordinary amounts ('0.3' × 1e9 = 299999999.99999997), so every bet
 * of such an amount was placed a lamport short. Returns null for anything that
 * is not a plain non-negative decimal; digits past the 9th are truncated.
 */
export function parseSolToLamports(sol: string): bigint | null {
  const m = /^\s*(\d*)(?:\.(\d*))?\s*$/.exec(sol);
  if (!m || (!m[1] && !m[2])) return null;
  const whole = BigInt(m[1] || '0');
  const frac = (m[2] ?? '').slice(0, 9).padEnd(9, '0');
  return whole * BigInt(LAMPORTS_PER_SOL) + BigInt(frac);
}
