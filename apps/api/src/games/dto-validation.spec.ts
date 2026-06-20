import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { PlayDiceDto } from './dice/dto/play-dice.dto';
import { EnterJackpotDto } from './jackpot/dto/enter-jackpot.dto';
import { PlaceTableBetDto } from './blackjack/blackjack.controller';

/**
 * Money-amount DTO validation boundary (issue #217). Every lamport/$SCAD amount
 * field must accept ONLY a strictly-positive integer string via
 * `@Matches(/^[1-9]\d*$/)` (+ `@MaxLength(20)`) — no leading zeros, signs,
 * decimals, scientific notation, or oversized values. Blackjack SIDE bets are
 * the sole exception: they are optional and legitimately accept "0" (no bet).
 *
 * Each field is `BigInt(dto.x)` downstream, so these regexes are the edge guard
 * that keeps an out-of-range / malformed amount from ever reaching the service.
 * Runs as a unit spec (no DB) under `vitest run src`.
 */

const ERR = (errors: { property: string }[], prop: string) =>
  errors.some((e) => e.property === prop);

const REJECTED = ['0', '-1', '01', '1.5', '1e9', '9'.repeat(21)];

describe('money-amount DTO validators (#217)', () => {
  describe('PlayDiceDto.amountLamports', () => {
    it('accepts a valid positive integer string', async () => {
      const errors = await validate(
        plainToInstance(PlayDiceDto, { amountLamports: '100000000', target: 50 }),
      );
      expect(errors).toHaveLength(0);
    });

    for (const bad of REJECTED) {
      it(`rejects ${JSON.stringify(bad)}`, async () => {
        const errors = await validate(
          plainToInstance(PlayDiceDto, { amountLamports: bad, target: 50 }),
        );
        expect(ERR(errors, 'amountLamports')).toBe(true);
      });
    }
  });

  describe('EnterJackpotDto.amountLamports', () => {
    it('accepts a valid positive integer string', async () => {
      const errors = await validate(
        plainToInstance(EnterJackpotDto, { amountLamports: '250000000' }),
      );
      expect(errors).toHaveLength(0);
    });

    for (const bad of REJECTED) {
      it(`rejects ${JSON.stringify(bad)}`, async () => {
        const errors = await validate(plainToInstance(EnterJackpotDto, { amountLamports: bad }));
        expect(ERR(errors, 'amountLamports')).toBe(true);
      });
    }
  });

  describe('PlaceTableBetDto (blackjack)', () => {
    it('accepts a positive main bet with no side bets', async () => {
      const errors = await validate(
        plainToInstance(PlaceTableBetDto, { mainLamports: '100000000' }),
      );
      expect(errors).toHaveLength(0);
    });

    it('rejects a "0" main bet (a main bet must be positive)', async () => {
      const errors = await validate(plainToInstance(PlaceTableBetDto, { mainLamports: '0' }));
      expect(ERR(errors, 'mainLamports')).toBe(true);
    });

    for (const bad of REJECTED) {
      it(`rejects mainLamports ${JSON.stringify(bad)}`, async () => {
        const errors = await validate(plainToInstance(PlaceTableBetDto, { mainLamports: bad }));
        expect(ERR(errors, 'mainLamports')).toBe(true);
      });
    }

    it('accepts "0" for a SIDE bet (no bet placed)', async () => {
      const errors = await validate(
        plainToInstance(PlaceTableBetDto, { mainLamports: '100000000', side21p3Lamports: '0' }),
      );
      expect(errors).toHaveLength(0);
    });

    it('accepts a positive SIDE bet', async () => {
      const errors = await validate(
        plainToInstance(PlaceTableBetDto, {
          mainLamports: '100000000',
          side21p3Lamports: '5000000',
        }),
      );
      expect(errors).toHaveLength(0);
    });

    for (const bad of ['-1', '1.5', '01', '1e9']) {
      it(`rejects SIDE bet ${JSON.stringify(bad)}`, async () => {
        const errors = await validate(
          plainToInstance(PlaceTableBetDto, {
            mainLamports: '100000000',
            sidePerfectPairsLamports: bad,
          }),
        );
        expect(ERR(errors, 'sidePerfectPairsLamports')).toBe(true);
      });
    }
  });
});
