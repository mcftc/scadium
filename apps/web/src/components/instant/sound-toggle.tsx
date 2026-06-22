'use client';

import { Volume2, VolumeX } from 'lucide-react';
import type { GameSound } from '@/components/instant/use-game-sound';

/**
 * Compact mute toggle for game pages that don't render WinEffect (which carries
 * its own toggle). The sound preference is shared across all games via the hook's
 * localStorage key, so toggling here affects the whole catalogue.
 */
export function SoundToggle({ sound, className }: { sound: GameSound; className?: string }) {
  return (
    <button
      type="button"
      onClick={sound.toggle}
      aria-label={sound.enabled ? 'Mute sound' : 'Unmute sound'}
      title={sound.enabled ? 'Mute sound' : 'Unmute sound'}
      className={
        'rounded-lg border border-border bg-background/70 p-1.5 text-foreground-muted backdrop-blur transition-colors hover:border-primary-400/40 hover:text-foreground ' +
        (className ?? '')
      }
    >
      {sound.enabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
    </button>
  );
}
