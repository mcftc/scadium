/**
 * Demo-only bot players (enabled by `DEMO_BOTS=1`, or the legacy
 * `JACKPOT_DEMO_BOTS=1` umbrella). Each is a real `User` row with a huge play
 * balance that places bets through the SAME money-safe service entrypoints as a
 * human, so settlement, fairness and the ledger are untouched and bots never
 * skew the provably-fair outcome. They exist so a local/solo demo always has
 * live activity (and the multiplayer jackpot actually draws).
 *
 * NEVER enable in a funded/mainnet config — these rows have no wallet custody
 * and bypass nothing except the need for a human to be online.
 */
export const DEMO_BOTS = [
  {
    id: 'd0d0d0d0-0000-4000-8000-000000000001',
    username: 'DegenBot',
    wallet: 'DemoBot1degenking1111111111111111111111111',
  },
  {
    id: 'd0d0d0d0-0000-4000-8000-000000000002',
    username: 'MoonBot',
    wallet: 'DemoBot2moonshot2222222222222222222222222',
  },
  {
    id: 'd0d0d0d0-0000-4000-8000-000000000003',
    username: 'LuckyBot',
    wallet: 'DemoBot3lucky33333333333333333333333333333',
  },
  {
    id: 'd0d0d0d0-0000-4000-8000-000000000004',
    username: 'BonkBot',
    wallet: 'DemoBot4bonk44444444444444444444444444444',
  },
  {
    id: 'd0d0d0d0-0000-4000-8000-000000000005',
    username: 'ApeBot',
    wallet: 'DemoBot5ape555555555555555555555555555555',
  },
] as const;

export type DemoBot = (typeof DEMO_BOTS)[number];

/** 100k SOL of play money per bot. */
export const DEMO_BOT_BALANCE = BigInt('100000000000000');

/** Set of bot user IDs — use to exclude bots from leaderboards/affiliate. */
export const DEMO_BOT_IDS: ReadonlySet<string> = new Set(DEMO_BOTS.map((b) => b.id));

/** True when bots are enabled (umbrella `DEMO_BOTS`, or legacy jackpot flag). */
export function demoBotsEnabled(): boolean {
  return process.env.DEMO_BOTS === '1' || process.env.JACKPOT_DEMO_BOTS === '1';
}
