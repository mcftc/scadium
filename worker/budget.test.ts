// Run: node --test worker/budget.test.ts   (Node strips the types natively)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetState, chargeHeartbeat, forToday, shouldStop, utcDay } from './budget.ts';

const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const MIN = 60_000;

test('a socket-held container is charged for every minute it runs', () => {
  // The bug: an open WebSocket kept the container up with no HTTP requests,
  // and request-gap accounting charged almost nothing. Heartbeats see it running.
  let b = forToday(null, T0);
  b = { ...b, lastBeatMs: T0 }; // chain started by the visitor's first request
  for (let i = 1; i <= 60; i += 1) b = chargeHeartbeat(b, T0 + i * MIN, true, 2 * MIN);
  assert.equal(Math.round(b.usedSeconds), 3600);
  assert.equal(budgetState(b, 3600).allowed, false);
});

test('a stopped container ends the chain and is charged nothing more', () => {
  let b = { ...forToday(null, T0), lastBeatMs: T0 };
  b = chargeHeartbeat(b, T0 + MIN, true, 2 * MIN);
  b = chargeHeartbeat(b, T0 + 10 * MIN, false, 2 * MIN);
  assert.equal(b.usedSeconds, 60);
  assert.equal(b.lastBeatMs, 0);
});

test('a late beat is clamped, not billed for time nobody observed', () => {
  const b = chargeHeartbeat(
    { ...forToday(null, T0), lastBeatMs: T0 },
    T0 + 30 * MIN,
    true,
    2 * MIN,
  );
  assert.equal(b.usedSeconds, 120);
});

test('a new UTC day starts from zero', () => {
  const yesterday = {
    day: utcDay(T0 - 24 * 60 * MIN),
    usedSeconds: 3600,
    lastBeatMs: 0,
    sweepUntilMs: 0,
  };
  const b = forToday(yesterday, T0);
  assert.equal(b.day, utcDay(T0));
  assert.equal(b.usedSeconds, 0);
  assert.equal(budgetState(b, 3600).allowed, true);
});

test('over budget stops the container — but never mid cron sweep', () => {
  const spent = { ...forToday(null, T0), usedSeconds: 3600 };
  assert.equal(shouldStop(spent, 3600, T0), true);
  assert.equal(shouldStop({ ...spent, sweepUntilMs: T0 + 5 * MIN }, 3600, T0), false);
  assert.equal(shouldStop({ ...spent, usedSeconds: 10 }, 3600, T0), false);
});
