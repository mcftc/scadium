import { Container } from '@/components/ui/container';
import { LeaderboardBoard } from './leaderboard-board';
import { DailyRaceCard } from './daily-race-card';

export const metadata = { title: 'Leaderboard' };

export default function LeaderboardPage() {
  return (
    <Container>
      <div className="py-12">
        <div className="mb-10 text-center">
          <h1 className="text-4xl md:text-6xl font-bold">
            <span className="text-gradient">Leaderboard</span>
          </h1>
          <p className="mt-4 text-foreground-muted">
            Race for the daily pool, or climb the all-time boards. Updates live as bets resolve.
          </p>
        </div>
        <div className="space-y-8">
          <DailyRaceCard />
          <LeaderboardBoard />
        </div>
      </div>
    </Container>
  );
}
