import { readFileSync } from 'fs';
import { join } from 'path';
import { GameType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

/**
 * Responsible-gambling coverage contract (#40 / #46). Every game's wager path
 * MUST route through `RgService.assertCanWager`, the single chokepoint that
 * enforces self-exclusion, cooling-off, the daily wager/loss limits, and the
 * maintenance kill-switch before any balance is debited. This source-scan guard
 * — the sibling of the SCAD Engine's `proof-of-wager/coverage.spec.ts` — maps
 * EVERY `GameType` to the module that must make the call and fails if any enum
 * value is unmapped or its module dropped the gate, so a newly added game can't
 * silently ship a wager path that bypasses self-exclusion or a player's limits.
 *
 * Runs as a unit spec (no DB); cwd is `apps/api` under `vitest run src`.
 */
const WAGER_GATE_FILE: Record<GameType, string> = {
  crash: 'src/games/crash/crash.service.ts',
  coinflip: 'src/games/coinflip/coinflip.service.ts',
  blackjack: 'src/games/blackjack/blackjack.service.ts',
  lottery: 'src/games/lottery/lottery.service.ts',
  jackpot: 'src/games/jackpot/jackpot.service.ts',
  // The single-shot stake-style instant games share one wager/settle path.
  dice: 'src/games/instant/instant-settle.ts',
  limbo: 'src/games/instant/instant-settle.ts',
  wheel: 'src/games/instant/instant-settle.ts',
  plinko: 'src/games/instant/instant-settle.ts',
  // The stateful instant games (round-based start/step/cashout) gate the wager
  // when the round is opened in the shared stateful-round helper.
  mines: 'src/games/instant/stateful-round.ts',
  hilo: 'src/games/instant/stateful-round.ts',
  tower: 'src/games/instant/stateful-round.ts',
};

describe('responsible-gambling wager-gate coverage', () => {
  it('maps every GameType (no enum value left unmapped)', () => {
    const enumValues = Object.values(GameType).sort();
    const mapped = Object.keys(WAGER_GATE_FILE).sort();
    expect(mapped).toEqual(enumValues);
  });

  it.each(Object.entries(WAGER_GATE_FILE))(
    'game "%s" gates its wager through RgService.assertCanWager in %s',
    (_game, file) => {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src).toMatch(/\.assertCanWager\(/);
    },
  );
});
