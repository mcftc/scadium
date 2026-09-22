import Link from 'next/link';
import { Container } from '@/components/ui/container';
import { Card } from '@/components/ui/card';
import { ChainCopy } from '@/components/chain/chain-copy';
import { GAMES } from '@/config/games';

export function GamesGrid() {
  return (
    <section className="py-16 md:py-24">
      <Container>
        <div className="mb-12 text-center">
          <h2 className="text-3xl md:text-5xl font-bold">
            Pick your <span className="text-gradient">game</span>
          </h2>
          <p className="mt-4 text-foreground-muted max-w-xl mx-auto">
            <ChainCopy
              onchain="Playing mines $SCAD in hourly blocks. Every result is verifiable. Every payout is instant."
              playMoney="Playing mines $SCAD in hourly blocks. Every result is provably fair and verifiable. Play-money beta."
            />
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {GAMES.map((game) => {
            const Icon = game.icon;
            return (
              <Link key={game.id} href={game.href}>
                <Card className="group hover-glow h-full p-8 transition-all hover:border-primary-400/50 hover:shadow-glow-sm hover:-translate-y-1 cursor-pointer">
                  <div
                    className={`mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${game.accent} transition-transform duration-200 group-hover:scale-110`}
                  >
                    <Icon className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold mb-2">{game.label}</h3>
                  <p className="text-foreground-muted mb-4">{game.description}</p>
                  <div className="flex items-center justify-between pt-4 border-t border-border/50">
                    <span className="text-xs uppercase tracking-wider text-foreground-muted">
                      RTP
                    </span>
                    <span className="text-sm font-bold text-primary-400">{game.rtp}</span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
