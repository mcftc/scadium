import { notFound } from 'next/navigation';
import { isGameVisible } from '@/config/games';
import { Container } from '@/components/ui/container';
import { CrashGame } from './crash-game';

export const metadata = { title: 'Crash' };

export default function CrashPage() {
  // Config-driven guard: flipping NEXT_PUBLIC_ENABLED_GAMES alone must be
  // enough to take a game on/off the menu — this must 404 the direct route too.
  if (!isGameVisible('crash')) notFound();

  return (
    <Container className="max-w-[1800px]">
      <div className="py-4">
        <CrashGame />
      </div>
    </Container>
  );
}
