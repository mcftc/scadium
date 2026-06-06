import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Container } from '@/components/ui/container';
import { TradePanel } from './trade-panel';

export const metadata = { title: 'Buy & Sell $SCAD' };

export default function TradePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-10">
            <div className="mb-8 text-center">
              <h1 className="text-4xl md:text-5xl font-bold">
                <span className="text-gradient">Buy &amp; Sell $SCAD</span>
              </h1>
              <p className="mt-3 text-foreground-muted">
                Trade against the on-chain SCAD/SOL pool — every fill is a real transaction.
              </p>
            </div>
            <TradePanel />
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
