import { describe, it, expect } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { ComplianceService } from './compliance.service';

const svc = (env: Record<string, string | undefined>) =>
  new ComplianceService({ get: (k: string) => env[k] } as unknown as ConfigService);

describe('ComplianceService — licensing gate (#41)', () => {
  it('licensed=false and details null when no env is set (fail-closed)', () => {
    const s = svc({});
    expect(s.licensed).toBe(false);
    expect(s.publicConfig()).toEqual({
      licensed: false,
      licenseNumber: null,
      regulator: null,
      jurisdiction: null,
    });
  });

  it('licensed=false when only some fields are set', () => {
    expect(svc({ LICENSE_NUMBER: 'GC-1', LICENSE_REGULATOR: 'Curacao eGaming' }).licensed).toBe(
      false,
    );
  });

  it('treats whitespace-only values as empty (fail-closed)', () => {
    expect(
      svc({ LICENSE_NUMBER: '  ', LICENSE_REGULATOR: ' ', LICENSE_JURISDICTION: ' ' }).licensed,
    ).toBe(false);
  });

  it('licensed=true and echoes values when all three are set', () => {
    const s = svc({
      LICENSE_NUMBER: 'GC-12345',
      LICENSE_REGULATOR: 'Curacao eGaming',
      LICENSE_JURISDICTION: 'Curacao',
    });
    expect(s.licensed).toBe(true);
    expect(s.publicConfig()).toEqual({
      licensed: true,
      licenseNumber: 'GC-12345',
      regulator: 'Curacao eGaming',
      jurisdiction: 'Curacao',
    });
  });
});
