import { notFound } from 'next/navigation';
import { isGameVisible } from '@/config/games';
import { Container } from '@/components/ui/container';
import { BlackjackTable } from './blackjack-table';

export const metadata = { title: 'Blackjack' };

export default function BlackjackPage() {
  // Config-driven guard: flipping NEXT_PUBLIC_ENABLED_GAMES alone must be
  // enough to take a game on/off the menu — this must 404 the direct route too.
  if (!isGameVisible('blackjack')) notFound();

  return (
    <Container>
      <div className="py-4">
        <BlackjackTable />
      </div>
    </Container>
  );
}
