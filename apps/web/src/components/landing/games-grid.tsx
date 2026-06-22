import Link from 'next/link';
import {
  TrendingUp,
  Coins,
  Spade,
  Dices,
  Rocket,
  Circle,
  Bomb,
  Gem,
  Layers,
  ArrowUpDown,
} from 'lucide-react';
import { Container } from '@/components/ui/container';
import { Card } from '@/components/ui/card';
import { ChainCopy } from '@/components/chain/chain-copy';

const games = [
  {
    id: 'crash',
    title: 'Crash',
    description: 'Ride the multiplier. Cash out before it busts.',
    icon: TrendingUp,
    href: '/crash',
    accent: 'from-[#EE86FF] to-[#9C4FE0]',
    rtp: '95%',
  },
  {
    id: 'coinflip',
    title: 'Coinflip',
    description: 'Heads or tails. 50/50 odds, 1.9× payout.',
    icon: Coins,
    href: '/coinflip',
    accent: 'from-[#C76BFF] to-[#6F5FCC]',
    rtp: '95%',
  },
  {
    id: 'blackjack',
    title: 'Blackjack',
    description: 'Beat the dealer. Up to 5 seats per table.',
    icon: Spade,
    href: '/blackjack',
    accent: 'from-[#9C4FE0] to-[#4D3D99]',
    rtp: '99.5%',
  },
  {
    id: 'dice',
    title: 'Dice',
    description: 'Roll under your target. Set your own odds.',
    icon: Dices,
    href: '/dice',
    accent: 'from-[#EE86FF] to-[#9C4FE0]',
    rtp: '99%',
  },
  {
    id: 'limbo',
    title: 'Limbo',
    description: 'Pick a multiplier. Beat the roll, win big.',
    icon: Rocket,
    href: '/limbo',
    accent: 'from-[#C76BFF] to-[#6F5FCC]',
    rtp: '99%',
  },
  {
    id: 'plinko',
    title: 'Plinko',
    description: 'Drop the ball. Bounce into a payout bin.',
    icon: Circle,
    href: '/plinko',
    accent: 'from-[#9C4FE0] to-[#4D3D99]',
    rtp: '96.5%',
  },
  {
    id: 'wheel',
    title: 'Wheel',
    description: 'Spin the wheel. Land on a multiplier.',
    icon: Bomb,
    href: '/wheel',
    accent: 'from-[#6F5FCC] to-[#4D3D99]',
    rtp: '96.5%',
  },
  {
    id: 'mines',
    title: 'Mines',
    description: 'Reveal gems, dodge the mines. Cash out any time.',
    icon: Gem,
    href: '/mines',
    accent: 'from-[#EE86FF] to-[#9C4FE0]',
    rtp: '99%',
  },
  {
    id: 'tower',
    title: 'Tower',
    description: 'Climb row by row. One trap each step.',
    icon: Layers,
    href: '/tower',
    accent: 'from-[#C76BFF] to-[#6F5FCC]',
    rtp: '99%',
  },
  {
    id: 'hilo',
    title: 'Hi-Lo',
    description: 'Higher or lower? Compound your streak.',
    icon: ArrowUpDown,
    href: '/hilo',
    accent: 'from-[#9C4FE0] to-[#4D3D99]',
    rtp: '98%',
  },
];

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
              onchain="Every bet is on-chain. Every result is verifiable. Every payout is instant."
              playMoney="Every result is provably fair and verifiable. Play-money beta."
            />
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {games.map((game) => {
            const Icon = game.icon;
            return (
              <Link key={game.id} href={game.href}>
                <Card className="group hover-glow h-full p-8 transition-all hover:border-primary-400/50 hover:shadow-glow-sm hover:-translate-y-1 cursor-pointer">
                  <div
                    className={`mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${game.accent} transition-transform duration-200 group-hover:scale-110`}
                  >
                    <Icon className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold mb-2">{game.title}</h3>
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
