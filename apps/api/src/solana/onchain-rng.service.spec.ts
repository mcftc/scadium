import { describe, it, expect, vi } from 'vitest';
import { OnchainRngService, GAME_TYPE_INDEX } from './onchain-rng.service';
import type { ChainService } from './chain.service';

/**
 * Offline contract for the shared on-chain RNG driver. The live commit→reveal
 * path needs a deployed scadium_rng + cosigner (covered by the on-chain
 * integration once devnet is funded); these lock the parts that MUST hold
 * without a chain: the fail-safe null returns, the game-type byte map, and the
 * collision-free per-bet round id.
 */
function makeChain(over: Partial<ChainService> = {}): ChainService {
  return {
    rngEnabled: false,
    currentSlot: vi.fn(),
    rngOpenRound: vi.fn(),
    rngSettleRound: vi.fn(),
    ...over,
  } as unknown as ChainService;
}

const ROUND = {
  gameType: 'dice',
  roundId: 1n,
  serverSeed: 'deadbeef'.repeat(8),
  clientSeed: 'player-one',
  nonce: 0,
};

describe('OnchainRngService (offline contract)', () => {
  it('live mirrors ChainService.rngEnabled', () => {
    expect(new OnchainRngService(makeChain({ rngEnabled: false })).live).toBe(false);
    expect(new OnchainRngService(makeChain({ rngEnabled: true })).live).toBe(true);
  });

  it('roundEntropy returns null (off-chain) WITHOUT touching the chain when not live', async () => {
    const open = vi.fn();
    const svc = new OnchainRngService(makeChain({ rngEnabled: false, rngOpenRound: open }));
    expect(await svc.roundEntropy(ROUND)).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('roundEntropy returns null for an unmapped game type (never anchors)', async () => {
    const svc = new OnchainRngService(makeChain({ rngEnabled: true }));
    expect(await svc.roundEntropy({ ...ROUND, gameType: 'roulette' })).toBeNull();
  });

  it('roundEntropy fails SAFE to null when the open round cannot be driven', async () => {
    const svc = new OnchainRngService(
      makeChain({
        rngEnabled: true,
        currentSlot: vi.fn().mockResolvedValue(100),
        rngOpenRound: vi.fn().mockResolvedValue(null), // open failed
      }),
    );
    expect(await svc.roundEntropy(ROUND)).toBeNull();
  });

  it('maps every casino game to a UNIQUE game-type byte', () => {
    const bytes = Object.values(GAME_TYPE_INDEX);
    expect(new Set(bytes).size).toBe(bytes.length);
    // The legacy 0..4 order (crash..jackpot) must not drift — it is written into
    // each on-chain round and read by the verifier.
    expect(GAME_TYPE_INDEX.crash).toBe(0);
    expect(GAME_TYPE_INDEX.lottery).toBe(3);
    expect(GAME_TYPE_INDEX.jackpot).toBe(4);
  });

  it('nextRoundId is strictly monotonic so per-bet Round PDAs never collide', () => {
    const svc = new OnchainRngService(makeChain());
    const ids = Array.from({ length: 50 }, () => svc.nextRoundId());
    expect(new Set(ids.map(String)).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i += 1) expect(ids[i]! > ids[i - 1]!).toBe(true);
  });
});
