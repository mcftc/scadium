import { Container } from '@/components/ui/container';
import { EngineSubNav } from '@/components/layout/engine-subnav';
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
            Earn by playing. Gaming revenue shared with holders as dividends. No presale, no team
            unlocks.
          </p>
        </div>

        <EngineSubNav />

        <TokenDashboard />
      </div>
    </Container>
  );
}
