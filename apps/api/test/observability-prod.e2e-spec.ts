import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Force production mode BEFORE bootstrapApp() lazily imports AppModule — the
// Swagger gate and pino transport both read NODE_ENV at setup time. The forks
// pool isolates this process from every other spec file.
process.env.NODE_ENV = 'production';

import { bootstrapApp, type BootstrapResult } from './setup';

/**
 * #38 — in production the API-surface documentation must NOT be exposed:
 * GET /docs is 404 unless DOCS_ENABLED=true is explicitly set.
 */
describe('observability in production mode (integration)', () => {
  let harness: BootstrapResult;

  beforeAll(async () => {
    harness = await bootstrapApp();
  });
  afterAll(async () => {
    await harness.app.close();
  });

  it('does NOT serve /docs in production', async () => {
    const res = await request(harness.server).get('/docs');
    expect(res.status).toBe(404);
  });

  it('still serves /metrics and request-id correlation in production', async () => {
    const metrics = await request(harness.server).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('http_requests_total');

    const res = await request(harness.server).get('/health');
    expect(res.headers['x-request-id']).toBeDefined();
  });
});
