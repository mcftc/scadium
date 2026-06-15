import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const licensingMock = vi.fn();
vi.mock('@/hooks/use-licensing', () => ({ useLicensing: () => licensingMock() }));
// Footer also renders <ChainCopy> (useChainEnabled) — stub it so Footer mounts.
vi.mock('@/hooks/use-chain-enabled', () => ({ useChainEnabled: () => false }));

import { LicensingLine } from './licensing-line';
import { Footer } from './footer';

const UNLICENSED = { licensed: false, licenseNumber: null, regulator: null, jurisdiction: null };

/**
 * #41 — the footer must NOT assert 'Licensed & regulated' unless a real licence
 * is configured. Runnable equivalent of the mandated Playwright e2e (web has no
 * browser harness yet — tracked in #142).
 */
describe('footer licensing claim gating (#41)', () => {
  beforeEach(() => licensingMock.mockReset());

  it('omits any "licensed" claim when unlicensed, keeping only the jurisdiction notice', () => {
    licensingMock.mockReturnValue(UNLICENSED);
    render(<LicensingLine />);
    expect(screen.queryByText(/licensed/i)).toBeNull();
    expect(screen.getByText(/not available in restricted jurisdictions/i)).toBeTruthy();
  });

  it('shows the real regulator + licence number when licensed', () => {
    licensingMock.mockReturnValue({
      licensed: true,
      licenseNumber: 'GC-12345',
      regulator: 'Curacao eGaming',
      jurisdiction: 'Curacao',
    });
    render(<LicensingLine />);
    expect(screen.getByText(/GC-12345/)).toBeTruthy();
    expect(screen.getByText(/Curacao eGaming/)).toBeTruthy();
  });

  it('Footer no longer renders the false "Licensed & regulated" phrase when unlicensed', () => {
    licensingMock.mockReturnValue(UNLICENSED);
    render(<Footer />);
    expect(screen.queryByText(/licensed & regulated/i)).toBeNull();
  });
});
