import type { ReactNode } from 'react';
import { Container } from '@/components/ui/container';
import { Card } from '@/components/ui/card';
import { ChainCopy } from '@/components/chain/chain-copy';

export const metadata = { title: 'FAQ' };

const faqs: { q: string; a: ReactNode }[] = [
  {
    q: 'What is Scadium?',
    a: 'A non-custodial, provably-fair Solana casino. You sign in with your wallet (SIWS) and every game result can be reproduced from committed seeds.',
  },
  {
    q: 'How do deposits work?',
    a: (
      <ChainCopy
        onchain="You deposit SOL into your own on-chain vault PDA — Scadium never holds your keys. Withdraw any time with just your wallet signature."
        playMoney="This is a play-money beta — you don't deposit real SOL yet. Every account starts with a play-money balance; on-chain vault deposits and withdrawals arrive when on-chain settlement goes live."
      />
    ),
  },
  {
    q: 'What is provably fair?',
    a: 'Before each round we publish sha256(serverSeed). After the round the seed is revealed so you can recompute the result yourself on the Fairness page.',
  },
  {
    q: 'What is $SCAD?',
    a: 'The native reward token. You earn it by wagering; 20% of net gaming revenue buys $SCAD from the pool and burns it.',
  },
  {
    q: 'How do free lottery tickets work?',
    a: 'Every 1 SOL wagered across any game earns 1 free lottery ticket automatically.',
  },
  {
    q: 'How does the hourly airdrop work?',
    a: 'Each hour a SOL pool (seeded by the house and grown by player tips) is split among everyone who wagered and chatted during that hour.',
  },
];

export default function FaqPage() {
  return (
    <Container>
      <div className="py-8 max-w-3xl">
        <h1 className="text-2xl md:text-3xl font-bold mb-6">
          <span className="text-gradient">FAQ</span>
        </h1>
        <div className="space-y-3">
          {faqs.map((f) => (
            <Card key={f.q} className="p-5">
              <h2 className="text-sm font-bold mb-1.5">{f.q}</h2>
              <p className="text-sm text-foreground-muted">{f.a}</p>
            </Card>
          ))}
        </div>
      </div>
    </Container>
  );
}
