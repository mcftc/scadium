import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LEGAL_VERSION } from '@/lib/legal/versions';

const meMock = vi.fn();
const acceptMutate = vi.fn();
vi.mock('@/hooks/use-me', () => ({
  useMe: () => meMock(),
  useAcceptLegal: () => ({ mutate: acceptMutate }),
}));

import { LegalGate } from './legal-gate';
import { CookieBanner } from './cookie-banner';

/**
 * #48 — the legal-acceptance gate blocks until the current LEGAL_VERSION is
 * accepted and re-triggers on a version bump; the cookie banner appears once and
 * persists the choice. Runnable equivalent of the mandated Playwright e2e (#142).
 */
describe('LegalGate (#48)', () => {
  beforeEach(() => {
    meMock.mockReset();
    acceptMutate.mockReset();
    window.localStorage.clear();
  });

  it('shows the acceptance gate when the user has not accepted the current version', () => {
    meMock.mockReturnValue({ data: undefined });
    render(<LegalGate />);
    expect(screen.getByText(/accept our terms/i)).toBeTruthy();
  });

  it('hides after accepting and persists the current version', () => {
    meMock.mockReturnValue({ data: undefined });
    const { container } = render(<LegalGate />);
    fireEvent.click(screen.getByText(/i accept/i));
    expect(window.localStorage.getItem('scadium_legal_version')).toBe(LEGAL_VERSION);
    expect(container.firstChild).toBeNull();
  });

  it('does not show when the server-accepted version matches the current version', () => {
    meMock.mockReturnValue({ data: { acceptedLegalVersion: LEGAL_VERSION } });
    const { container } = render(<LegalGate />);
    expect(container.firstChild).toBeNull();
  });

  it('re-triggers when the accepted version is stale (version bumped)', () => {
    meMock.mockReturnValue({ data: { acceptedLegalVersion: '0.0-old' } });
    render(<LegalGate />);
    expect(screen.getByText(/accept our terms/i)).toBeTruthy();
  });
});

describe('CookieBanner (#48)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('appears on first visit (no stored consent)', () => {
    render(<CookieBanner />);
    expect(screen.getByText(/cookie policy/i)).toBeTruthy();
  });

  it('hides after a choice and persists it', () => {
    const { container } = render(<CookieBanner />);
    fireEvent.click(screen.getByText(/^reject$/i));
    expect(window.localStorage.getItem('scadium_cookie_consent')).toBe('rejected');
    expect(container.firstChild).toBeNull();
  });

  it('does not appear when a choice is already stored', () => {
    window.localStorage.setItem('scadium_cookie_consent', 'accepted');
    const { container } = render(<CookieBanner />);
    expect(container.firstChild).toBeNull();
  });
});
