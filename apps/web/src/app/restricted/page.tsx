import { Container } from '@/components/ui/container';
import { Card } from '@/components/ui/card';

export const metadata = { title: 'Restricted' };

export default function RestrictedPage() {
  return (
    <Container>
      <div className="mx-auto max-w-xl space-y-4 py-16 text-center">
        <h1 className="text-2xl font-bold md:text-3xl">
          <span className="text-gradient">Access restricted</span>
        </h1>
        <Card className="space-y-3 p-6 text-sm text-foreground-muted">
          <p>
            Scadium is not available in your jurisdiction. Access from restricted or sanctioned
            regions is blocked for legal and regulatory reasons.
          </p>
          <p>If you believe you are seeing this in error, please contact support.</p>
        </Card>
      </div>
    </Container>
  );
}
