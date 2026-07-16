import { readFileSync } from 'fs';
import { join } from 'path';
import { GameType } from '@prisma/client';
import { describe, expect, it } from 'vitest';

/**
 * Affiliate coverage contract (#47): a referred player's wager only earns their
 * referrer commission if the game's settlement path calls
 * `AffiliatesService.creditReferral(tx, userId, stake)` inside its settlement
 * transaction. This used to fire for only crash + coinflip, so referred play on
 * the other 10 games silently earned referrers nothing. This source-scan guard
 * maps EVERY `GameType` to the module that must call `creditReferral` and fails
 * if any enum value is unmapped or its module dropped the call — so a newly
 * added game can't ship outside the affiliate program.
 *
 * Runs as a unit spec (no DB); cwd is `apps/api` under `vitest run src`.
 */
const REFERRAL_FILE: Record<GameType, string> = {
  // Crash credits the referrer at bet placement (service), coinflip at resolve.
  crash: 'src/games/crash/crash.service.ts',
  coinflip: 'src/games/coinflip/coinflip.service.ts',
  blackjack: 'src/games/blackjack/blackjack.engine.ts',
  lottery: 'src/games/lottery/lottery.engine.ts',
  jackpot: 'src/games/jackpot/jackpot.engine.ts',
  // Single-shot instant games share one settlement path.
  dice: 'src/games/instant/instant-settle.ts',
  limbo: 'src/games/instant/instant-settle.ts',
  wheel: 'src/games/instant/instant-settle.ts',
  plinko: 'src/games/instant/instant-settle.ts',
  // Stateful instant games share the round-based settlement path.
  mines: 'src/games/instant/stateful-round.ts',
  hilo: 'src/games/instant/stateful-round.ts',
  tower: 'src/games/instant/stateful-round.ts',
};

describe('affiliate coverage — every game credits referrers', () => {
  it('maps every GameType (no enum value left unmapped)', () => {
    expect(Object.keys(REFERRAL_FILE).sort()).toEqual(Object.values(GameType).sort());
  });

  it.each(Object.entries(REFERRAL_FILE))(
    'game "%s" credits the referrer via creditReferral() in %s',
    (_game, file) => {
      const src = readFileSync(join(process.cwd(), file), 'utf8');
      expect(src).toMatch(/\.creditReferral\(/);
    },
  );
});
