import { Container } from '@/components/ui/container';
import { EngineSubNav } from '@/components/layout/engine-subnav';
import { EngineDashboard } from './engine-dashboard';

export const metadata = { title: 'SCAD Engine' };

export default function EnginePage() {
  return (
    <Container>
      <div className="py-12">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface border border-primary-400/30 mb-6">
            <div className="h-1.5 w-1.5 rounded-full bg-primary-400 animate-pulse-glow" />
            <span className="text-xs font-medium text-foreground-muted">Play → Earn → Stake → Earn</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold">
            <span className="text-gradient">SCAD Engine</span>
          </h1>
          <p className="mt-4 text-foreground-muted max-w-xl mx-auto text-lg">
            Stake the $SCAD you earn from any game and collect an hourly share of
            the house&apos;s profit, paid in USDS.
          </p>
        </div>

        <EngineSubNav />

        <EngineDashboard />
      </div>
    </Container>
  );
}
