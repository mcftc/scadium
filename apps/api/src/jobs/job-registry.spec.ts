import { describe, it, expect } from 'vitest';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { JOB_HANDLERS, JOB_NAMES, isJobName } from './job-registry';

describe('job-registry', () => {
  it('has a handler for every queue — a new queue cannot ship without one', () => {
    expect([...JOB_NAMES].sort()).toEqual([...Object.values(QUEUE_NAMES)].sort());
  });

  it('exposes no handler that is not a real queue', () => {
    for (const name of JOB_NAMES) {
      expect(Object.values(QUEUE_NAMES)).toContain(name);
    }
  });

  it('narrows known job names and rejects unknown ones', () => {
    expect(isJobName(QUEUE_NAMES.airdrop)).toBe(true);
    expect(isJobName(QUEUE_NAMES.vaultAccrual)).toBe(true);
    expect(isJobName('definitely-not-a-job')).toBe(false);
    expect(isJobName('constructor')).toBe(false);
    expect(isJobName('__proto__')).toBe(false);
  });

  it('every handler is a function', () => {
    for (const name of JOB_NAMES) {
      expect(typeof JOB_HANDLERS[name]).toBe('function');
    }
  });
});
