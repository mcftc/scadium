import { describe, it, expect } from 'vitest';

/**
 * Guards the shared game catalogue (`packages/shared/src/constants.ts`).
 *
 * Lives here rather than in packages/shared because that package has no test
 * runner — the repo already tests its shared maths from apps/api the same way
 * (see engine-math.spec.ts, vault-math.spec.ts).
 */
import {
  ALL_GAME_IDS,
  DEFAULT_ENABLED_GAMES,
  GAME_CATALOG,
  enabledGames,
  isGameEnabled,
  parseEnabledGames,
  type GameId,
} from '@scadium/shared';

describe('game catalogue', () => {
  it('keeps every shipped game listed, so historical bets still resolve a label', () => {
    // If a game is ever dropped from here, past Bet rows referencing it lose
    // their label and fairness link. Disabling belongs in ENABLED_GAMES instead.
    expect(ALL_GAME_IDS).toEqual([
      'crash',
      'coinflip',
      'jackpot',
      'lottery',
      'blackjack',
      'dice',
      'limbo',
      'wheel',
      'plinko',
      'mines',
      'hilo',
      'tower',
      'keno',
    ]);
  });

  it('has no duplicate ids and a route per game', () => {
    expect(new Set(ALL_GAME_IDS).size).toBe(ALL_GAME_IDS.length);
    for (const g of GAME_CATALOG) expect(g.href).toBe(`/${g.id}`);
  });

  it('defaults to the games currently in scope', () => {
    expect([...DEFAULT_ENABLED_GAMES]).toEqual(['crash', 'coinflip', 'jackpot', 'lottery', 'keno']);
    // Every default must actually exist in the catalogue.
    for (const id of DEFAULT_ENABLED_GAMES) expect(ALL_GAME_IDS).toContain(id);
  });

  describe('parseEnabledGames', () => {
    it('falls back to the default when unset, empty or whitespace', () => {
      for (const raw of [undefined, null, '', '   ']) {
        expect(parseEnabledGames(raw)).toEqual(DEFAULT_ENABLED_GAMES);
      }
    });

    it('parses a comma-separated list, trimming and lowercasing', () => {
      expect(parseEnabledGames(' Crash , DICE ')).toEqual(['crash', 'dice']);
    });

    it('ignores unknown ids rather than throwing — a typo must not take the site down', () => {
      expect(parseEnabledGames('crash,not-a-game,lottery')).toEqual(['crash', 'lottery']);
    });

    it('falls back to the default when every id is unknown, never to an empty casino', () => {
      expect(parseEnabledGames('nonsense,alsononsense')).toEqual(DEFAULT_ENABLED_GAMES);
    });
  });

  it('enabledGames returns catalogue entries in catalogue order', () => {
    const got = enabledGames(['lottery', 'crash'] as GameId[]).map((g) => g.id);
    expect(got).toEqual(['crash', 'lottery']);
  });

  it('isGameEnabled rejects unknown ids', () => {
    const on = ['crash'] as GameId[];
    expect(isGameEnabled('crash', on)).toBe(true);
    expect(isGameEnabled('blackjack', on)).toBe(false);
    expect(isGameEnabled('definitely-not-a-game', on)).toBe(false);
  });
});
