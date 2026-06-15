import { Container } from '@/components/ui/container';
import { Card } from '@/components/ui/card';
import { LegalMeta } from '@/components/legal/legal-meta';

export const metadata = { title: 'AML Policy' };

const sections = [
  {
    h: 'Purpose',
    p: 'Scadium is committed to preventing money laundering and terrorist financing through its platform.',
  },
  {
    h: 'Monitoring',
    p: 'On-chain deposits and withdrawals are public and auditable by nature. Automated monitoring for abnormal patterns (e.g. rapid pass-through with minimal wagering) is being implemented as part of our move toward real-money play; until then the platform runs on play-money balances.',
  },
  {
    h: 'Restricted jurisdictions',
    p: 'Users from sanctioned or restricted jurisdictions are not permitted to use the service.',
  },
  {
    h: 'Action',
    p: 'Suspicious activity may result in account restriction and, where legally required, reporting to relevant authorities.',
  },
];

export default function AmlPage() {
  return (
    <Container>
      <div className="py-8 max-w-3xl space-y-4">
        <h1 className="text-2xl md:text-3xl font-bold">
          <span className="text-gradient">AML Policy</span>
        </h1>
        <LegalMeta doc="aml" />
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
