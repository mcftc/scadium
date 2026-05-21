import { Header } from '@/components/layout/header';
import { GameFooter } from '@/components/layout/game-footer';
import { Container } from '@/components/ui/container';
import { BlackjackTable } from './blackjack-table';

export const metadata = { title: 'Blackjack' };

export default function BlackjackPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-4">
            <BlackjackTable />
          </div>
        </Container>
      </main>
      <GameFooter />
    </div>
  );
}
