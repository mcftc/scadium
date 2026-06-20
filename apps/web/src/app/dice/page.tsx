import { Container } from '@/components/ui/container';
import { DiceGame } from './dice-game';

export const metadata = { title: 'Dice' };

export default function DicePage() {
  return (
    <Container>
      <div className="py-4">
        <DiceGame />
      </div>
    </Container>
  );
}
