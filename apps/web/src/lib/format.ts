/**
 * Display helpers shared across profile, bet history, and game screens.
 * All lamport values arrive as strings from the API (BigInt-safe JSON) —
 * these helpers convert to SOL for display.
 */

const LAMPORTS_PER_SOL = 1_000_000_000;

export function lamportsToSol(lamportsStr: string | number | bigint): number {
  const big = typeof lamportsStr === 'bigint' ? lamportsStr : BigInt(lamportsStr);
  // Divide via Number for display-only precision; use BigInt math everywhere else
  return Number(big) / LAMPORTS_PER_SOL;
}

export function formatSol(lamportsStr: string | number | bigint, decimals = 4): string {
  const sol = lamportsToSol(lamportsStr);
  return `${sol.toFixed(decimals)} SOL`;
}

/** Format a USDT amount with a leading $ and thousands separators. */
export function formatUsd(amount: number, decimals = 2): string {
  return `$${amount.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function shortAddress(address: string, leading = 4, trailing = 4): string {
  if (address.length <= leading + trailing + 1) return address;
  return `${address.slice(0, leading)}…${address.slice(-trailing)}`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatMultiplier(m: number | null): string {
  if (m == null) return '—';
  return `${m.toFixed(2)}×`;
}
