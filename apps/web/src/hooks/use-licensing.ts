'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export interface LicensingConfig {
  licensed: boolean;
  licenseNumber: string | null;
  regulator: string | null;
  jurisdiction: string | null;
}

const UNLICENSED: LicensingConfig = {
  licensed: false,
  licenseNumber: null,
  regulator: null,
  jurisdiction: null,
};

/**
 * Single source of truth for the operator's licensing state, read from
 * `GET /compliance/config` (fail-closed on the server). Defaults to unlicensed
 * while loading / on error so the footer never asserts a licence we don't hold
 * (#41).
 */
export function useLicensing(): LicensingConfig {
  const { data } = useQuery({
    queryKey: ['compliance', 'config'],
    queryFn: () => api<LicensingConfig>('/compliance/config'),
    staleTime: 60_000,
    retry: false,
  });
  return data ?? UNLICENSED;
}
