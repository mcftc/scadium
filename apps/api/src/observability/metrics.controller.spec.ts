import { describe, it, expect } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MetricsController } from './metrics.controller';

const withToken = (token?: string) =>
  new MetricsController({ get: () => token } as unknown as ConfigService);

describe('MetricsController token gate', () => {
  it('serves metrics openly when METRICS_TOKEN is unset (backward-compatible)', async () => {
    const out = await withToken(undefined).metrics(undefined, undefined);
    expect(out).toContain('process_cpu'); // default node metric always present
  });

  it('serves metrics openly when METRICS_TOKEN is blank', async () => {
    const out = await withToken('   ').metrics(undefined, undefined);
    expect(typeof out).toBe('string');
  });

  it('rejects a scrape with no credential when a token is configured', async () => {
    await expect(withToken('s3cret').metrics(undefined, undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a wrong bearer token', async () => {
    await expect(withToken('s3cret').metrics('Bearer nope', undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token of a different length (no length leak)', async () => {
    await expect(withToken('s3cret').metrics('Bearer s3', undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts the correct Bearer token', async () => {
    const out = await withToken('s3cret').metrics('Bearer s3cret', undefined);
    expect(typeof out).toBe('string');
  });

  it('accepts the correct token via ?token= (for scrapers without bearer auth)', async () => {
    const out = await withToken('s3cret').metrics(undefined, 's3cret');
    expect(typeof out).toBe('string');
  });
});
