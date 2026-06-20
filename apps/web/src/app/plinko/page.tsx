import { Container } from '@/components/ui/container';
import { PlinkoGame } from './plinko-game';

export const metadata = { title: 'Plinko' };

export default function PlinkoPage() {
  return (
    <Container>
      <div className="py-4">
        <PlinkoGame />
      </div>
    </Container>
  );
}
