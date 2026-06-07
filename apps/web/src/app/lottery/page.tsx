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
            <span className="text-foreground-muted text-base font-normal">5 of 36 + 1 of 10</span>
          </h1>
          <p className="text-sm text-foreground-muted mt-1">
            Provably-fair draws every 8 hours — 04:00, 12:00 &amp; 20:00. Match more numbers, win more.
          </p>
        </div>
        <LotteryGame />
      </div>
    </Container>
  );
}
