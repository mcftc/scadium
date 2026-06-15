import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Drive the gate directly so the page components render against a known flag.
const enabledMock = vi.fn();
vi.mock('@/hooks/use-chain-enabled', () => ({ useChainEnabled: () => enabledMock() }));
// Footer also renders <LicensingLine> (useLicensing) — stub it so Footer mounts.
vi.mock('@/hooks/use-licensing', () => ({
  useLicensing: () => ({ licensed: false, licenseNumber: null, regulator: null, jurisdiction: null }),
}));

import { ChainCopy } from './chain-copy';
import { Footer } from '@/components/layout/footer';
import { GamesGrid } from '@/components/landing/games-grid';
import AboutPage from '@/app/about/page';

/**
 * #42 — on-chain settlement marketing copy must only render when on-chain
 * settlement is genuinely live. Runnable equivalent of the mandated Playwright
 * e2e (web has no browser e2e harness yet — tracked as a follow-up): renders the
 * real page components with the chain flag stubbed and asserts the phrases are
 * ABSENT when disabled and PRESENT when enabled. `getByText` throws when the
 * phrase is missing, so it doubles as the presence assertion.
 */
describe('on-chain copy gating (#42)', () => {
  beforeEach(() => enabledMock.mockReset());

  it('ChainCopy shows play-money copy and hides the on-chain claim when disabled', () => {
    enabledMock.mockReturnValue(false);
    render(<ChainCopy onchain="SETTLED-ON-CHAIN" playMoney="PLAY-MONEY" />);
    expect(screen.getByText('PLAY-MONEY')).toBeTruthy();
    expect(screen.queryByText('SETTLED-ON-CHAIN')).toBeNull();
  });

  it('ChainCopy shows the on-chain claim when enabled', () => {
    enabledMock.mockReturnValue(true);
    render(<ChainCopy onchain="SETTLED-ON-CHAIN" playMoney="PLAY-MONEY" />);
    expect(screen.getByText('SETTLED-ON-CHAIN')).toBeTruthy();
    expect(screen.queryByText('PLAY-MONEY')).toBeNull();
  });

  it('Footer hides "instant on-chain settlement" when chain is disabled', () => {
    enabledMock.mockReturnValue(false);
    render(<Footer />);
    expect(screen.queryByText(/instant on-chain settlement/i)).toBeNull();
  });

  it('Footer shows "instant on-chain settlement" when chain is enabled', () => {
    enabledMock.mockReturnValue(true);
    render(<Footer />);
    expect(screen.getByText(/instant on-chain settlement/i)).toBeTruthy();
  });

  it('GamesGrid hides "Every bet is on-chain" when chain is disabled', () => {
    enabledMock.mockReturnValue(false);
    render(<GamesGrid />);
    expect(screen.queryByText(/every bet is on-chain/i)).toBeNull();
  });

  it('GamesGrid shows "Every bet is on-chain" when chain is enabled', () => {
    enabledMock.mockReturnValue(true);
    render(<GamesGrid />);
    expect(screen.getByText(/every bet is on-chain/i)).toBeTruthy();
  });

  it('AboutPage hides "every payout settled on-chain" when chain is disabled', () => {
    enabledMock.mockReturnValue(false);
    render(<AboutPage />);
    expect(screen.queryByText(/every payout settled on-chain/i)).toBeNull();
  });

  it('AboutPage shows "Every payout settled on-chain" when chain is enabled', () => {
    enabledMock.mockReturnValue(true);
    render(<AboutPage />);
    expect(screen.getByText(/every payout settled on-chain/i)).toBeTruthy();
  });
});
