import Link from 'next/link';
import { Container } from '@/components/ui/container';

export const metadata = { title: '$SCAD Whitepaper' };

/**
 * $SCAD whitepaper — same structure as solpump's /coin/whitepaper:
 * intro, mission, tokenomics, buy & burn, roadmap, links, contract,
 * disclaimer. Static content; live numbers live on /token and /trade.
 */
export default function WhitepaperPage() {
  return (
    <Container>
      <div className="py-12 max-w-3xl mx-auto">
            <h1 className="text-4xl md:text-5xl font-bold mb-10 text-center">
              <span className="text-gradient">$SCAD Whitepaper</span>
            </h1>

            <Section n="1" title="Introduction">
              <p>
                Scadium is a decentralized betting platform built on the Solana blockchain
                that enables ultra-fast, frictionless gaming through its core offerings:
                Crash, Coinflip, Blackjack, Jackpot and an on-chain Lottery. Players connect
                their wallets directly, wager in SOL (the PancakeSwap-style 6-digit lottery
                buys tickets and pays pooled prizes in $SCAD), and enjoy
                provably fair gameplay with cryptographic verification — every bet
                settlement, token claim, swap and lottery draw is a real Solana transaction.
              </p>
            </Section>

            <Section n="2" title="Mission &amp; Vision">
              <p>
                Build the most transparent casino on Solana: server-authoritative gameplay
                for speed, the chain for custody and proof. Nothing the house does is
                invisible — seeds are committed on-chain before play, results are revealed
                and asserted on-chain after, and the token economy runs through public
                transactions anyone can audit.
              </p>
            </Section>

            <Section n="3" title="Tokenomics">
              <ul className="list-disc pl-5 space-y-1">
                <li>
                  <strong>$SCAD total supply:</strong> 217,755,972
                </li>
                <li>
                  <strong>Existing users:</strong> 50% (108,877,986)
                </li>
                <li>
                  <strong>Future rewards:</strong> 40% (87,102,388) — wager mining, cashback,
                  daily cases and airdrops, paid from the on-chain rewards treasury
                </li>
                <li>
                  <strong>Team:</strong> 10% (21,775,597)
                </li>
              </ul>
              <p className="mt-3">
                Earning rate: <strong>128 $SCAD per 1 SOL wagered</strong>, claimable
                on-chain at any time. Cashback accrues at 32 $SCAD per 1 SOL of net losses.
              </p>
            </Section>

            <Section n="4" title="Buy &amp; Burn">
              <ul className="list-disc pl-5 space-y-1">
                <li>20% of casino net gaming revenue bought and burnt</li>
                <li>Net Gaming Revenue = Bets − (Wins + Rewards)</li>
                <li>Bought from the SCAD/SOL pool automatically, on a recurring schedule</li>
                <li>Every burn is two public transactions: the buy and the SPL burn</li>
                <li>Applies to current and future game modes — deflationary by design</li>
              </ul>
              <p className="mt-3">
                The live burn feed with transaction hashes is on the{' '}
                <Link href="/token" className="text-primary-400 hover:underline">
                  token page
                </Link>
                .
              </p>
            </Section>

            <Section n="5" title="Roadmap">
              <Phase title="Phase 1 — Platform Launch">
                Crash, Coinflip, Blackjack, Jackpot and Lottery live with provably fair
                seeds; SIWS wallet auth; on-chain vault custody (deposit/withdraw) and
                per-bet settlement receipts.
              </Phase>
              <Phase title="Phase 2 — Token &amp; Rewards">
                $SCAD launch with the SCAD/SOL pool, in-app trading and liquidity
                provision; wager mining, cashback, daily case and hourly airdrops claimable
                on-chain; automated buy &amp; burn.
              </Phase>
              <Phase title="Phase 3 — Expansion">
                Mainnet launch; multi-currency betting (USDC/USDT across all games);
                additional games and social features; mobile-first UX.
              </Phase>
            </Section>

            <Section n="6" title="Contract Addresses">
              <p className="text-sm">
                Program and mint addresses are published in the app footer and on the{' '}
                <Link href="/fairness" className="text-primary-400 hover:underline">
                  fairness page
                </Link>{' '}
                per environment (devnet during the public beta; mainnet at launch). All
                programs are open to inspection on Solscan.
              </p>
            </Section>

            <Section n="7" title="Disclaimer">
              <p className="text-sm text-foreground-muted">
                $SCAD is a utility and rewards token for the Scadium platform. Nothing in
                this document is financial advice. Play responsibly — 18+. Not available in
                restricted jurisdictions.
              </p>
            </Section>
          </div>
    </Container>
  );
}

function Section({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h3 className="text-xl font-bold mb-3">
        <span className="text-primary-400">{n}.</span> {title}
      </h3>
      <div className="text-foreground-muted leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

function Phase({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="font-semibold text-foreground">{title}</div>
      <p className="text-sm">{children}</p>
    </div>
  );
}
