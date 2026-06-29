import Link from 'next/link';
import { SCAD, ENGINE, VAULT } from '@scadium/shared';
import { Container } from '@/components/ui/container';

export const metadata = { title: '$SCAD Whitepaper' };

// Derive the displayed tokenomics straight from the engine's single source of
// truth (`packages/shared/src/constants.ts`) so this page can never drift from
// the live numbers served by /token/stats (it did — it used to hard-code a stale
// 217M supply and a 20% burn from a pre-Vault model).
const M = (whole: number) => `${Math.round(whole / 1_000_000)}M`;
const fmt = (whole: number) => whole.toLocaleString('en-US');
const PCT = (frac: number) => `${Math.round(frac * 100)}%`;
const ALLOC = [
  { label: 'Play-to-Earn emission', frac: SCAD.ALLOC_P2E },
  { label: 'Community / Airdrop', frac: SCAD.ALLOC_COMMUNITY },
  { label: 'Liquidity', frac: SCAD.ALLOC_LIQUIDITY },
  { label: 'Treasury / Ecosystem / MM', frac: SCAD.ALLOC_TREASURY },
  { label: 'Team', frac: SCAD.ALLOC_TEAM },
  { label: 'Strategic', frac: SCAD.ALLOC_STRATEGIC },
];
const DIVIDEND_PCT = ENGINE.DIVIDEND_NGR_BPS / 100;
const BURN_PCT = ENGINE.BUYBACK_NGR_BPS / 100;
const VAULT_PCT = VAULT.YIELD_NGR_BPS / 100;
const REDIST_PCT = DIVIDEND_PCT + BURN_PCT + VAULT_PCT;

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
            Scadium is a decentralized betting platform built on the Solana blockchain that enables
            ultra-fast, frictionless gaming through its core offerings: Crash, Coinflip, Blackjack,
            Jackpot and an on-chain Lottery. Players connect their wallets directly, play in SOL
            (the PancakeSwap-style 6-digit lottery buys tickets and pays pooled prizes in $SCAD),
            and enjoy provably fair gameplay with cryptographic verification. Once on-chain
            settlement goes live, every bet settlement, token claim, swap and lottery draw becomes a
            real Solana transaction (play-money beta today).
          </p>
        </Section>

        <Section n="2" title="Mission &amp; Vision">
          <p>
            Build the most transparent play-to-earn platform on Solana: server-authoritative
            gameplay for speed, the chain for custody and proof. Nothing the house does is invisible
            — seeds are committed on-chain before play, results are revealed and asserted on-chain
            after, and the token economy runs through public transactions anyone can audit.
          </p>
        </Section>

        <Section n="3" title="Tokenomics">
          <p className="mb-2">
            <strong>$SCAD total supply:</strong> {fmt(SCAD.TOTAL_SUPPLY)} (fixed max,{' '}
            {M(SCAD.TOTAL_SUPPLY)}). Allocated six ways:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            {ALLOC.map((a) => (
              <li key={a.label}>
                <strong>{a.label}:</strong> {PCT(a.frac)} ({M(SCAD.TOTAL_SUPPLY * a.frac)})
              </li>
            ))}
          </ul>
          <p className="mt-3">
            Earning rate: <strong>128 $SCAD per 1 SOL wagered</strong> at launch, halving across
            seven emission phases (128→64→32→16→8→4→2) until the{' '}
            {M(SCAD.TOTAL_SUPPLY * SCAD.ALLOC_P2E)} Play-to-Earn pool is exhausted; claimable
            on-chain at any time. Cashback accrues at 32 $SCAD per 1 SOL of net losses.
          </p>
        </Section>

        <Section n="4" title="Revenue Redistribution &amp; Buy &amp; Burn">
          <p className="mb-2">
            Up to <strong>{PCT(REDIST_PCT / 100)} of net gaming revenue</strong> is redistributed
            back to the ecosystem, in three streams:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>{BURN_PCT}% buy &amp; burn</strong> — bought from the SCAD/SOL pool and burnt
              on a recurring schedule (deflationary)
            </li>
            <li>
              <strong>{DIVIDEND_PCT}% staking dividends</strong> — paid pro-rata to $SCAD stakers in
              USDS
            </li>
            <li>
              <strong>{VAULT_PCT}% vault yield</strong> — accrued to term-locked $SCAD vault
              positions
            </li>
          </ul>
          <p className="mt-3">
            Net Gaming Revenue = Bets − (Wins + Rewards). The casino keeps ≥{100 - REDIST_PCT}% of
            NGR. Every burn is two public transactions (the buy and the SPL burn); the live burn
            feed with transaction hashes is on the{' '}
            <Link href="/token" className="text-primary-400 hover:underline">
              token page
            </Link>
            .
          </p>
        </Section>

        <Section n="5" title="Roadmap">
          <Phase title="Phase 1 — Platform Launch">
            Crash, Coinflip, Blackjack, Jackpot and Lottery live with provably fair seeds and SIWS
            wallet auth (play-money beta); on-chain vault custody (deposit/withdraw) and per-bet
            settlement receipts are the next milestone.
          </Phase>
          <Phase title="Phase 2 — Token &amp; Rewards">
            $SCAD launch with the SCAD/SOL pool, in-app trading and liquidity provision; $SCAD
            mining, cashback, daily case and hourly airdrops claimable on-chain; automated buy &amp;
            burn.
          </Phase>
          <Phase title="Phase 3 — Expansion">
            Mainnet launch; multi-currency betting (USDC/USDT across all games); additional games
            and social features; mobile-first UX.
          </Phase>
        </Section>

        <Section n="6" title="Contract Addresses">
          <p className="text-sm">
            Program and mint addresses are published in the app footer and on the{' '}
            <Link href="/fairness" className="text-primary-400 hover:underline">
              fairness page
            </Link>{' '}
            per environment (devnet during the public beta; mainnet at launch). All programs are
            open to inspection on Solscan.
          </p>
        </Section>

        <Section n="7" title="Disclaimer">
          <p className="text-sm text-foreground-muted">
            $SCAD is a utility and rewards token for the Scadium platform. Nothing in this document
            is financial advice. Play responsibly — 18+. Not available in restricted jurisdictions.
          </p>
        </Section>
      </div>
    </Container>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
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
