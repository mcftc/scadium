import { notFound } from 'next/navigation';
import { isGameVisible } from '@/config/games';
import { Container } from '@/components/ui/container';
import { JackpotGame } from './jackpot-game';

export const metadata = { title: 'Jackpot' };

export default function JackpotPage() {
  // Config-driven guard: flipping NEXT_PUBLIC_ENABLED_GAMES alone must be
  // enough to take a game on/off the menu — this must 404 the direct route too.
  if (!isGameVisible('jackpot')) notFound();

  return (
    <Container>
      <div className="py-6">
        <div className="mb-5">
          <h1 className="text-2xl md:text-3xl font-bold">
            <span className="text-gradient">Jackpot</span>{' '}
            <span className="text-foreground-muted text-base font-normal">
              winner takes the pot
            </span>
          </h1>
          <p className="text-sm text-foreground-muted mt-1">
            Enter the pot with SOL — your win chance equals your share. Provably-fair draw every 45
            seconds.
          </p>
        </div>
        <JackpotGame />
      </div>
    </Container>
  );
}
