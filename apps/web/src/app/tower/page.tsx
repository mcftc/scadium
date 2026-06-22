import { Container } from '@/components/ui/container';
import { TowerGame } from './tower-game';

export const metadata = { title: 'Tower' };

export default function TowerPage() {
  return (
    <Container>
      <div className="py-4">
        <TowerGame />
      </div>
    </Container>
  );
}
