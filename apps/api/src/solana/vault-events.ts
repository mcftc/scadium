import { createHash } from 'node:crypto';

/**
 * Anchor event parsing — pure, unit-testable. An event is trusted only when OUR
 * program emitted it inside the confirmed transaction's logs (`Program data:
 * <base64>`, payload `sha256("event:<Name>")[0..8] ‖ borsh(fields)`); the lottery
 * ticket verification (#H5) reads events through `programScopedEventPayloads`.
 */
export function eventDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`event:${name}`).digest().subarray(0, 8);
}

/**
 * Decode the base64 payloads of `Program data:` lines that were emitted while
 * `programId` is the ACTIVE invoke frame — never trusting a `Program data:`
 * line emitted by some OTHER program in the same transaction (#H5/#H5a). Solana
 * logs bracket each program's execution as `Program <id> invoke [depth]` …
 * `Program <id> success|failed`, and CPIs nest, so we track the invoke stack and
 * only accept a data line whose top-of-stack program equals `programId`.
 *
 * Without this scoping, a look-alike program could emit a forged event with the
 * right discriminator and be trusted as if it came from our program.
 */
export function programScopedEventPayloads(
  logMessages: readonly string[] | null | undefined,
  programId: string | null | undefined,
): Buffer[] {
  const out: Buffer[] = [];
  if (!logMessages || !programId) return out;
  const stack: string[] = [];
  for (const line of logMessages) {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]!);
      continue;
    }
    if (/^Program \S+ (?:success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (!line.startsWith('Program data: ')) continue;
    if (stack[stack.length - 1] !== programId) continue; // wrong emitter — ignore
    try {
      out.push(Buffer.from(line.slice('Program data: '.length), 'base64'));
    } catch {
      /* skip malformed base64 */
    }
  }
  return out;
}
