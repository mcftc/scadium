import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Container } from '@/components/ui/container';
import { AuthGate } from '@/components/auth/auth-gate';
import { AffiliatesDashboard } from './affiliates-dashboard';

export const metadata = { title: 'Affiliates' };

export default function AffiliatesPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-12">
            <div className="mb-10 text-center">
              <h1 className="text-4xl md:text-6xl font-bold">
                <span className="text-gradient">Affiliates</span>
              </h1>
              <p className="mt-4 text-foreground-muted max-w-xl mx-auto">
                Share your referral link, earn a cut of every friend&apos;s wagering volume.
              </p>
            </div>
            <AuthGate>
              <AffiliatesDashboard />
            </AuthGate>
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
