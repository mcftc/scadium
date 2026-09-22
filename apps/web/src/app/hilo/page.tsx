import { notFound } from 'next/navigation';
import { isGameVisible } from '@/config/games';
import { Container } from '@/components/ui/container';
import { HiloGame } from './hilo-game';

export const metadata = { title: 'Hi-Lo' };

export default function HiloPage() {
  // Config-driven guard: flipping NEXT_PUBLIC_ENABLED_GAMES alone must be
  // enough to take a game on/off the menu — this must 404 the direct route too.
  if (!isGameVisible('hilo')) notFound();

  return (
    <Container>
      <div className="py-4">
        <HiloGame />
      </div>
    </Container>
  );
}
