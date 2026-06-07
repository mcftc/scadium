import { Container } from '@/components/ui/container';
import { JackpotGame } from './jackpot-game';

export const metadata = { title: 'Jackpot' };

export default function JackpotPage() {
  return (
    <Container>
      <div className="py-6">
        <div className="mb-5">
          <h1 className="text-2xl md:text-3xl font-bold">
            <span className="text-gradient">Jackpot</span>{' '}
            <span className="text-foreground-muted text-base font-normal">winner takes the pot</span>
          </h1>
          <p className="text-sm text-foreground-muted mt-1">
            Enter the pot with SOL — your win chance equals your share. Provably-fair draw
            every 45 seconds.
          </p>
        </div>
        <JackpotGame />
      </div>
    </Container>
  );
}
