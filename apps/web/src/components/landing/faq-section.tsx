import type { ReactNode } from 'react';
import { Container } from '@/components/ui/container';
import { ChainCopy } from '@/components/chain/chain-copy';

const faqs: { q: string; a: ReactNode }[] = [
  {
    q: 'Do I need to deposit SOL?',
    a: (
      <ChainCopy
        onchain="No. Scadium is fully non-custodial. Connect your Phantom, Backpack, Solflare, or Ledger wallet, and every bet is a transaction you sign — your SOL never leaves your control except when you explicitly approve a transaction."
        playMoney="This is a play-money beta: connect your wallet to sign in (SIWS) — no real SOL is wagered yet. Every account starts with a play-money balance you can use across all games."
      />
    ),
  },
  {
    q: 'How does provably fair work?',
    a: 'Before each round we publish sha256(serverSeed) as a commitment. After the round ends, we reveal the serverSeed — combined with your clientSeed and the round nonce, you can reproduce the exact result using our open-source verifier on the Fairness page.',
  },
  {
    q: 'What is $SCADIUM?',
    a: 'The native reward token: 1B fixed supply, 500M mineable. Mined by Proof-of-Play — each hour an emission block (halving every 4 years, Bitcoin-style) is split across players by playrate, no hashrate. Allocation: 50% mineable, 10% community, 10% liquidity, 15% treasury, 10% team, 5% strategic. Up to 20% of net gaming revenue flows back to holders as staking dividends (12%, in USDS) and vault yield (8%).',
  },
  {
    q: 'How does earning $SCAD work?',
    a: 'Playing builds your playrate; each hour the $SCAD mining block is split across players by playrate, so the more you play the bigger your share. Stake $SCAD to keep a passive playrate even while idle. Every house-banked game keeps a small, fully-disclosed 5% edge (Blackjack is rules-based), all verifiable on the Fairness page.',
  },
  {
    q: 'Which wallets are supported?',
    a: 'Phantom, Backpack, Solflare, and hardware wallets via Ledger. Any Solana Wallet Standard-compliant wallet will work through our connect modal.',
  },
];

export function FAQSection() {
  return (
    <section className="py-16 md:py-24" id="faq">
      <Container>
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-bold text-center mb-12">
            Frequently asked <span className="text-gradient">questions</span>
          </h2>
          <div className="space-y-4">
            {faqs.map((faq, i) => (
              <details
                key={i}
                className="group rounded-2xl border border-border bg-surface/60 backdrop-blur-xl overflow-hidden"
              >
                <summary className="cursor-pointer list-none p-6 flex items-center justify-between font-semibold hover:bg-surface-elevated/50 transition-colors">
                  <span>{faq.q}</span>
                  <span className="text-primary-400 text-2xl group-open:rotate-45 transition-transform">
                    +
                  </span>
                </summary>
                <div className="px-6 pb-6 text-foreground-muted leading-relaxed">{faq.a}</div>
              </details>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
