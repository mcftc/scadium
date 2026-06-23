import type { ReactNode } from 'react';
import { Shield, Zap, Lock, Users, Gift, BarChart3 } from 'lucide-react';
import { Container } from '@/components/ui/container';
import { ChainCopy } from '@/components/chain/chain-copy';

const features: { icon: typeof Lock; title: string; description: ReactNode }[] = [
  {
    icon: Lock,
    title: 'Non-custodial',
    description: (
      <ChainCopy
        onchain="Your wallet is your balance. No deposits, no withdrawals — you sign every bet and payouts land directly in your address."
        playMoney="Sign in with your wallet (SIWS) and play with a play-money balance — no real deposits yet. Wallet-custody settlement arrives with on-chain mode."
      />
    ),
  },
  {
    icon: Shield,
    title: 'Provably fair',
    description:
      'HMAC-SHA256 + on-chain VRF. Commit-reveal seeds let you verify every result yourself, independent of us.',
  },
  {
    icon: Zap,
    title: 'Solana-fast',
    description:
      'Transactions settle in ~400ms with fees measured in fractions of a cent. Play at a natural pace.',
  },
  {
    icon: Gift,
    title: 'Hourly airdrops',
    description:
      'Wager and chat to qualify for hourly SOL airdrops, plus a daily case drop with weighted rewards.',
  },
  {
    icon: Users,
    title: 'Live multiplayer',
    description:
      'General chat, shared crash rounds, and blackjack tables with up to 5 seats against a shared dealer.',
  },
  {
    icon: BarChart3,
    title: 'Mine $SCAD',
    description:
      'Like a miner solving the next block, every round you play mines $SCAD — no hashrate, just playrate. A buy-and-burn funded by 20% of net revenue backs the token.',
  },
];

export function FeaturesSection() {
  return (
    <section className="py-16 md:py-24">
      <Container>
        <div className="mb-12 text-center">
          <h2 className="text-3xl md:text-5xl font-bold">
            Built for <span className="text-gradient">trust</span> and speed
          </h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="p-6">
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary-400/10 border border-primary-400/30">
                  <Icon className="h-6 w-6 text-primary-400" />
                </div>
                <h3 className="text-lg font-bold mb-2">{feature.title}</h3>
                <p className="text-sm text-foreground-muted leading-relaxed">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
