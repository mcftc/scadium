import { notFound } from 'next/navigation';
import { isGameVisible } from '@/config/games';
import { Container } from '@/components/ui/container';
import { MinesGame } from './mines-game';

export const metadata = { title: 'Mines' };

export default function MinesPage() {
  // Config-driven guard: flipping NEXT_PUBLIC_ENABLED_GAMES alone must be
  // enough to take a game on/off the menu — this must 404 the direct route too.
  if (!isGameVisible('mines')) notFound();

  return (
    <Container>
      <div className="py-4">
        <MinesGame />
      </div>
    </Container>
  );
}
