import { Container } from '@/components/ui/container';
import { HiloGame } from './hilo-game';

export const metadata = { title: 'Hi-Lo' };

export default function HiloPage() {
  return (
    <Container>
      <div className="py-4">
        <HiloGame />
      </div>
    </Container>
  );
}
