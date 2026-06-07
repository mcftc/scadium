import { Container } from '@/components/ui/container';
import { AuthGate } from '@/components/auth/auth-gate';
import { TransferFunds } from './transfer-funds';

export const metadata = { title: 'Transfer Funds' };

export default function WalletPage() {
  return (
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
  );
}
