import { Container } from '@/components/ui/container';
import { CoinflipLobby } from './coinflip-lobby';

export const metadata = { title: 'Coinflip' };

export default function CoinflipPage() {
  return (
    <Container>
      <div className="py-6">
        <CoinflipLobby />
      </div>
    </Container>
  );
}
