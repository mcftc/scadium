import Link from 'next/link';
import { Container } from '@/components/ui/container';
import { STATEFUL_GAMES } from '@/config/games';

/**
 * Minimal footer for game pages — links only, no marketing copy.
 * Matches solpump's slim footer that shows under game areas.
 */
export function GameFooter() {
  return (
    <footer className="mt-auto border-t border-border/30 bg-surface/20 py-4">
      <Container>
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 text-[10px] text-foreground-muted">
          <div className="flex items-center gap-4">
            {/* Was three hand-picked games (crash/coinflip/blackjack) that had
                drifted from the registry, silently omitting jackpot and lottery.
                Now it's every enabled stateful game, so it can't drift again. */}
            {STATEFUL_GAMES.map((g) => (
              <Link key={g.id} href={g.href} className="hover:text-foreground transition-colors">
                {g.label}
              </Link>
            ))}
            <span className="text-border">|</span>
            <Link href="/fairness" className="hover:text-foreground transition-colors">Provably Fair</Link>
            <Link href="/affiliates" className="hover:text-foreground transition-colors">Affiliates</Link>
            <Link href="/tos" className="hover:text-foreground transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          </div>
          <p>
            © {new Date().getFullYear()} Scadium. 18+. Play responsibly.
          </p>
        </div>
      </Container>
    </footer>
  );
}
