import Link from 'next/link';
import { ArrowRight, Shield, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Container } from '@/components/ui/container';

export function HeroSection() {
  return (
    <section className="relative overflow-hidden py-20 md:py-32">
      <Container>
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface border border-primary-400/30 mb-8">
            <div className="h-1.5 w-1.5 rounded-full bg-primary-400 animate-pulse-glow" />
            <span className="text-xs font-medium text-foreground-muted">
              Live on Solana · Non-Custodial
            </span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold tracking-tight max-w-4xl">
            The <span className="text-gradient">decentralized</span>
            <br />
            casino on Solana
          </h1>

          <p className="mt-6 text-lg md:text-xl text-foreground-muted max-w-2xl">
            Crash. Coinflip. Blackjack. Provably fair, instantly settled, never custodial. Connect
            your wallet and play — your SOL stays in your control.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link href="/crash">
              <Button size="lg" variant="primary">
                Start Playing
                <ArrowRight className="h-5 w-5" />
              </Button>
            </Link>
            <Link href="/fairness">
              <Button size="lg" variant="secondary">
                <Shield className="h-5 w-5" />
                Verify Fairness
              </Button>
            </Link>
          </div>

          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-8 w-full max-w-3xl">
            {[
              { label: 'Settlement', value: '~400ms', icon: Zap },
              { label: 'Fees', value: '<$0.01' },
              { label: 'House edge', value: '5%' },
              { label: 'Audited', value: 'Yes' },
            ].map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-2xl md:text-3xl font-bold text-gradient">{stat.value}</div>
                <div className="text-xs uppercase tracking-wider text-foreground-muted mt-1">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
