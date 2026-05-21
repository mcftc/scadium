import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';
import { Container } from '@/components/ui/container';

interface ComingSoonProps {
  title: string;
  description: string;
  phase?: string;
}

/**
 * Placeholder page shell. Lets nav links resolve during phase-by-phase
 * development without shipping half-baked UIs. Each stub is replaced when
 * its corresponding phase lands (crash → phase 7, blackjack → phase 8, etc.)
 */
export function ComingSoonPage({ title, description, phase }: ComingSoonProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main className="flex-1">
        <Container>
          <div className="py-24 flex flex-col items-center text-center">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface border border-primary-400/30 mb-6">
              <div className="h-1.5 w-1.5 rounded-full bg-primary-400 animate-pulse-glow" />
              <span className="text-xs font-medium text-foreground-muted">
                {phase ?? 'Coming soon'}
              </span>
            </div>
            <h1 className="text-5xl md:text-6xl font-bold mb-4">
              {title} <span className="text-gradient">soon</span>
            </h1>
            <p className="text-lg text-foreground-muted max-w-xl">{description}</p>
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
