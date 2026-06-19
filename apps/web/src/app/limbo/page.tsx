import { Container } from '@/components/ui/container';
import { LimboGame } from './limbo-game';

export const metadata = { title: 'Limbo' };

export default function LimboPage() {
  return (
    <Container>
      <div className="py-4">
        <LimboGame />
      </div>
    </Container>
  );
}
