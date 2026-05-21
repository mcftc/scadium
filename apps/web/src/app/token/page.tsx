import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Container } from '@/components/ui/container';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Flame, Coins, TrendingUp, Gift } from 'lucide-react';

export const metadata = { title: '$SCADIUM Token' };

export default function TokenPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-12">
            <div className="mb-10 text-center">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface border border-primary-400/30 mb-6">
                <div className="h-1.5 w-1.5 rounded-full bg-primary-400 animate-pulse-glow" />
                <span className="text-xs font-medium text-foreground-muted">Native token</span>
              </div>
              <h1 className="text-5xl md:text-7xl font-bold">
                <span className="text-gradient">$SCADIUM</span>
              </h1>
              <p className="mt-4 text-foreground-muted max-w-xl mx-auto text-lg">
                Earn by playing. Buy-and-burn funded by site profit. No presale, no team
                unlocks.
              </p>
            </div>

            <div className="grid md:grid-cols-4 gap-4 max-w-4xl mx-auto mb-8">
              <StatCard icon={Coins} label="Price" value="$0.0305" />
              <StatCard icon={TrendingUp} label="Market cap" value="$3.05M" />
              <StatCard icon={Gift} label="Holders" value="12,480" />
              <StatCard icon={Flame} label="Burned" value="127k" />
            </div>

            <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              <Card>
                <CardHeader>
                  <CardTitle>Tokenomics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <TokenRow label="Retroactive airdrop" pct={50} />
                  <TokenRow label="Future airdrops" pct={40} />
                  <TokenRow label="Team &amp; development" pct={10} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Earning rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-xl bg-surface-elevated border border-border p-5 text-center">
                    <div className="text-xs uppercase tracking-wider text-foreground-muted">
                      Per 1 SOL wagered
                    </div>
                    <div className="text-4xl font-bold text-gradient mt-2">128</div>
                    <div className="text-xs text-foreground-muted">$SCADIUM</div>
                  </div>
                  <div className="mt-4 text-sm text-foreground-muted">
                    Earn $SCADIUM automatically as you play any game. Tokens credit to your
                    account and become claimable at each new drop event.
                  </div>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardHeader>
                  <CardTitle>Buy-and-burn mechanic</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-foreground-muted leading-relaxed">
                    <span className="font-bold text-foreground">20%</span> of daily house
                    profit is used to buy $SCADIUM from the open market and burn the tokens —
                    applying constant deflationary pressure proportional to platform activity.
                  </p>
                  <div className="mt-4 flex items-center gap-2 text-xs text-foreground-muted">
                    <Flame className="h-4 w-4 text-primary-400" />
                    Last burn: 2,487 $SCADIUM · 6 hours ago
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-foreground-muted">
            {label}
          </span>
          <Icon className="h-4 w-4 text-primary-400" />
        </div>
        <div className="mt-2 text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function TokenRow({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span>{label}</span>
        <span className="font-mono text-primary-400">{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-surface-elevated overflow-hidden">
        <div
          className="h-full bg-gradient-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
