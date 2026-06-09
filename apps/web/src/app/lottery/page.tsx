import { Container } from '@/components/ui/container';
import { LotteryGame } from './lottery-game';

export const metadata = { title: 'Lottery' };

export default function LotteryPage() {
  return (
    <Container>
      <div className="py-6">
        <div className="mb-5">
          <h1 className="text-2xl md:text-3xl font-bold">
            <span className="text-gradient">Lottery</span>{' '}
            <span className="text-foreground-muted text-base font-normal">6-digit · $SCAD</span>
          </h1>
          <p className="text-sm text-foreground-muted mt-1">
            Provably-fair draw daily at 12:00 (UTC+3). Match the winning number left-to-right — the
            more leading digits, the bigger the bracket.
          </p>
        </div>
        <LotteryGame />
      </div>
    </Container>
  );
}
