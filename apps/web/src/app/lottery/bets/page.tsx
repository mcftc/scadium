import { Header } from '@/components/layout/header';
import { GameFooter } from '@/components/layout/game-footer';
import { Container } from '@/components/ui/container';
import { MyBets } from './my-bets';

export const metadata = { title: 'My Lottery Bets' };

export default function MyLotteryBetsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-6">
            <div className="mb-5">
              <h1 className="text-2xl md:text-3xl font-bold">
                <span className="text-gradient">My Bets</span>{' '}
                <span className="text-foreground-muted text-base font-normal">Lottery</span>
              </h1>
            </div>
            <MyBets />
          </div>
        </Container>
      </main>
      <GameFooter />
    </div>
  );
}
