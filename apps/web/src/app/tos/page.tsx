import { Container } from '@/components/ui/container';
import { Card } from '@/components/ui/card';
import { LegalMeta } from '@/components/legal/legal-meta';

export const metadata = { title: 'Terms of Service' };

const sections = [
  {
    h: '1. Eligibility',
    p: 'You must be 18+ and located in a jurisdiction where online wagering is lawful. Access from restricted jurisdictions is prohibited.',
  },
  {
    h: '2. Non-custodial wallets',
    p: 'You connect your own Solana wallet and keep custody of your keys at all times. You are responsible for securing your wallet.',
  },
  {
    h: '3. Fair play',
    p: 'All game outcomes derive from committed server seeds mixed with client seeds and, where applicable, Solana slot hashes. Exploiting bugs, automation abuse, or multi-accounting may lead to account closure.',
  },
  {
    h: '4. $SCAD token',
    p: '$SCAD is a utility/reward token with no guaranteed value. Rewards programs can change with notice.',
  },
  {
    h: '5. Limitation of liability',
    p: 'The platform is provided "as is". To the maximum extent permitted by law we are not liable for losses arising from use of the service, network outages, or wallet errors.',
  },
  {
    h: '6. Responsible play',
    p: 'Wager only what you can afford to lose. Self-exclusion is available on request.',
  },
];

export default function TosPage() {
  return (
    <Container>
      <div className="py-8 max-w-3xl space-y-4">
        <h1 className="text-2xl md:text-3xl font-bold">
          <span className="text-gradient">Terms of Service</span>
        </h1>
        <LegalMeta doc="tos" />
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
