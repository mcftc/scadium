import { notFound } from 'next/navigation';
import { isGameVisible } from '@/config/games';
import { Container } from '@/components/ui/container';
import { CoinflipLobby } from './coinflip-lobby';

export const metadata = { title: 'Coinflip' };

export default function CoinflipPage() {
  // Config-driven guard: flipping NEXT_PUBLIC_ENABLED_GAMES alone must be
  // enough to take a game on/off the menu — this must 404 the direct route too.
  if (!isGameVisible('coinflip')) notFound();

  return (
    <Container>
      <div className="py-6">
        <CoinflipLobby />
      </div>
    </Container>
  );
}
