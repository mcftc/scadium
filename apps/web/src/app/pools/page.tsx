import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Container } from '@/components/ui/container';
import { AuthGate } from '@/components/auth/auth-gate';
import { PoolsPanel } from './pools-panel';

export const metadata = { title: '$SCAD Liquidity Pools' };

export default function PoolsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-10">
            <div className="mb-8 text-center">
              <h1 className="text-4xl md:text-5xl font-bold">
                <span className="text-gradient">$SCAD Liquidity Pools</span>
              </h1>
              <p className="mt-3 text-foreground-muted">
                Provide SCAD + SOL liquidity and earn passive income from swap fees.
              </p>
            </div>
            <AuthGate>
              <PoolsPanel />
            </AuthGate>
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
