import { Container } from '@/components/ui/container';
import { CrashGame } from './crash-game';

export const metadata = { title: 'Crash' };

export default function CrashPage() {
  return (
    <Container>
      <div className="py-4">
        <CrashGame />
      </div>
    </Container>
  );
}
