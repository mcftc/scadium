import { Container } from '@/components/ui/container';
import { Card } from '@/components/ui/card';
import { LegalMeta } from '@/components/legal/legal-meta';

export const metadata = { title: 'Cookie Policy' };

const sections = [
  {
    h: 'Essential cookies',
    p: 'We use a small number of strictly necessary cookies and local-storage keys to keep you signed in, remember your age and legal-acceptance confirmations, and run the games. These cannot be turned off without breaking the site.',
  },
  {
    h: 'Analytics & non-essential cookies',
    p: 'Any analytics, performance or marketing cookies are off by default and load only after you accept them in the consent banner. Choosing "Reject" keeps them disabled; only essential storage remains.',
  },
  {
    h: 'Your choice',
    p: 'Your consent choice is stored locally so the banner does not reappear every visit. Clear your browser storage to be asked again.',
  },
  {
    h: 'Third parties',
    p: 'Wallet adapters and on-chain RPC providers you connect to may set their own storage governed by their policies; we do not control those.',
  },
];

export default function CookiePage() {
  return (
    <Container>
      <div className="py-8 max-w-3xl space-y-4">
        <h1 className="text-2xl md:text-3xl font-bold">
          <span className="text-gradient">Cookie Policy</span>
        </h1>
        <LegalMeta doc="cookie" />
        <Card className="p-6 space-y-5">
          {sections.map((s) => (
            <div key={s.h}>
              <h2 className="text-sm font-bold mb-1">{s.h}</h2>
              <p className="text-sm text-foreground-muted">{s.p}</p>
            </div>
          ))}
        </Card>
      </div>
    </Container>
  );
}
