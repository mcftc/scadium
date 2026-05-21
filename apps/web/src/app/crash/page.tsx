import { Header } from '@/components/layout/header';
import { GameFooter } from '@/components/layout/game-footer';
import { Container } from '@/components/ui/container';
import { CrashGame } from './crash-game';

export const metadata = { title: 'Crash' };

export default function CrashPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-4">
            <CrashGame />
          </div>
        </Container>
      </main>
      <GameFooter />
    </div>
  );
}
