import { Injectable, Logger } from '@nestjs/common';
import { commitServerSeed, gameParamsHash, type GameParams } from '@scadium/fair';
import { ChainService } from './chain.service';

/**
 * The shared on-chain RNG driver — ONE program (`scadium_rng`) anchors EVERY
 * game, not just the lottery/crash. Given a game round's committed seed + bound
 * params, it runs the program's commit → reveal → SlotHashes-fold flow and
 * returns the 32-byte `final_entropy` the program re-derived itself. That
 * entropy is fed to `@scadium/fair::deriveSeedContext` (as `onchainEntropy`), so
 * the multiplier / win-lose / number every game computes is anchored on-chain
 * and reproducible by anyone from the `RoundSettled` event.
 *
 * Off-chain-first hybrid (the rest of Scadium's posture): when the chain is not
 * live (`RNG_PROGRAM_ID` unset or cosigner unavailable) — OR when ANY step fails
 * — `roundEntropy` returns `null`. Callers then fall back to the deterministic
 * off-chain derivation (pass-through `deriveSeedContext`), so play stays
 * money-safe and reproducible and a chain hiccup can never block a settlement.
 *
 * Game-type byte MUST match `GAME_TYPE_INDEX` here ↔ the `game_type` written into
 * each game's on-chain round (and the verifier). Crash/coinflip/.../lottery keep
 * the legacy 0..4 order; the instant games extend it 5..11.
 */
export const GAME_TYPE_INDEX: Record<string, number> = {
  crash: 0,
  coinflip: 1,
  blackjack: 2,
  lottery: 3,
  jackpot: 4,
  dice: 5,
  limbo: 6,
  wheel: 7,
  plinko: 8,
  mines: 9,
  hilo: 10,
  tower: 11,
};

/**
 * Slots to PIN ahead of `currentSlot` as a round's `target_slot` — a future slot
 * whose hash cannot exist yet, so the cosigner cannot grind the reveal. ~3 slots
 * ≈ 1.2s at 400ms/slot (mirrors the crash/lottery entropy delta) and stays well
 * inside the ~512-slot (~3.4 min) SlotHashes retention window the reveal reads.
 */
const TARGET_SLOT_OFFSET = 3;

/** Max polls (×400ms) to wait for the pinned slot to be produced before bailing. */
const MAX_SLOT_WAIT_POLLS = 25;
const SLOT_POLL_MS = 400;

@Injectable()
export class OnchainRngService {
  private readonly logger = new Logger(OnchainRngService.name);
  /** Monotonic seq so per-bet games (no natural round id) never collide a Round PDA. */
  private seq = 0n;

  constructor(private readonly chain: ChainService) {}

  /** Whether the shared RNG program is deployed + the cosigner can drive rounds. */
  get live(): boolean {
    return this.chain.rngEnabled;
  }

  /** Numeric game-type byte for a game name, or null if unmapped (skips anchoring). */
  gameTypeIndex(gameType: string): number | null {
    return GAME_TYPE_INDEX[gameType] ?? null;
  }

  /**
   * A unique u64 round id for a per-bet game with no natural round number
   * (instant games, coinflip). `Date.now()`-based + a per-process counter so two
   * rounds of the same game opened in the same millisecond still differ, and ids
   * stay monotonic across restarts. Round PDAs are seeded by (game_type, round_id),
   * so uniqueness here is what prevents an `init` collision.
   */
  nextRoundId(): bigint {
    this.seq = (this.seq + 1n) % 1000n;
    return BigInt(Date.now()) * 1000n + this.seq;
  }

  /**
   * Drive ONE on-chain RNG round and return its 32-byte `final_entropy`, or
   * `null` in off-chain mode / on any failure (the caller then derives off-chain).
   *
   * Flow (mirrors the lottery, generalised to every game):
   *  1. `open_round` — commit `sha256(serverSeed)`, the 32-byte client seed and
   *     `gameParamsHash(params)`, and PIN `target_slot = currentSlot + OFFSET`.
   *  2. wait until the chain has produced `target_slot` (its hash now exists).
   *  3. `settle_round` — reveal the seed; the PROGRAM re-derives `final_entropy`
   *     from the pinned slot's hash and we read it back (chain is the truth).
   *
   * NOTE (rent): each round opens a fresh Round PDA the cosigner rent-funds
   * (~0.002 SOL) and the current program has no `close_round`, so high-volume
   * per-bet anchoring accrues rent — a documented follow-up (add `close_round` to
   * reclaim it). Fine for the devnet demo.
   */
  async roundEntropy(params: {
    gameType: string;
    /** Unique per (gameType). Use a natural round number, or `nextRoundId()`. */
    roundId: bigint;
    serverSeed: string; // 64 hex chars (utf8 bytes on-chain)
    clientSeed: string; // utf8, zero-padded to 32 bytes on-chain
    nonce: number;
    gameParams?: GameParams;
  }): Promise<Uint8Array | null> {
    if (!this.live) return null;
    const gt = this.gameTypeIndex(params.gameType);
    if (gt === null) return null;

    try {
      const slot = await this.chain.currentSlot();
      if (slot === null) return null;
      const targetSlot = BigInt(slot + TARGET_SLOT_OFFSET);

      const opened = await this.chain.rngOpenRound({
        gameType: gt,
        roundId: params.roundId,
        serverSeedHashHex: commitServerSeed(params.serverSeed),
        clientSeedHex: params.clientSeed,
        gameParamsHashHex: gameParamsHash(params.gameParams ?? {}).toString('hex'),
        nonce: params.nonce,
        targetSlot,
      });
      if (!opened) return null;

      if (!(await this.waitForSlot(targetSlot))) {
        this.logger.warn(
          `rng round ${params.gameType}/${params.roundId}: pinned slot ${targetSlot} not produced in time — falling back off-chain`,
        );
        return null;
      }

      const settled = await this.chain.rngSettleRound({
        gameType: gt,
        roundId: params.roundId,
        serverSeedHex: params.serverSeed,
      });
      if (!settled) return null;

      return Uint8Array.from(Buffer.from(settled.entropyHex, 'hex'));
    } catch (e) {
      // Fail SAFE: never let a chain error block a settlement — derive off-chain.
      this.logger.error(
        `roundEntropy ${params.gameType}/${params.roundId} failed (deriving off-chain): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return null;
    }
  }

  /** Poll until the chain has produced `target` (so its SlotHashes entry exists). */
  private async waitForSlot(target: bigint): Promise<boolean> {
    for (let i = 0; i < MAX_SLOT_WAIT_POLLS; i += 1) {
      const s = await this.chain.currentSlot();
      if (s !== null && BigInt(s) >= target) return true;
      await new Promise((r) => setTimeout(r, SLOT_POLL_MS));
    }
    return false;
  }
}
