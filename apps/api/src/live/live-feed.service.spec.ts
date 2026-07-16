import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LiveFeedService } from './live-feed.service';
import { LiveFeedGateway } from './live-feed.gateway';
import type { PrismaService } from '../prisma/prisma.service';

const flush = () => new Promise((r) => setTimeout(r, 0));

function makePrisma(user: { username: string | null; avatarUrl: string | null; walletAddress: string } | null) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue(user) },
    bet: { findMany: vi.fn() },
  } as unknown as PrismaService & {
    user: { findUnique: ReturnType<typeof vi.fn> };
    bet: { findMany: ReturnType<typeof vi.fn> };
  };
}

const baseInput = {
  userId: 'u1',
  betId: 'b1',
  gameType: 'dice',
  amountLamports: 1_000_000_000n,
  payoutLamports: 1_980_000_000n,
  multiplier: 1.98,
  won: true,
};

describe('LiveFeedService', () => {
  let gateway: LiveFeedGateway;
  let broadcast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    broadcast = vi.fn();
    gateway = { broadcast } as unknown as LiveFeedGateway;
  });

  it('resolves a username display and broadcasts a PII-safe event', async () => {
    const prisma = makePrisma({ username: 'alice', avatarUrl: 'a.png', walletAddress: 'WALLETyyyyyyyy' });
    const svc = new LiveFeedService(prisma, gateway);

    svc.publishSettledBet(baseInput);
    await flush();

    expect(broadcast).toHaveBeenCalledTimes(1);
    const evt = broadcast.mock.calls[0]![0];
    expect(evt).toMatchObject({
      id: 'b1',
      gameType: 'dice',
      player: 'alice',
      avatarUrl: 'a.png',
      amountLamports: '1000000000',
      payoutLamports: '1980000000',
      multiplier: 1.98,
      won: true,
    });
    // Never leak the full wallet or the userId.
    expect(JSON.stringify(evt)).not.toContain('WALLETyyyyyyyy');
    expect(JSON.stringify(evt)).not.toContain('u1');
    expect(typeof evt.at).toBe('number');
  });

  it('falls back to a shortened wallet when there is no username', async () => {
    const prisma = makePrisma({ username: null, avatarUrl: null, walletAddress: 'ABCD12345678WXYZ' });
    const svc = new LiveFeedService(prisma, gateway);

    svc.publishSettledBet(baseInput);
    await flush();

    expect(broadcast.mock.calls[0]![0].player).toBe('ABCD…WXYZ');
  });

  it('caches the display so repeat bets from one user do not re-query', async () => {
    const prisma = makePrisma({ username: 'bob', avatarUrl: null, walletAddress: 'w' });
    const svc = new LiveFeedService(prisma, gateway);

    svc.publishSettledBet(baseInput);
    await flush();
    svc.publishSettledBet({ ...baseInput, betId: 'b2' });
    await flush();

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('never throws from publish even if the display lookup fails', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockRejectedValue(new Error('db down')) },
      bet: { findMany: vi.fn() },
    } as unknown as PrismaService;
    const svc = new LiveFeedService(prisma, gateway);

    expect(() => svc.publishSettledBet(baseInput)).not.toThrow();
    await flush();
    expect(broadcast).not.toHaveBeenCalled(); // failed silently, no broadcast
  });

  it('recentBets maps Bet+User rows to PII-safe events', async () => {
    const prisma = makePrisma(null);
    (prisma.bet.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'x',
        gameType: 'crash',
        amountLamports: 500n,
        payoutLamports: 0n,
        multiplier: null,
        status: 'lost',
        createdAt: new Date(1_700_000_000_000),
        user: { username: null, avatarUrl: null, walletAddress: 'ZZZZ00001111QQQQ' },
      },
    ]);
    const svc = new LiveFeedService(prisma, gateway);

    const out = await svc.recentBets(10);
    expect(out).toEqual([
      {
        id: 'x',
        gameType: 'crash',
        player: 'ZZZZ…QQQQ',
        avatarUrl: null,
        amountLamports: '500',
        payoutLamports: '0',
        multiplier: null,
        won: false,
        at: 1_700_000_000_000,
      },
    ]);
    expect(prisma.bet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: { in: ['won', 'lost'] } }, take: 10 }),
    );
  });

  it('recentBets(onlyWins) filters to wins', async () => {
    const prisma = makePrisma(null);
    (prisma.bet.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const svc = new LiveFeedService(prisma, gateway);

    await svc.recentBets(5, true);
    expect(prisma.bet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'won' }, take: 5 }),
    );
  });
});
