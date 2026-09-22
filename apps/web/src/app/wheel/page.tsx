import { notFound } from 'next/navigation';
import { isGameVisible } from '@/config/games';
import { Container } from '@/components/ui/container';
import { WheelGame } from './wheel-game';

export const metadata = { title: 'Wheel' };

export default function WheelPage() {
  // Config-driven guard: flipping NEXT_PUBLIC_ENABLED_GAMES alone must be
  // enough to take a game on/off the menu — this must 404 the direct route too.
  if (!isGameVisible('wheel')) notFound();

  return (
    <Container>
      <div className="py-4">
        <WheelGame />
      </div>
    </Container>
  );
}
