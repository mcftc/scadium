import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ComplianceService } from './compliance.service';

const svc = (env: Record<string, string | undefined>) =>
  new ComplianceService({ get: (k: string) => env[k] } as unknown as ConfigService);

describe('licensing config (#49)', () => {
  it('defaults fail-closed: unlicensed + real money off', () => {
    const s = svc({});
    expect(s.licensed).toBe(false);
    expect(s.realMoneyEnabled).toBe(false);
    expect(s.publicConfig().realMoneyEnabled).toBe(false);
  });

  it('echoes realMoneyEnabled + licensed when configured', () => {
    const s = svc({
      REAL_MONEY_ENABLED: 'true',
      LICENSE_NUMBER: 'GC-1',
      LICENSE_REGULATOR: 'R',
      LICENSE_JURISDICTION: 'J',
    });
    expect(s.realMoneyEnabled).toBe(true);
    expect(s.licensed).toBe(true);
    expect(s.publicConfig()).toMatchObject({ licensed: true, realMoneyEnabled: true });
  });
});

describe('licensing doc (#49)', () => {
  it('docs/compliance/licensing.md exists and maps the key §9 controls', () => {
    const md = readFileSync(resolve(process.cwd(), '../../docs/compliance/licensing.md'), 'utf8');
    for (const term of ['REAL_MONEY_ENABLED', 'KYC', 'Geofencing', 'age gate', 'licence']) {
      expect(md).toContain(term);
    }
  });
});
