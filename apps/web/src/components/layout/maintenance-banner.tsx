'use client';

import { useStatus } from '@/hooks/use-status';

/**
 * Site-wide maintenance banner (#56). Shows when ops have flipped the global
 * pause; the API also rejects wagers/deposits server-side while paused.
 */
export function MaintenanceBanner() {
  const { data } = useStatus();
  if (!data?.paused) return null;
  return (
    <div className="w-full bg-amber-500/15 px-4 py-2 text-center text-sm font-bold text-amber-300">
      Scadium is paused for maintenance — wagering and deposits are temporarily disabled.
    </div>
  );
}
