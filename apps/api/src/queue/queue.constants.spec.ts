import { describe, it, expect } from 'vitest';
import {
  periodForHour,
  lastCompletedHourPeriod,
  dayPeriod,
  lastCompletedDayPeriod,
  dayPeriodStartMs,
} from './queue.constants';

/**
 * H11 — hourly settle jobs (airdrop pool, staker dividends, block mining, vault
 * accrual) must target the last COMPLETED clock hour, not the in-progress one.
 * The worker fires them every ~5 minutes, so `periodForHour(now)` would settle
 * only the first minutes of the current hour (and, for the airdrop, reject the
 * rest of the hour's tips). `lastCompletedHourPeriod` is the shared fix.
 */
describe('lastCompletedHourPeriod (H11)', () => {
  const at = (iso: string) => Date.parse(iso);

  it('mid-hour returns the PREVIOUS hour, never the in-progress one', () => {
    // 10:05 UTC → the 09:00 hour has just completed.
    expect(lastCompletedHourPeriod(at('2026-07-16T10:05:00Z'))).toBe('2026071609');
    // …and it is NOT the in-progress hour that periodForHour(now) would pick.
    expect(lastCompletedHourPeriod(at('2026-07-16T10:05:00Z'))).not.toBe(
      periodForHour(at('2026-07-16T10:05:00Z')),
    );
  });

  it('late in the hour still returns the same previous hour (whole hour settled once)', () => {
    expect(lastCompletedHourPeriod(at('2026-07-16T10:59:59Z'))).toBe('2026071609');
    expect(lastCompletedHourPeriod(at('2026-07-16T10:01:00Z'))).toBe('2026071609');
  });

  it('exactly on the boundary returns the hour that just ended', () => {
    expect(lastCompletedHourPeriod(at('2026-07-16T10:00:00Z'))).toBe('2026071609');
  });

  it('rolls the day/month/year backward correctly', () => {
    expect(lastCompletedHourPeriod(at('2026-07-16T00:30:00Z'))).toBe('2026071523'); // prev day 23:00
    expect(lastCompletedHourPeriod(at('2026-01-01T00:10:00Z'))).toBe('2025123123'); // prev year
  });
});

/**
 * The daily-race settle targets the last COMPLETED UTC day, and parses that day
 * key back to its UTC-midnight window start — a timezone/off-by-one bug here
 * would pay on an incomplete or shifted day of Bet data.
 */
describe('daily-race period helpers (#roadmap-5)', () => {
  const at = (iso: string) => Date.parse(iso);

  it('dayPeriod is the UTC YYYYMMDD of the containing day', () => {
    expect(dayPeriod(at('2026-07-16T10:00:00Z'))).toBe('20260716');
    expect(dayPeriod(at('2026-07-16T23:59:59Z'))).toBe('20260716');
    expect(dayPeriod(at('2026-07-16T00:00:00Z'))).toBe('20260716');
  });

  it('lastCompletedDayPeriod returns the PREVIOUS day, never the in-progress one', () => {
    expect(lastCompletedDayPeriod(at('2026-07-16T10:00:00Z'))).toBe('20260715');
    // Exactly at midnight → the day that just ended.
    expect(lastCompletedDayPeriod(at('2026-07-16T00:00:00Z'))).toBe('20260715');
    // Rolls month/year backward.
    expect(lastCompletedDayPeriod(at('2026-03-01T00:30:00Z'))).toBe('20260228');
    expect(lastCompletedDayPeriod(at('2026-01-01T00:10:00Z'))).toBe('20251231');
  });

  it('dayPeriodStartMs round-trips to UTC midnight of that day', () => {
    expect(new Date(dayPeriodStartMs('20260115')).toISOString()).toBe('2026-01-15T00:00:00.000Z');
    expect(dayPeriod(dayPeriodStartMs('20260115'))).toBe('20260115');
  });
});
