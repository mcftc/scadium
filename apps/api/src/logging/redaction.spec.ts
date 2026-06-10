import { describe, it, expect } from 'vitest';
import { pino } from 'pino';
import { Writable } from 'node:stream';
import { pinoParams, REDACTED_PATHS, requestId } from './pino.config';
import type { IncomingMessage, ServerResponse } from 'node:http';

describe('pino config — redaction + request id (#38)', () => {
  it('covers the authorization header (no raw JWT can reach the sink)', () => {
    expect(REDACTED_PATHS).toContain('req.headers.authorization');
    expect(pinoParams({ NODE_ENV: 'production' }).pinoHttp).toMatchObject({
      redact: { paths: expect.arrayContaining(['req.headers.authorization']) },
    });
  });

  it('actually scrubs a bearer token from an emitted log line', async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const opts = pinoParams({ NODE_ENV: 'production' }).pinoHttp as Record<string, unknown>;
    const logger = pino({ redact: opts.redact as never }, sink);
    logger.info(
      { req: { headers: { authorization: 'Bearer super-secret-jwt', host: 'x' } } },
      'request',
    );
    expect(lines.join('')).not.toContain('super-secret-jwt');
    expect(lines.join('')).toContain('[REDACTED]');
  });

  it('reuses an incoming x-request-id and echoes it on the response', () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as ServerResponse;
    const id = requestId({ headers: { 'x-request-id': 'abc-123' } } as never, res);
    expect(id).toBe('abc-123');
    expect(headers['x-request-id']).toBe('abc-123');
  });

  it('generates an id when none arrives', () => {
    const headers: Record<string, string> = {};
    const res = { setHeader: (k: string, v: string) => (headers[k] = v) } as unknown as ServerResponse;
    const id = requestId({ headers: {} } as IncomingMessage, res);
    expect(id).toMatch(/[0-9a-f-]{36}/);
    expect(headers['x-request-id']).toBe(id);
  });

  it('uses pretty transport only outside production', () => {
    expect(pinoParams({ NODE_ENV: 'production' }).pinoHttp).not.toHaveProperty('transport.target');
    expect(
      (pinoParams({ NODE_ENV: 'development' }).pinoHttp as { transport?: { target?: string } })
        .transport?.target,
    ).toBe('pino-pretty');
  });
});
