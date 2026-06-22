import { Container } from '@/components/ui/container';
import { MinesGame } from './mines-game';

export const metadata = { title: 'Mines' };

export default function MinesPage() {
  return (
    <Container>
      <div className="py-4">
        <MinesGame />
      </div>
    </Container>
  );
}
