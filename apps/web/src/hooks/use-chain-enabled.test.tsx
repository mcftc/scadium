import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock the query layer so the hook's derivation is tested in isolation — no real
// fetch, no QueryClient timers (which otherwise keep the test process alive).
const useQueryMock = vi.fn();
vi.mock('@tanstack/react-query', () => ({ useQuery: () => useQueryMock() }));

import { useChainEnabled } from './use-chain-enabled';

describe('useChainEnabled', () => {
  beforeEach(() => useQueryMock.mockReset());

  it('defaults to false while the config request is loading', () => {
    useQueryMock.mockReturnValue({ data: undefined });
    const { result } = renderHook(() => useChainEnabled());
    expect(result.current).toBe(false);
  });

  it('yields false when /vault/config returns enabled:false', () => {
    useQueryMock.mockReturnValue({ data: { enabled: false } });
    const { result } = renderHook(() => useChainEnabled());
    expect(result.current).toBe(false);
  });

  it('yields true when /vault/config returns enabled:true', () => {
    useQueryMock.mockReturnValue({ data: { enabled: true } });
    const { result } = renderHook(() => useChainEnabled());
    expect(result.current).toBe(true);
  });

  it('defaults to false when the config request errors', () => {
    useQueryMock.mockReturnValue({ data: undefined, error: new Error('network') });
    const { result } = renderHook(() => useChainEnabled());
    expect(result.current).toBe(false);
  });
});
