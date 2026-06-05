import { Header } from '@/components/layout/header';
import { GameFooter } from '@/components/layout/game-footer';
import { Container } from '@/components/ui/container';
import { LotteryGame } from './lottery-game';

export const metadata = { title: 'Lottery' };

export default function LotteryPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-6">
            <div className="mb-5">
              <h1 className="text-2xl md:text-3xl font-bold">
                <span className="text-gradient">Lottery</span>{' '}
                <span className="text-foreground-muted text-base font-normal">5 of 36 + 1 of 10</span>
              </h1>
              <p className="text-sm text-foreground-muted mt-1">
                Provably-fair draws twice a day — 04:00 &amp; 16:00. Match more numbers, win more.
              </p>
            </div>
            <LotteryGame />
          </div>
        </Container>
      </main>
      <GameFooter />
    </div>
  );
}
