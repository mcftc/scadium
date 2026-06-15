import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the query layer so the banner's render logic is tested in isolation —
// no real fetch, no live QueryClient.
const useStatusMock = vi.fn();
vi.mock('@/hooks/use-status', () => ({ useStatus: () => useStatusMock() }));

import { MaintenanceBanner } from './maintenance-banner';

describe('MaintenanceBanner', () => {
  beforeEach(() => useStatusMock.mockReset());

  it('renders nothing while status is loading', () => {
    useStatusMock.mockReturnValue({ data: undefined });
    const { container } = render(<MaintenanceBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when not paused', () => {
    useStatusMock.mockReturnValue({ data: { paused: false } });
    const { container } = render(<MaintenanceBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the maintenance banner when paused', () => {
    useStatusMock.mockReturnValue({ data: { paused: true } });
    render(<MaintenanceBanner />);
    expect(screen.getByText(/paused for maintenance/i)).toBeTruthy();
  });
});
