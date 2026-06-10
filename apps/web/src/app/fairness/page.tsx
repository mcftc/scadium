import { Container } from '@/components/ui/container';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { VerifierForm } from '@/components/fairness/verifier-form';
import { MySeedsPanel } from '@/components/fairness/my-seeds-panel';

export const metadata = { title: 'Provably Fair' };

export default function FairnessPage() {
  return (
    <Container>
      <div className="py-12 max-w-3xl mx-auto">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Provably <span className="text-gradient">fair</span>
            </h1>
            <p className="text-foreground-muted text-lg mb-12">
              Every round on Scadium is cryptographically verifiable. Here&apos;s how it works —
              and how you can reproduce any result yourself.
            </p>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle>How it works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-foreground-muted leading-relaxed">
                <div>
                  <span className="font-semibold text-foreground">1. Commit.</span> Before each
                  round, the server generates a random <code>serverSeed</code> and publishes{' '}
                  <code>sha256(serverSeed)</code> publicly. You can see the commitment before
                  placing your bet.
                </div>
                <div>
                  <span className="font-semibold text-foreground">2. Mix.</span> You (optionally)
                  provide a <code>clientSeed</code>. The round uses a <code>nonce</code> that
                  increments per bet.
                </div>
                <div>
                  <span className="font-semibold text-foreground">3. Reveal.</span> After the
                  round ends, we reveal the <code>serverSeed</code>. You can verify that{' '}
                  <code>sha256(serverSeed)</code> matches the earlier commitment and that the
                  result was computed from these inputs and nothing else.
                </div>
                <div>
                  <span className="font-semibold text-foreground">4. Verify.</span> Paste the
                  seeds into the verifier below — or hit{' '}
                  <span className="text-foreground">&ldquo;Verify this round&rdquo;</span> on any
                  game — and reproduce the exact result locally in your browser. Nothing is sent
                  back to the server.
                </div>
              </CardContent>
            </Card>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Crash formula</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs md:text-sm bg-background rounded-xl p-4 overflow-x-auto border border-border font-mono">
                  {`hash = HMAC-SHA256(serverSeed, \`\${clientSeed}:\${nonce}\`)
h = parseInt(hash.slice(0, 13), 16)

if (h % 20 === 0) return 1.00  // instant bust

e = 2^52
return floor((100 * e - h) / (e - h)) / 100`}
                </pre>
                <p className="mt-4 text-sm text-foreground-muted">
                  RTP 95%, house edge 5%. Identical formula used by the backend round engine and
                  the in-browser verifier — both import from{' '}
                  <code>@scadium/fair</code>.
                </p>
              </CardContent>
            </Card>

            <Card className="mb-8">
              <CardHeader>
                <CardTitle>My seeds</CardTitle>
              </CardHeader>
              <CardContent>
                <MySeedsPanel />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Verifier</CardTitle>
              </CardHeader>
              <CardContent>
                <VerifierForm />
              </CardContent>
            </Card>
          </div>
    </Container>
  );
}
