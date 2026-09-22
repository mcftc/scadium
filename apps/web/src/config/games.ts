import {
  TrendingUp,
  Coins,
  Spade,
  Trophy,
  Ticket,
  Dices,
  Rocket,
  Circle,
  Bomb,
  Gem,
  Layers,
  ArrowUpDown,
  type LucideIcon,
} from 'lucide-react';
import { GAME_CATALOG, parseEnabledGames, type GameCategory, type GameId } from '@scadium/shared';

/**
 * THE game registry for the web app.
 *
 * Before this, the catalogue was hand-written in eight separate places (header,
 * bottom nav, footer, game footer, landing grid, sitemap, ticker, e2e) and they
 * had drifted apart — the landing grid omitted Jackpot and Lottery entirely, so
 * two live games were missing from the front page. Every surface now derives
 * from here, and here derives its ids/labels/routes from `@scadium/shared`, so
 * the API and the web app can never disagree about which games exist.
 *
 * Split of responsibility: `@scadium/shared` owns the DATA (ids, labels,
 * routes, category, which are enabled) because the API needs it too and must
 * stay free of React. This file owns PRESENTATION (icons, marketing copy,
 * accent gradients), which only the web app has any use for.
 */
export interface GameMeta {
  readonly id: GameId;
  readonly label: string;
  readonly href: string;
  readonly category: GameCategory;
  readonly icon: LucideIcon;
  /** One-line pitch for the landing grid. */
  readonly description: string;
  /** Tailwind gradient stops for the landing card's accent. */
  readonly accent: string;
  readonly rtp: string;
}

/** Presentation only — ids, labels and routes come from the shared catalogue. */
const PRESENTATION: Record<GameId, Omit<GameMeta, 'id' | 'label' | 'href' | 'category'>> = {
  crash: {
    icon: TrendingUp,
    description: 'Ride the multiplier. Cash out before it busts.',
    accent: 'from-[#FFCE5E] to-[#FF7A45]',
    rtp: '95%',
  },
  coinflip: {
    icon: Coins,
    description: 'Heads or tails. 50/50 odds, 1.9× payout.',
    accent: 'from-[#2DD4BF] to-[#14B8A6]',
    rtp: '95%',
  },
  jackpot: {
    icon: Trophy,
    description: 'Everyone buys in. One winner takes the whole pot.',
    accent: 'from-[#FFBE3D] to-[#F59E0B]',
    rtp: '95%',
  },
  lottery: {
    icon: Ticket,
    description: 'Pick your digits. Daily draw, rolling prize pool.',
    accent: 'from-[#A78BFA] to-[#7C3AED]',
    rtp: '95%',
  },
  blackjack: {
    icon: Spade,
    description: 'Beat the dealer. Up to 5 seats per table.',
    accent: 'from-[#60A5FA] to-[#2563EB]',
    rtp: '95%',
  },
  dice: {
    icon: Dices,
    description: 'Roll over or under. Pick your own odds.',
    accent: 'from-[#34D399] to-[#059669]',
    rtp: '95%',
  },
  limbo: {
    icon: Rocket,
    description: 'Name a multiplier. See if the roll clears it.',
    accent: 'from-[#F472B6] to-[#DB2777]',
    rtp: '95%',
  },
  wheel: {
    icon: Bomb,
    description: 'Spin the wheel. Risk tiers change the spread.',
    accent: 'from-[#FB923C] to-[#EA580C]',
    rtp: '95%',
  },
  plinko: {
    icon: Circle,
    description: 'Drop the ball. Bounce into a multiplier.',
    accent: 'from-[#38BDF8] to-[#0284C7]',
    rtp: '95%',
  },
  mines: {
    icon: Gem,
    description: 'Uncover gems, dodge mines. Cash out any time.',
    accent: 'from-[#4ADE80] to-[#16A34A]',
    rtp: '95%',
  },
  hilo: {
    icon: ArrowUpDown,
    description: 'Call the next card higher or lower.',
    accent: 'from-[#C084FC] to-[#9333EA]',
    rtp: '95%',
  },
  tower: {
    icon: Layers,
    description: 'Climb floor by floor. One wrong tile ends it.',
    accent: 'from-[#FBBF24] to-[#D97706]',
    rtp: '95%',
  },
};

/** Every game the platform has shipped, enabled or not. */
export const ALL_GAMES: readonly GameMeta[] = GAME_CATALOG.map((g) => ({
  ...g,
  ...PRESENTATION[g.id],
}));

/**
 * Which games are on the menu.
 *
 * Read at BUILD time from `NEXT_PUBLIC_ENABLED_GAMES`, which Next inlines into
 * the client bundle — so it must match the API's `ENABLED_GAMES`. Unset falls
 * back to the same shared default the API uses, so the two agree by
 * construction rather than by discipline.
 */
export const ENABLED_GAME_IDS = parseEnabledGames(process.env.NEXT_PUBLIC_ENABLED_GAMES);

/** Games currently on the menu, in catalogue order. */
export const GAMES: readonly GameMeta[] = ALL_GAMES.filter((g) =>
  (ENABLED_GAME_IDS as readonly string[]).includes(g.id),
);

export const STATEFUL_GAMES = GAMES.filter((g) => g.category === 'stateful');
export const INSTANT_GAMES = GAMES.filter((g) => g.category === 'instant');

/**
 * Is this game reachable right now?
 *
 * Used by each game route to `notFound()` when it is off — without that a
 * disabled game stays live to anyone who types the URL, however thoroughly it
 * is removed from the navigation.
 */
export function isGameVisible(id: string): boolean {
  return (ENABLED_GAME_IDS as readonly string[]).includes(id);
}

/** Catalogue entry for any game, enabled or not — for labelling historical bets. */
export function gameMeta(id: string): GameMeta | undefined {
  return ALL_GAMES.find((g) => g.id === id);
}
