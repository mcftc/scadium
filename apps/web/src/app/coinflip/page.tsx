import { Header } from '@/components/layout/header';
import { GameFooter } from '@/components/layout/game-footer';
import { Container } from '@/components/ui/container';
import { CoinflipLobby } from './coinflip-lobby';

export const metadata = { title: 'Coinflip' };

export default function CoinflipPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-6">
            <CoinflipLobby />
          </div>
        </Container>
      </main>
      <GameFooter />
    </div>
  );
}
