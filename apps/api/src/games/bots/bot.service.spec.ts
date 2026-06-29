import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BotService } from './bot.service';
import { DEMO_BOTS, DEMO_BOT_IDS } from './demo-bots.const';

/**
 * BotService is a local-demo convenience. The contract that matters:
 *  - it is a complete no-op (no DB writes, no timers) unless DEMO_BOTS is set, so
 *    it can never run in a real deployment by accident;
 *  - when enabled it provisions every bot through the same upsert the jackpot
 *    engine used.
 */
describe('BotService', () => {
  const upsert = vi.fn().mockResolvedValue({});
  const prisma = { user: { upsert } } as never;
  const moduleRef = { get: vi.fn() } as never;

  beforeEach(() => {
    upsert.mockClear();
    delete process.env.DEMO_BOTS;
    delete process.env.JACKPOT_DEMO_BOTS;
  });

  afterEach(() => {
    delete process.env.DEMO_BOTS;
    delete process.env.JACKPOT_DEMO_BOTS;
  });

  it('does nothing on init when bots are disabled', async () => {
    const svc = new BotService(prisma, moduleRef);
    await svc.onModuleInit();
    svc.onModuleDestroy();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('provisions every demo bot when DEMO_BOTS=1', async () => {
    process.env.DEMO_BOTS = '1';
    const svc = new BotService(prisma, moduleRef);
    await svc.ensureBots();
    expect(upsert).toHaveBeenCalledTimes(DEMO_BOTS.length);
  });

  it('exposes a stable set of bot ids for leaderboard exclusion', () => {
    expect(DEMO_BOT_IDS.size).toBe(DEMO_BOTS.length);
    for (const bot of DEMO_BOTS) expect(DEMO_BOT_IDS.has(bot.id)).toBe(true);
  });
});
