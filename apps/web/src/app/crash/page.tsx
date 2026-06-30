import { Container } from '@/components/ui/container';
import { CrashGame } from './crash-game';

export const metadata = { title: 'Crash' };

export default function CrashPage() {
  return (
    <Container className="max-w-[1800px]">
      <div className="py-4">
        <CrashGame />
      </div>
    </Container>
  );
}
