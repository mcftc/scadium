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
    a: 'The native reward token. Mined as you play (128 $SCAD per 1 SOL played) — no hashrate, just playrate. Tokenomics: 50% retroactive airdrops, 40% future drops, 10% team. 20% of net revenue funds buy-and-burn.',
  },
  {
    q: 'How does earning $SCAD work?',
    a: 'Every round mines $SCAD — the more you play, the more you earn. Each game keeps a small, fully-disclosed edge (5% on Crash/Coinflip, ~0.5% on Blackjack), all publicly verifiable on our Fairness page.',
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
