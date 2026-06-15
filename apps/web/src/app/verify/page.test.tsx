import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const meMock = vi.fn();
const startMutate = vi.fn();
vi.mock('@/hooks/use-me', () => ({ useMe: () => meMock() }));
vi.mock('@/hooks/use-kyc', () => ({ useStartKyc: () => ({ mutate: startMutate, isPending: false }) }));

import Page from './page';

/** #45 — the verify page lets an unverified user start KYC and reflects status. */
describe('Verify page (#45)', () => {
  beforeEach(() => {
    meMock.mockReset();
    startMutate.mockReset();
  });

  it('shows the start-verification action for an unverified user', () => {
    meMock.mockReturnValue({ data: { kycStatus: 'none' } });
    render(<Page />);
    fireEvent.click(screen.getByText(/start verification/i));
    expect(startMutate).toHaveBeenCalled();
  });

  it('shows the verified state and no start button when approved', () => {
    meMock.mockReturnValue({ data: { kycStatus: 'approved' } });
    render(<Page />);
    expect(screen.getByText(/deposits and withdrawals are unlocked/i)).toBeTruthy();
    expect(screen.queryByText(/start verification/i)).toBeNull();
  });
});
