'use client';

import { shortAddress } from '@/lib/format';
import type { LotteryPlayer } from '@/hooks/use-lottery';

/**
 * Public player display for winners lists (bc.game style: avatar + name).
 * Follows the leaderboard precedent: username, else truncated wallet. The
 * avatar falls back to an initial in a gradient circle when no avatarUrl.
 */
export function PlayerCell({ player }: { player: LotteryPlayer }) {
  const name = player.username ?? shortAddress(player.walletAddress);
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      {player.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.avatarUrl}
          alt=""
          className="h-6 w-6 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-primary text-[10px] font-bold text-white">
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="truncate text-xs font-semibold">{name}</span>
    </span>
  );
}
