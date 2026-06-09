'use client';

import { ExternalLink, ShieldCheck } from 'lucide-react';
import type { Card } from '@scadium/shared';
import type { BetRow } from '@/hooks/use-me';
import { env } from '@/config/env';
import { formatSol } from '@/lib/format';

const SUIT: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
const fmtCards = (cards: Card[] = []) =>
  cards.map((c) => `${c.rank}${SUIT[c.suit] ?? c.suit}`).join('  ');

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-xs text-foreground-muted">{k}</span>
      <span className="font-mono text-xs text-right text-foreground">{v}</span>
    </div>
  );
}

/** Game-specific render of Bet.resultJson; falls back gracefully if absent. */
function ResultDetail({ bet }: { bet: BetRow }) {
  const r = (bet.resultJson ?? {}) as Record<string, unknown>;
  switch (bet.gameType) {
    case 'crash':
      return (
        <>
          <Row k="Bust point" v={`${Number(r.bustPoint).toFixed(2)}×`} />
          <Row
            k="Cashed out"
            v={r.cashedOutAt != null ? `${Number(r.cashedOutAt).toFixed(2)}×` : '—'}
          />
        </>
      );
    case 'coinflip':
      return (
        <>
          <Row k="Your side" v={String(r.side ?? '—')} />
          <Row k="Result" v={String(r.result ?? '—')} />
        </>
      );
    case 'blackjack':
      return (
        <>
          <Row k="Your hand" v={fmtCards(r.playerCards as Card[])} />
          <Row k="Dealer" v={fmtCards(r.dealerCards as Card[])} />
          <Row k="Outcome" v={String(r.result ?? '—')} />
          {r.doubled ? <Row k="Doubled" v="Yes" /> : null}
          {r.side21p3 && r.side21p3 !== 'none' ? (
            <Row k="21+3" v={String(r.side21p3)} />
          ) : null}
          {r.sidePerfectPairs && r.sidePerfectPairs !== 'none' ? (
            <Row k="Perfect pairs" v={String(r.sidePerfectPairs)} />
          ) : null}
        </>
      );
    case 'jackpot':
      return (
        <>
          <Row k="Pot" v={`${formatSol(String(r.totalLamports ?? '0'), 3)}`} />
          <Row k="Winning ticket" v={String(r.winningTicket ?? '—')} />
          <Row k="Won" v={r.won ? 'Yes' : 'No'} />
        </>
      );
    case 'lottery':
      return (
        <>
          <Row
            k="Draw"
            v={`${(r.drawDigits as number[] | undefined)?.join(' ') ?? '—'}`}
          />
          <Row
            k="Your ticket"
            v={`${(r.digits as number[] | undefined)?.join(' ') ?? '—'}`}
          />
          <Row k="Matched" v={`${r.matchLen ?? 0} digit(s)`} />
          <Row
            k="Bracket"
            v={r.bracket != null ? `Match ${(r.bracket as number) + 1}` : 'none'}
          />
          {r.payoutScad ? <Row k="Prize" v={`${r.payoutScad} SCAD`} /> : null}
        </>
      );
    default:
      return null;
  }
}

/** Provably-fair verify deep-link into /fairness with this bet's seed inputs. */
function VerifyLink({ bet }: { bet: BetRow }) {
  if (!bet.seed) return null;
  const qs = new URLSearchParams({
    game: bet.gameType,
    clientSeed: bet.seed.clientSeed,
    nonce: String(bet.nonce ?? 0),
    commit: bet.seed.serverSeedHash,
  });
  if (bet.seed.serverSeed) qs.set('serverSeed', bet.seed.serverSeed);
  return (
    <a
      href={`/fairness?${qs.toString()}`}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-400 hover:underline"
    >
      <ShieldCheck className="h-3.5 w-3.5" />
      Verify fairness
    </a>
  );
}

export function BetDetail({ bet }: { bet: BetRow }) {
  return (
    <div className="grid gap-4 px-6 py-4 sm:grid-cols-2">
      <div className="space-y-0.5 divide-y divide-border/30">
        <ResultDetail bet={bet} />
      </div>
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <VerifyLink bet={bet} />
        {bet.txSignature ? (
          <a
            href={`https://solscan.io/tx/${bet.txSignature}?cluster=${env.solanaNetwork}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-400 hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Settlement tx
          </a>
        ) : (
          <span className="text-xs text-foreground-muted">No on-chain tx yet</span>
        )}
      </div>
    </div>
  );
}
