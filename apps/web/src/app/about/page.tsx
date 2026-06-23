import { Container } from '@/components/ui/container';
import { Card } from '@/components/ui/card';
import { ChainCopy } from '@/components/chain/chain-copy';
import { Reveal } from '@/components/ui/reveal';
import { HeroSection } from '@/components/landing/hero-section';
import { FeaturesSection } from '@/components/landing/features-section';
import { GamesGrid } from '@/components/landing/games-grid';
import { FAQSection } from '@/components/landing/faq-section';

export const metadata = { title: 'About Us' };

/**
 * Marketing / SEO landing. The app itself is game-first (`/` → /crash), so this
 * is where the brand story lives: hero → features → game grid → the "About"
 * card → FAQ, each scroll-revealed. (The hero/features/grid/faq components were
 * previously orphaned; this wires them into a real page.)
 */
export default function AboutPage() {
  return (
    <>
      <HeroSection />

      <Reveal>
        <FeaturesSection />
      </Reveal>

      <Reveal>
        <GamesGrid />
      </Reveal>

      <Container>
        <Reveal className="mx-auto max-w-3xl space-y-4 py-12">
          <h2 className="text-2xl md:text-3xl font-bold">
            <span className="text-gradient">About Scadium</span>
          </h2>
          <Card className="p-6 space-y-4 text-sm text-foreground-muted">
            <p>
              Scadium is a non-custodial, provably-fair play-to-earn platform built on Solana —
              every round mines $SCAD. Game results derive from cryptographically committed seeds,
              and the native{' '}
              <span className="text-foreground font-semibold">$SCAD</span> token is fueled by a
              transparent buy-and-burn funded from gaming revenue.
            </p>
            <p>
              <ChainCopy
                onchain="Funds live in on-chain vaults you control — Scadium never holds your keys."
                playMoney="This is a play-money beta: balances are tracked off-chain (in our database) today — self-custodied on-chain vaults arrive in a later phase."
              />
            </p>
            <p>
              Crash, Coinflip, Blackjack, Jackpot and a bc.game-style Lottery — every round
              verifiable by anyone.{' '}
              <ChainCopy
                onchain="Every payout settled on-chain."
                playMoney="Play-money beta — settlement runs off-chain today."
              />
            </p>
            <p className="text-xs">
              Scadium is for entertainment purposes. 18+. Play responsibly. Not available in
              restricted jurisdictions.
            </p>
          </Card>
        </Reveal>
      </Container>

      <Reveal>
        <FAQSection />
      </Reveal>
    </>
  );
}
