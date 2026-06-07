import { Container } from '@/components/ui/container';
import { AirdropDashboard } from './airdrop-dashboard';

export const metadata = { title: 'Airdrop' };

export default function AirdropPage() {
  return (
    <Container>
      <div className="py-12">
        <div className="mb-10 text-center">
          <h1 className="text-4xl md:text-6xl font-bold">
            <span className="text-gradient">Airdrop</span>
          </h1>
          <p className="mt-4 text-foreground-muted max-w-xl mx-auto">
            Wager and chat to qualify for hourly rewards. Open the daily case for a chance
            at bigger drops.
          </p>
        </div>
        <AirdropDashboard />
      </div>
    </Container>
  );
}
