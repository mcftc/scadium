import Link from 'next/link';
import {
  SCAD,
  ENGINE,
  VAULT,
  WAGER,
  MINING,
  GENESIS_BLOCK_REWARD_BASE,
  LAMPORTS_PER_SOL,
} from '@scadium/shared';
import { Container } from '@/components/ui/container';

export const metadata = { title: '$SCAD Whitepaper' };

// Derive EVERY tokenomics figure straight from the engine's single source of
// truth (`packages/shared/src/constants.ts`) so this page can never drift from
// the live numbers the API serves. $SCAD is a pure Proof-of-Play MINING token:
// 1B fixed supply, a 4-year-halving emission, revenue shared with holders.
const M = (whole: number) => `${Math.round(whole / 1_000_000)}M`;
const fmt = (whole: number) => whole.toLocaleString('en-US');
const PCT = (frac: number) => `${Math.round(frac * 100)}%`;

const ALLOC = [
  { label: 'Play-to-Earn emission (mineable)', frac: SCAD.ALLOC_P2E },
  { label: 'Community / Airdrop', frac: SCAD.ALLOC_COMMUNITY },
  { label: 'Liquidity', frac: SCAD.ALLOC_LIQUIDITY },
  { label: 'Treasury / Ecosystem / MM', frac: SCAD.ALLOC_TREASURY },
  { label: 'Team', frac: SCAD.ALLOC_TEAM },
  { label: 'Strategic', frac: SCAD.ALLOC_STRATEGIC },
];

// Mining: 4-year halving (Bitcoin-style). Era 0 mints ~this much per hour.
const BLOCK_REWARD_WHOLE = Number(GENESIS_BLOCK_REWARD_BASE / 10n ** BigInt(SCAD.DECIMALS));
const HALVING_YEARS = MINING.YEARS_PER_HALVING;
const BIG_REWARD_PCT = ENGINE.BIG_REWARD_BPS / 100;
const STAKE_PLAYRATE_PCT = ENGINE.STAKE_PLAYRATE_BPS / 100;
// Revenue redistribution to holders: 12% staking dividend + 8% vault yield = 20% of NGR.
const DIVIDEND_PCT = ENGINE.DIVIDEND_NGR_BPS / 100;
const VAULT_PCT = VAULT.YIELD_NGR_BPS / 100;
const REDIST_PCT = DIVIDEND_PCT + VAULT_PCT;
// Explicit supply breakdown (the headline numbers).
const TOTAL = SCAD.TOTAL_SUPPLY;
const MINEABLE = SCAD.TOTAL_SUPPLY * SCAD.ALLOC_P2E;
const TEAM = SCAD.TOTAL_SUPPLY * SCAD.ALLOC_TEAM;
// Loyalty: lifetime wager → a permanent mining play-rate multiplier.
const WAGER_TIERS = WAGER.TIER_MULTIPLIER.map((mult, i) => ({
  mult,
  sol: (WAGER.TIER_THRESHOLDS_LAMPORTS[i] ?? 0) / LAMPORTS_PER_SOL,
}));
// SCAD Vault: term-lock pools + $SCAD-holdings loyalty APR boost tiers.
const VAULT_TERMS = VAULT.TERMS.map((t) => t.days);
const VAULT_PENALTY_PCT = VAULT.EARLY_EXIT_PENALTY_BPS / 100;
const BOOST_TIERS = VAULT.BOOST_TIERS.map((t) => ({
  label: t.label,
  mult: t.multiplierBps / 10_000,
  scad: Number(t.minScadBase / 10n ** BigInt(SCAD.DECIMALS)),
}));
const MAX_BOOST = Math.max(...BOOST_TIERS.map((t) => t.mult));
const CASHBACK = SCAD.CASHBACK_PER_LAMPORT_LOST;

/**
 * $SCAD whitepaper: intro, mission, tokenomics, the SCAD Engine (mining +
 * staking + vault), revenue redistribution, roadmap, contract, disclaimer. Every
 * number derives from `@scadium/shared`, so the doc is always in lock-step with
 * the engine and /token/stats.
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
            $SCAD is a pure <strong>Proof-of-Play mining token</strong> with a fixed supply. At a
            glance:
          </p>
          <ul className="list-disc pl-5 space-y-1 mb-3">
            <li>
              <strong>Total supply:</strong> {fmt(TOTAL)} (fixed max, {M(TOTAL)})
            </li>
            <li>
              <strong>Mineable (Play-to-Earn):</strong> {M(MINEABLE)} ({PCT(SCAD.ALLOC_P2E)}) —
              emitted to players over time
            </li>
            <li>
              <strong>Team:</strong> {M(TEAM)} ({PCT(SCAD.ALLOC_TEAM)}) — vested, locked before
              launch
            </li>
          </ul>
          <p className="mb-2">Full six-way allocation:</p>
          <ul className="list-disc pl-5 space-y-1">
            {ALLOC.map((a) => (
              <li key={a.label}>
                <strong>{a.label}:</strong> {PCT(a.frac)} ({M(SCAD.TOTAL_SUPPLY * a.frac)})
              </li>
            ))}
          </ul>
          <p className="mt-3">
            <strong>Proof-of-Play mining (4-year halving):</strong> $SCAD is emitted in hourly
            blocks whose subsidy <strong>halves every {HALVING_YEARS} years</strong>, Bitcoin-style.
            The first era mints ≈ <strong>{fmt(BLOCK_REWARD_WHOLE)} $SCAD per hour</strong> (about
            half the {M(MINEABLE)} mineable pool over the first {HALVING_YEARS} years); each era
            halves, draining the pool over a long tail. Every block is split among that hour&apos;s
            players by <strong>play-rate</strong> (how much you wagered, scaled by your loyalty
            tier); {BIG_REWARD_PCT}% of every block goes to a weighted-random big-reward draw, and
            staked $SCAD earns a passive play-rate ({STAKE_PLAYRATE_PCT}% of your stake per hour) so
            holders keep mining even while idle.
          </p>
          <p className="mt-2">
            <strong>Loyalty mining tiers:</strong> lifetime wager earns a permanent play-rate
            multiplier —{' '}
            {WAGER_TIERS.map((t) => `×${t.mult.toFixed(2)} (${fmt(t.sol)}+ SOL)`).join(', ')}.
            Cashback accrues separately at <strong>{CASHBACK} $SCAD per 1 SOL of net losses</strong>
            . Mining rewards, cashback and dividends are all claimable on-chain at any time.
          </p>
        </Section>

        <Section n="4" title="The SCAD Engine — Stake, Earn USDS &amp; Vault">
          <p className="mb-2">
            The SCAD Engine turns play into yield. Net Gaming Revenue (NGR = bets − wins − rewards)
            is shared back to $SCAD holders through two staking products, funded by a combined{' '}
            <strong>{REDIST_PCT}% of NGR</strong>:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Liquid staking → USDS dividends.</strong> Stake $SCAD and earn a pro-rata
              share of <strong>{DIVIDEND_PCT}% of NGR</strong>, paid hourly in <strong>USDS</strong>{' '}
              (a USD-pegged dividend token). Staking is liquid — unstake any time — and auto-engages
              when you claim mining rewards.
            </li>
            <li>
              <strong>SCAD Vault → term yield.</strong> Lock $SCAD for a fixed term (
              {VAULT_TERMS.join(' / ')} days) to earn the Vault slice (
              <strong>{VAULT_PCT}% of NGR</strong>); longer terms get a bigger share. Early
              withdrawal is allowed but keeps a {VAULT_PENALTY_PCT}% penalty in the pool, lifting
              the yield of everyone who holds to maturity (ERC-4626-style share index).
            </li>
          </ul>
          <p className="mt-3">
            <strong>Loyalty APR boost:</strong> the more $SCAD you hold, the higher your Vault APR —{' '}
            {BOOST_TIERS.map((t) => `${t.label} ×${t.mult.toFixed(2)}`).join(' · ')} — up to{' '}
            {MAX_BOOST.toFixed(1)}× at the top tier (
            {fmt(BOOST_TIERS[BOOST_TIERS.length - 1]!.scad)} $SCAD held).
          </p>
        </Section>

        <Section n="5" title="Revenue Redistribution">
          <p className="mb-2">
            <strong>{REDIST_PCT}% of net gaming revenue</strong> flows back to $SCAD holders. There
            is <strong>no buy-and-burn</strong> — $SCAD is a mining token, not a deflationary one —
            so the entire holder slice is paid out across two streams:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>{DIVIDEND_PCT}% staking dividends</strong> — paid pro-rata to liquid $SCAD
              stakers in USDS (§4)
            </li>
            <li>
              <strong>{VAULT_PCT}% vault yield</strong> — accrued to term-locked $SCAD vault
              positions (§4)
            </li>
          </ul>
          <p className="mt-3">
            The casino keeps ≥{100 - REDIST_PCT}% of NGR. A SCAD/SOL liquidity pool powers in-app
            trading (buy/sell on the{' '}
            <Link href="/token" className="text-primary-400 hover:underline">
              token page
            </Link>
            ).
          </p>
        </Section>

        <Section n="6" title="Roadmap">
          <Phase title="Phase 1 — Platform Launch">
            Crash, Coinflip, Blackjack, Jackpot and Lottery live with provably fair seeds and SIWS
            wallet auth (play-money beta); on-chain vault custody (deposit/withdraw) and per-bet
            settlement receipts are the next milestone.
          </Phase>
          <Phase title="Phase 2 — Token &amp; Rewards">
            $SCAD launch with the SCAD/SOL pool, in-app trading and liquidity provision;
            Proof-of-Play mining (4-year halving), cashback, daily case and hourly airdrops
            claimable on-chain; liquid staking for USDS dividends and the term Vault.
          </Phase>
          <Phase title="Phase 3 — Expansion">
            Mainnet launch; multi-currency betting (USDC/USDT across all games); additional games
            and social features; mobile-first UX.
          </Phase>
        </Section>

        <Section n="7" title="Contract Addresses">
          <p className="text-sm">
            Program and mint addresses are published in the app footer and on the{' '}
            <Link href="/fairness" className="text-primary-400 hover:underline">
              fairness page
            </Link>{' '}
            per environment (devnet during the public beta; mainnet at launch). All programs are
            open to inspection on Solscan.
          </p>
        </Section>

        <Section n="8" title="Disclaimer">
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
