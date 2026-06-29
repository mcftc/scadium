import { createHash } from 'node:crypto';
import { HOUSE_EDGE, WHEEL_SEGMENTS, MINES, TOWER, type GameType } from '@scadium/shared';
import { padClientSeed32, syntheticSlotHash } from './lottery';
import { crashPoint } from './crash';
import { coinflipResult } from './coinflip';
import { diceRoll } from './dice';
import { limboResult } from './limbo';
import { wheelSpin } from './wheel';
import { plinkoDrop } from './plinko';
import { mineField } from './mines';
import { hiloSequence } from './hilo';
import { towerTraps } from './tower';
import { jackpotWinningTicket } from './jackpot';

/**
 * Unified, on-chain-anchored outcome derivation.
 *
 * Every game's outcome is computed from ONE source: a combination of
 *  - on-chain entropy from the shared `scadium_rng` program (a committed→revealed
 *    seed folded with a Solana SlotHashes entry that did not exist at commit),
 *  - the server seed (committed before play),
 *  - the player's client seed + nonce, and
 *  - the per-round game dynamics (max-win/auto-cashout/max-multiplier caps) bound
 *    via `gameParamsHash`.
 * This makes the next round impossible to predict and reproducible on-chain.
 *
 * Canonical fold (byte-identical to `programs/scadium_rng::derive_entropy` and
 * `apps/web/src/lib/fair-browser.ts`):
 *
 *   final_entropy = sha256(
 *     utf8(serverSeedHex64) || slotHash[32] || clientSeed32 || u32le(nonce) || gameParamsHash[32]
 *   )
 *
 * The folded entropy then keys the existing per-game HMAC stream, so a result is
 * identical whether reproduced from the on-chain `RoundSettled` event or via
 * `@scadium/fair`.
 *
 * Backward compatibility (pre-deploy, play-money): when no `onchainEntropy` is
 * supplied the derivation is a PASS-THROUGH — it returns the original
 * (serverSeed, clientSeed, nonce) and every per-game function behaves exactly as
 * it does today. On-chain anchoring activates the moment `scadium_rng` is live
 * and the API threads the round entropy through.
 */

export type GameParamValue = number | string | boolean;
export type GameParams = Record<string, GameParamValue>;

export interface DeriveInput {
  /** 32-byte `RoundSettled.entropy` from `scadium_rng`. Absent = off-chain mode. */
  onchainEntropy?: Uint8Array | null;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  /** Round dynamics (maxWin, autoCashout, maxMultiplier, target, rows, mines…). */
  gameParams?: GameParams;
}

export interface SeedContext {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

/**
 * Canonical 32-byte hash of the per-round game dynamics. Keys are sorted and
 * each `key=value` line joined with `\n` so the encoding is stable across the
 * API and the browser verifier. The result is the opaque `game_params_hash`
 * passed to `scadium_rng::open_round`. An empty/omitted map hashes the empty
 * string (sha256('')).
 */
export function gameParamsHash(params: GameParams = {}): Buffer {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest();
}

/**
 * The 32-byte folded entropy. `slotHash` is the on-chain SlotHashes entry (or a
 * deterministic synthetic stand-in off-chain). Mirrors `lotteryFinalEntropy` but
 * with a trailing `gameParamsHash` block so per-round dynamics are bound in.
 */
export function rngEntropy(
  serverSeed: string,
  clientSeed32: Uint8Array,
  slotHash: Uint8Array,
  nonce: number,
  paramsHash: Uint8Array,
): Buffer {
  if (clientSeed32.length !== 32) throw new Error('clientSeed32 must be exactly 32 bytes');
  if (slotHash.length !== 32) throw new Error('slotHash must be exactly 32 bytes');
  if (paramsHash.length !== 32) throw new Error('paramsHash must be exactly 32 bytes');
  const nonceLe = Buffer.alloc(4);
  nonceLe.writeUInt32LE(nonce >>> 0);
  return createHash('sha256')
    .update(Buffer.from(serverSeed, 'utf8'))
    .update(slotHash)
    .update(clientSeed32)
    .update(nonceLe)
    .update(paramsHash)
    .digest();
}

/**
 * Resolve the effective seed context that keys the per-game stream. Off-chain
 * (no `onchainEntropy`) this is a pass-through; on-chain it folds the round
 * entropy + game params into the server seed so the outcome is anchored and
 * reproducible from the chain event.
 */
export function deriveSeedContext(input: DeriveInput): SeedContext {
  if (!input.onchainEntropy) {
    return { serverSeed: input.serverSeed, clientSeed: input.clientSeed, nonce: input.nonce };
  }
  const folded = rngEntropy(
    input.serverSeed,
    padClientSeed32(input.clientSeed),
    input.onchainEntropy,
    input.nonce,
    gameParamsHash(input.gameParams),
  ).toString('hex');
  return { serverSeed: folded, clientSeed: input.clientSeed, nonce: input.nonce };
}

/**
 * The synthetic slot hash used in off-chain mode IF a caller wants the folded
 * derivation without a live chain (e.g. to display a deterministic "entropy"):
 * sha256(serverSeed || ':' || clientSeed) — the exact lottery/crash convention.
 */
export function offchainSlotHash(serverSeed: string, clientSeed: string): Buffer {
  return syntheticSlotHash(serverSeed, clientSeed);
}

/**
 * Route a folded/passthrough seed context to the existing per-game pure
 * function. Extra inputs (segments, rows, mines, totalLamports…) come from
 * `gameParams`. This is the single entry point the verifier and services use, so
 * every game derives from the same source.
 */
export function deriveOutcome(
  gameType: GameType | string,
  input: DeriveInput,
): Record<string, unknown> {
  const { serverSeed: s, clientSeed: c, nonce: n } = deriveSeedContext(input);
  const p = input.gameParams ?? {};
  switch (gameType) {
    case 'crash':
      return { multiplier: crashPoint(s, c, n) };
    case 'coinflip':
      return { side: coinflipResult(s, c, n) };
    case 'dice':
      return { roll: diceRoll(s, c, n) };
    case 'limbo':
      return { result: limboResult(s, c, n, HOUSE_EDGE) };
    case 'wheel':
      return { index: wheelSpin(s, c, n, WHEEL_SEGMENTS) };
    case 'plinko':
      return plinkoDrop(s, c, n, Number(p.rows ?? 16)) as unknown as Record<string, unknown>;
    case 'mines':
      return { field: mineField(s, c, n, MINES.CELLS, Number(p.mines ?? 3)) };
    case 'hilo':
      return { sequence: hiloSequence(s, c, n, Number(p.length ?? 26)) };
    case 'tower':
      return { traps: towerTraps(s, c, n, TOWER.ROWS, TOWER.COLUMNS, TOWER.SAFE_PER_ROW) };
    case 'jackpot':
      return {
        ticket: jackpotWinningTicket(s, c, n, BigInt(String(p.totalLamports ?? '1'))).toString(),
      };
    default:
      throw new Error(`deriveOutcome: unsupported gameType "${gameType}"`);
  }
}
