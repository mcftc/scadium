import { Container } from '@/components/ui/container';
import { Card } from '@/components/ui/card';
import { LegalMeta } from '@/components/legal/legal-meta';

export const metadata = { title: 'Privacy Policy' };

const sections = [
  {
    h: 'What we store',
    p: 'Your wallet address, optional username, gameplay history and chat messages. We never hold private keys.',
  },
  {
    h: 'What we do not collect today',
    p: 'In the current play-money beta we require no KYC documents and no email, and run no third-party tracking without your consent (see the Cookie Policy). Identity verification (KYC/AML) will be required before real-money deposits or withdrawals are enabled.',
  },
  {
    h: 'On-chain data',
    p: 'Deposits, withdrawals, lottery tickets and reward claims are public Solana transactions by nature.',
  },
  {
    h: 'Retention & deletion',
    p: 'Gameplay records are kept for fairness auditing. Contact support to request removal of off-chain profile data.',
  },
];

export default function PrivacyPage() {
  return (
    <Container>
      <div className="py-8 max-w-3xl space-y-4">
        <h1 className="text-2xl md:text-3xl font-bold">
          <span className="text-gradient">Privacy Policy</span>
        </h1>
        <LegalMeta doc="privacy" />
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
