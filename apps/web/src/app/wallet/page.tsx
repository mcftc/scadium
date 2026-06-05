import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Container } from '@/components/ui/container';
import { AuthGate } from '@/components/auth/auth-gate';
import { TransferFunds } from './transfer-funds';

export const metadata = { title: 'Transfer Funds' };

export default function WalletPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-12">
            <h1 className="text-4xl font-bold mb-8 text-center">
              <span className="text-gradient">Transfer Funds</span>
            </h1>
            <AuthGate>
              <TransferFunds />
            </AuthGate>
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
