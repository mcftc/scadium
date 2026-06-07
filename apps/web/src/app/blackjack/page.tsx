import { Container } from '@/components/ui/container';
import { BlackjackTable } from './blackjack-table';

export const metadata = { title: 'Blackjack' };

export default function BlackjackPage() {
  return (
    <Container>
      <div className="py-4">
        <BlackjackTable />
      </div>
    </Container>
  );
}
