import { Container } from '@/components/ui/container';
import { VaultDashboard } from './vault-dashboard';

export const metadata = { title: 'SCAD Vault' };

export default function VaultPage() {
  return (
    <Container>
      <div className="py-12">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface border border-primary-400/30 mb-6">
            <div className="h-1.5 w-1.5 rounded-full bg-primary-400 animate-pulse-glow" />
            <span className="text-xs font-medium text-foreground-muted">
              Lock $SCAD · earn yield · watch it grow
            </span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold">
            <span className="text-gradient">SCAD Vault</span>
          </h1>
          <p className="mt-4 text-foreground-muted max-w-xl mx-auto text-lg">
            The term-deposit tier: lock $SCAD for a fixed term and earn a share of the house yield —
            the longer the term, the higher the APR. Your earnings tick in real time.
          </p>
        </div>

        <VaultDashboard />
      </div>
    </Container>
  );
}
