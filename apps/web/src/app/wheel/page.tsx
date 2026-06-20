import { Container } from '@/components/ui/container';
import { WheelGame } from './wheel-game';

export const metadata = { title: 'Wheel' };

export default function WheelPage() {
  return (
    <Container>
      <div className="py-4">
        <WheelGame />
      </div>
    </Container>
  );
}
