import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Drive the gate directly so the page components render against a known flag.
const enabledMock = vi.fn();
vi.mock('@/hooks/use-chain-enabled', () => ({ useChainEnabled: () => enabledMock() }));
// Footer also renders <LicensingLine> (useLicensing) — stub it so Footer mounts.
vi.mock('@/hooks/use-licensing', () => ({
  useLicensing: () => ({
    licensed: false,
    licenseNumber: null,
    regulator: null,
    jurisdiction: null,
  }),
}));

import { ChainCopy } from './chain-copy';
import { Footer } from '@/components/layout/footer';
import { GamesGrid } from '@/components/landing/games-grid';
import AboutPage from '@/app/about/page';
import FaqPage from '@/app/faq/page';
import { FAQSection } from '@/components/landing/faq-section';
import { HeroSection } from '@/components/landing/hero-section';
import { FeaturesSection } from '@/components/landing/features-section';

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

  // #142 — residual vault-custody claims must be gated too.

  it('AboutPage hides "Funds live in on-chain vaults you control" when disabled', () => {
    enabledMock.mockReturnValue(false);
    render(<AboutPage />);
    expect(screen.queryByText(/funds live in on-chain vaults you control/i)).toBeNull();
  });

  it('AboutPage shows the vault-custody claim when enabled', () => {
    enabledMock.mockReturnValue(true);
    render(<AboutPage />);
    expect(screen.getByText(/funds live in on-chain vaults you control/i)).toBeTruthy();
  });

  it('FaqPage hides the "on-chain vault PDA" deposit claim when disabled', () => {
    enabledMock.mockReturnValue(false);
    render(<FaqPage />);
    expect(screen.queryByText(/on-chain vault pda/i)).toBeNull();
  });

  it('FaqPage shows the on-chain deposit claim when enabled', () => {
    enabledMock.mockReturnValue(true);
    render(<FaqPage />);
    expect(screen.getByText(/on-chain vault pda/i)).toBeTruthy();
  });

  it('FAQSection hides "your SOL never leaves your control" when disabled', () => {
    enabledMock.mockReturnValue(false);
    render(<FAQSection />);
    expect(screen.queryByText(/your SOL never leaves your control/i)).toBeNull();
  });

  it('FAQSection shows the non-custodial SOL claim when enabled', () => {
    enabledMock.mockReturnValue(true);
    render(<FAQSection />);
    expect(screen.getByText(/your SOL never leaves your control/i)).toBeTruthy();
  });

  it('HeroSection hides "your SOL stays in your control" when disabled', () => {
    enabledMock.mockReturnValue(false);
    render(<HeroSection />);
    expect(screen.queryByText(/your SOL stays in your control/i)).toBeNull();
  });

  it('HeroSection shows the on-chain custody claim when enabled', () => {
    enabledMock.mockReturnValue(true);
    render(<HeroSection />);
    expect(screen.getByText(/your SOL stays in your control/i)).toBeTruthy();
  });

  it('FeaturesSection hides "payouts land directly in your address" when disabled', () => {
    enabledMock.mockReturnValue(false);
    render(<FeaturesSection />);
    expect(screen.queryByText(/payouts land directly in your address/i)).toBeNull();
  });

  it('FeaturesSection shows the wallet-custody claim when enabled', () => {
    enabledMock.mockReturnValue(true);
    render(<FeaturesSection />);
    expect(screen.getByText(/payouts land directly in your address/i)).toBeTruthy();
  });
});
