import { Container } from '@/components/ui/container';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Flame } from 'lucide-react';
import { TokenDashboard } from './token-dashboard';

export const metadata = { title: '$SCAD Token' };

export default function TokenPage() {
  return (
    <Container>
      <div className="py-12">
            <div className="mb-10 text-center">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface border border-primary-400/30 mb-6">
                <div className="h-1.5 w-1.5 rounded-full bg-primary-400 animate-pulse-glow" />
                <span className="text-xs font-medium text-foreground-muted">Native token</span>
              </div>
              <h1 className="text-5xl md:text-7xl font-bold">
                <span className="text-gradient">$SCAD</span>
              </h1>
              <p className="mt-4 text-foreground-muted max-w-xl mx-auto text-lg">
                Earn by playing. Buy-and-burn funded by site profit. No presale, no team
                unlocks.
              </p>
            </div>

            <TokenDashboard />

            <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto mt-6">
              <Card>
                <CardHeader>
                  <CardTitle>Tokenomics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <TokenRow label="Existing users" pct={50} />
                  <TokenRow label="Future rewards" pct={40} />
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
                    Every burn is an on-chain transaction — see the live feed above.
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
    </Container>
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
