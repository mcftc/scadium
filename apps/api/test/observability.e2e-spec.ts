import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { bootstrapApp, type BootstrapResult } from './setup';

/**
 * #38 — observability over the real HTTP stack: request-id correlation,
 * Prometheus metrics, and Swagger served in non-prod.
 */
describe('observability (integration)', () => {
  let harness: BootstrapResult;

  beforeAll(async () => {
    harness = await bootstrapApp();
  });
  afterAll(async () => {
    await harness.app.close();
  });

  it('assigns a generated x-request-id when none is sent', async () => {
    const res = await request(harness.server).get('/health');
    expect(res.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
  });

  it('echoes a caller-provided x-request-id (end-to-end correlation)', async () => {
    const res = await request(harness.server)
      .get('/health')
      .set('x-request-id', 'corr-test-1234');
    expect(res.headers['x-request-id']).toBe('corr-test-1234');
  });

  it('serves Prometheus metrics with HTTP counters at /metrics', async () => {
    // Generate at least one measured request first.
    await request(harness.server).get('/api/v1/crash/state').catch(() => undefined);

    const res = await request(harness.server).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('scadium_settlements_total');
    expect(res.text).toContain('process_cpu_user_seconds_total'); // default metrics
  });

  it('serves Swagger /docs outside production', async () => {
    const res = await request(harness.server).get('/docs');
    // Swagger UI responds 200 (HTML); some versions 301 to /docs/.
    expect([200, 301]).toContain(res.status);
  });
});
