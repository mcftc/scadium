import { Container } from '@/components/ui/container';
import { AuthGate } from '@/components/auth/auth-gate';
import { AffiliatesDashboard } from './affiliates-dashboard';

export const metadata = { title: 'Affiliates' };

export default function AffiliatesPage() {
  return (
    <Container>
      <div className="py-12">
        <div className="mb-10 text-center">
          <h1 className="text-4xl md:text-6xl font-bold">
            <span className="text-gradient">Affiliates</span>
          </h1>
          <p className="mt-4 text-foreground-muted max-w-xl mx-auto">
            Share your referral link, earn a cut of every friend&apos;s play volume.
          </p>
        </div>
        <AuthGate>
          <AffiliatesDashboard />
        </AuthGate>
      </div>
    </Container>
  );
}
