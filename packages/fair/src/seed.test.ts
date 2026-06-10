import { describe, it, expect } from 'vitest';
import { generateServerSeed, generateClientSeed, commitServerSeed } from './seed';
import { sha256 } from './hash';

/**
 * Issue #18 — server-seed commitment must be a deterministic sha256 of the seed,
 * so revealing the preimage after a round/rotation proves it was pre-committed
 * (the player checks `commitServerSeed(revealed) === the published hash`).
 */
describe('seed commitment (issue #18)', () => {
  it('commitServerSeed is the sha256 of the seed and is deterministic', () => {
    const s = generateServerSeed();
    expect(commitServerSeed(s)).toBe(sha256(s));
    expect(commitServerSeed(s)).toBe(commitServerSeed(s));
  });

  it('a revealed prior seed reproduces its previously-published commitment', () => {
    // Simulate rotation: publish hash now, reveal seed later.
    const prior = generateServerSeed();
    const publishedHash = commitServerSeed(prior);
    // ...later, on reveal:
    expect(commitServerSeed(prior)).toBe(publishedHash);
  });

  it('server seeds are 64 hex chars (256 bits); client seeds are non-empty', () => {
    expect(generateServerSeed()).toMatch(/^[0-9a-f]{64}$/);
    expect(generateClientSeed().length).toBeGreaterThan(0);
  });
});
