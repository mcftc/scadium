/**
 * THE deep link into the /fairness verifier. Every game's "Verify" button builds
 * its URL here, so a new verification input (the drand beacon round, a jackpot
 * round id) is added once rather than in seven hand-built query strings.
 */
export interface FairnessLinkInput {
  /** sha256(serverSeed), published before the round. */
  serverSeedHash?: string | null;
  clientSeed?: string | null;
  nonce?: number | null;
  /** Revealed server seed — only once the round has settled. */
  serverSeed?: string | null;
  /** 32-byte external entropy the result folded in (hex). */
  slotHash?: string | null;
  /** drand round the result folded in (ADR 0004). */
  beaconRound?: number | string | null;
  /** Jackpot: the settled round, so the verifier can check the winner too. */
  round?: string | null;
}

export function fairnessHref(game: string, p: FairnessLinkInput = {}): string {
  const q = new URLSearchParams({ game });
  if (p.clientSeed) q.set('clientSeed', p.clientSeed);
  if (p.nonce != null) q.set('nonce', String(p.nonce));
  if (p.serverSeedHash) q.set('commit', p.serverSeedHash);
  if (p.serverSeed) q.set('serverSeed', p.serverSeed);
  if (p.slotHash) q.set('slotHash', p.slotHash);
  if (p.beaconRound != null && p.beaconRound !== '') q.set('beaconRound', String(p.beaconRound));
  if (p.round) q.set('round', p.round);
  return `/fairness?${q.toString()}`;
}
