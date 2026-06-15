import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const meMock = vi.fn();
const setLimits = vi.fn();
const coolOff = vi.fn();
const selfExclude = vi.fn();
vi.mock('@/hooks/use-me', () => ({ useMe: () => meMock() }));
vi.mock('@/hooks/use-responsible-gambling', () => ({
  useSetRgLimits: () => ({ mutate: setLimits, isPending: false }),
  useCoolOff: () => ({ mutate: coolOff, isPending: false }),
  useSelfExclude: () => ({ mutate: selfExclude, isPending: false }),
}));

import Page from './page';

const RG_EMPTY = {
  selfExcludedUntil: null,
  coolOffUntil: null,
  dailyDepositLimitLamports: null,
  dailyLossLimitLamports: null,
  dailyWagerLimitLamports: null,
};

/** #46 — the responsible-gambling page lets users set limits / cool-off / self-exclude. */
describe('Responsible Gambling page (#46)', () => {
  beforeEach(() => {
    meMock.mockReset();
    coolOff.mockReset();
  });

  it('renders the controls', () => {
    meMock.mockReturnValue({ data: { responsibleGambling: RG_EMPTY } });
    render(<Page />);
    expect(screen.getByText('Responsible Gambling')).toBeTruthy();
    expect(screen.getByText(/save limits/i)).toBeTruthy();
    expect(screen.getByText(/7 days/i)).toBeTruthy();
  });

  it('starts a cooling-off period via the mutation', () => {
    meMock.mockReturnValue({ data: { responsibleGambling: RG_EMPTY } });
    render(<Page />);
    fireEvent.click(screen.getByText(/7 days/i));
    expect(coolOff).toHaveBeenCalledWith(168);
  });
});
