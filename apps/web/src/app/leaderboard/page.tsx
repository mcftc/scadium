import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Container } from '@/components/ui/container';
import { LeaderboardBoard } from './leaderboard-board';

export const metadata = { title: 'Leaderboard' };

export default function LeaderboardPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-12">
            <div className="mb-10 text-center">
              <h1 className="text-4xl md:text-6xl font-bold">
                <span className="text-gradient">Leaderboard</span>
              </h1>
              <p className="mt-4 text-foreground-muted">
                Top players by volume and profit. Updates live as bets resolve.
              </p>
            </div>
            <LeaderboardBoard />
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
