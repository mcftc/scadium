import { Container } from '@/components/ui/container';
import { Card } from '@/components/ui/card';

export const metadata = { title: 'AML Policy' };

const sections = [
  {
    h: 'Purpose',
    p: 'Scadium is committed to preventing money laundering and terrorist financing through its platform.',
  },
  {
    h: 'Monitoring',
    p: 'On-chain deposit and withdrawal flows are monitored for abnormal patterns such as rapid pass-through with minimal wagering.',
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
