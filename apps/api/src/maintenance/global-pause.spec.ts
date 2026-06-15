import { describe, it, expect } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { RgService } from '../responsible-gambling/rg.service';

/**
 * The kill-switch (#56) is enforced at the single RG gate every game and the
 * deposit path route through. When paused, the pause check runs BEFORE any DB
 * access, so a stub prisma is enough — if it short-circuits correctly prisma is
 * never touched.
 */
describe('global pause kill-switch', () => {
  const prismaThatWouldThrow = {
    user: {
      findUniqueOrThrow: async () => {
        throw new Error('prisma should not be reached when paused');
      },
    },
  };

  it('blocks wagering with 503 when paused', async () => {
    const rg = new RgService(
      prismaThatWouldThrow as never,
      { isPaused: async () => true } as never,
      { realMoneyEnabled: false } as never,
    );
    await expect(rg.assertCanWager('u1', 1000n)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('blocks deposits with 503 when paused', async () => {
    const rg = new RgService(
      prismaThatWouldThrow as never,
      { isPaused: async () => true } as never,
      { realMoneyEnabled: false } as never,
    );
    await expect(rg.assertCanDeposit('u1', 1000n)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('does not block on the pause check when not paused', async () => {
    const rg = new RgService(
      prismaThatWouldThrow as never,
      { isPaused: async () => false } as never,
      { realMoneyEnabled: false } as never,
    );
    // Not paused -> falls through to prisma, which our stub makes throw a plain Error
    // (NOT ServiceUnavailable). Proves the pause gate let it through.
    await expect(rg.assertCanWager('u1', 1000n)).rejects.toThrow('prisma should not be reached');
  });
});
