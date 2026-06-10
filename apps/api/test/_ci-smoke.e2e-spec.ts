import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootstrapApp, type BootstrapResult } from './setup';

/**
 * #39 — CI smoke: proves the api-integration job actually boots the full app
 * and executes specs (a silently-empty suite once passed CI via
 * `--passWithNoTests`; this file makes "the job ran nothing" impossible).
 */
describe('CI smoke (#39)', () => {
  let harness: BootstrapResult;

  beforeAll(async () => {
    harness = await bootstrapApp();
  });
  afterAll(async () => {
    await harness.app.close();
  });

  it('GET /health → 200', async () => {
    const res = await request(harness.server).get('/health');
    expect(res.status).toBe(200);
  });
});
