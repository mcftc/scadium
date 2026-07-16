import { GAME_RTP } from '@scadium/shared';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/cn';

/**
 * Published RTP / house-edge chip (#roadmap-2). Solpump markets its edge openly
 * and an edge-vs-advertised discrepancy is a named trust failure — so we surface
 * the SAME figure the payout math uses (`GAME_RTP`, single source in @scadium/shared).
 * Links to the provably-fair verifier so the number is auditable, not just claimed.
 */
export function HouseEdgeBadge({ game, className }: { game: string; className?: string }) {
  const info = GAME_RTP[game];
  if (!info) return null;
  return (
    <Link
      href="/fairness"
      className={cn(
        'group inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/60 px-2.5 py-1 text-[11px] text-foreground-muted transition-colors hover:border-primary-400/40 hover:text-foreground',
        className,
      )}
      title="Return-to-player — see the provably-fair verifier"
    >
      <ShieldCheck className="h-3.5 w-3.5 text-primary-400" />
      <span className="font-semibold uppercase tracking-wider">RTP</span>
      <span className="font-display tabular-nums font-semibold text-foreground">{info.rtp}</span>
      {info.note && <span className="hidden sm:inline text-foreground-muted/70">· {info.note}</span>}
    </Link>
  );
}
