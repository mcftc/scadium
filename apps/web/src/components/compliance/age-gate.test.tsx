import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const meMock = vi.fn();
const ackMutate = vi.fn();
vi.mock('@/hooks/use-me', () => ({
  useMe: () => meMock(),
  useAckAge: () => ({ mutate: ackMutate }),
}));

import { AgeGate } from './age-gate';

/**
 * #44 — the 18+ gate must block on first visit and never reappear once
 * acknowledged. Runnable equivalent of the mandated Playwright e2e (web has no
 * browser harness yet — tracked in #142).
 */
describe('AgeGate (#44)', () => {
  beforeEach(() => {
    meMock.mockReset();
    ackMutate.mockReset();
    window.localStorage.clear();
  });

  it('shows the blocking 18+ modal on first visit (no prior ack)', () => {
    meMock.mockReturnValue({ data: undefined });
    render(<AgeGate />);
    expect(screen.getByText(/must be 18\+/i)).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('hides after confirming and persists the ack to localStorage', () => {
    meMock.mockReturnValue({ data: undefined });
    const { container } = render(<AgeGate />);
    fireEvent.click(screen.getByText(/i am 18 or older/i));
    expect(window.localStorage.getItem('scadium_age_ok')).toBe('1');
    expect(container.firstChild).toBeNull();
  });

  it('does not show for a user with a server-side ack (ageConfirmedAt set)', () => {
    meMock.mockReturnValue({ data: { ageConfirmedAt: '2026-01-01T00:00:00.000Z' } });
    const { container } = render(<AgeGate />);
    expect(container.firstChild).toBeNull();
  });

  it('does not show when localStorage already holds the ack', () => {
    window.localStorage.setItem('scadium_age_ok', '1');
    meMock.mockReturnValue({ data: undefined });
    const { container } = render(<AgeGate />);
    expect(container.firstChild).toBeNull();
  });
});
