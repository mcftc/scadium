import { readFileSync } from 'fs';
import { join } from 'path';
import { GameType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

/**
 * SCAD Engine coverage contract (T9): the wager-to-earn + dividend engine only
 * covers a game if that game (a) writes Bet rows and (b) credits $SCAD via
 * `ProofOfWagerService.accrue()` at settlement. This source-scan guard maps
 * EVERY `GameType` to the settlement module that must call `accrue` and fails if
 * any enum value is unmapped or its module dropped the call — so a newly added
 * game can't silently ship outside the engine.
 *
 * Runs as a unit spec (no DB); cwd is `apps/api` under `vitest run src`.
 */
const SETTLEMENT_FILE: Record<GameType, string> = {
  crash: 'src/games/crash/crash.engine.ts',
  coinflip: 'src/games/coinflip/coinflip.service.ts',
  blackjack: 'src/games/blackjack/blackjack.engine.ts',
  lottery: 'src/games/lottery/lottery.engine.ts',
  jackpot: 'src/games/jackpot/jackpot.engine.ts',
  // The stake-style instant games share one settlement path.
  dice: 'src/games/instant/instant-settle.ts',
  limbo: 'src/games/instant/instant-settle.ts',
  wheel: 'src/games/instant/instant-settle.ts',
  plinko: 'src/games/instant/instant-settle.ts',
  // The stateful instant games (round-based start/step/cashout) share one
  // settlement path distinct from the single-shot games above.
  mines: 'src/games/instant/stateful-round.ts',
  hilo: 'src/games/instant/stateful-round.ts',
  tower: 'src/games/instant/stateful-round.ts',
};

describe('SCAD Engine game coverage', () => {
  it('maps every GameType (no enum value left unmapped)', () => {
    const enumValues = Object.values(GameType).sort();
    const mapped = Object.keys(SETTLEMENT_FILE).sort();
    expect(mapped).toEqual(enumValues);
  });

  it.each(Object.entries(SETTLEMENT_FILE))(
    'game "%s" credits $SCAD via accrue() in %s',
    (_game, file) => {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src).toMatch(/\.accrue\(/);
    },
  );
});
