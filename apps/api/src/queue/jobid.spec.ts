import { describe, it, expect } from 'vitest';
import {
  airdropDistributeJobId,
  periodForHour,
  burnJobId,
  tenMinuteBucket,
} from './queue.constants';

/**
 * Issue #11 — the airdrop jobId must be deterministic per UTC hour and use the
 * SAME period derivation the engine uses, so a timer-fire and an admin force for
 * the same hour collapse to one BullMQ job.
 */
describe('queue jobIds (issue #11)', () => {
  it('builds the airdrop distribute jobId from a period', () => {
    expect(airdropDistributeJobId('2026010113')).toBe('airdrop:distribute:2026010113');
  });

  it('periodForHour derives YYYYMMDDHH in UTC for a known epoch', () => {
    // 2026-01-01T13:37:00Z → hour bucket 2026010113
    const ms = Date.UTC(2026, 0, 1, 13, 37, 0);
    expect(periodForHour(ms)).toBe('2026010113');
    expect(airdropDistributeJobId(periodForHour(ms))).toBe('airdrop:distribute:2026010113');
  });

  it('burn jobId is stable within a 10-minute bucket and changes across buckets', () => {
    const t = Date.UTC(2026, 0, 1, 13, 5, 0);
    const sameBucket = Date.UTC(2026, 0, 1, 13, 9, 59);
    const nextBucket = Date.UTC(2026, 0, 1, 13, 10, 0);
    expect(burnJobId(tenMinuteBucket(t))).toBe(burnJobId(tenMinuteBucket(sameBucket)));
    expect(burnJobId(tenMinuteBucket(t))).not.toBe(burnJobId(tenMinuteBucket(nextBucket)));
  });
});
