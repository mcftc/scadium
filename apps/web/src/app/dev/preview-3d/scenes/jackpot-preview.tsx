'use client';

import { useState } from 'react';
import { JackpotReel, type JackpotReveal } from '@/app/jackpot/jackpot-reel';
import type { JackpotPlayer } from '@/hooks/use-jackpot';

const FAKE_PLAYERS: JackpotPlayer[] = [
  { userId: 'u1', username: 'degenking', walletAddress: 'Aaaa1111', amountLamports: '2400000000', chance: 0.34 },
  { userId: 'u2', username: 'moonshot', walletAddress: 'Bbbb2222', amountLamports: '1700000000', chance: 0.24 },
  { userId: 'u3', username: null, walletAddress: '7kJyXw99PqRs7USS', amountLamports: '1100000000', chance: 0.16 },
  { userId: 'u4', username: 'cryptomommy', walletAddress: 'Dddd4444', amountLamports: '800000000', chance: 0.11 },
  { userId: 'u5', username: 'bonkbonk', walletAddress: 'Eeee5555', amountLamports: '600000000', chance: 0.09 },
  { userId: 'u6', username: 'lucky_luc', walletAddress: 'Ffff6666', amountLamports: '400000000', chance: 0.06 },
];

export function JackpotPreview() {
  const [run, setRun] = useState(0);
  const [winnerIdx, setWinnerIdx] = useState(0);
  const [meWins, setMeWins] = useState(false);
  const [done, setDone] = useState(false);

  const winner = FAKE_PLAYERS[winnerIdx]!;
  const reveal: JackpotReveal = {
    players: FAKE_PLAYERS,
    winnerId: winner.userId,
    winnerName: winner.username,
    payoutLamports: '6650000000',
    meId: meWins ? winner.userId : 'someone-else',
  };

  return (
    <div className="space-y-4">
      {/* key remounts the whole reveal — exactly how the game page uses it */}
      <JackpotReel key={run} reveal={reveal} onDone={() => setDone(true)} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setWinnerIdx(Math.floor(Math.random() * FAKE_PLAYERS.length));
            setDone(false);
            setRun((n) => n + 1);
          }}
          className="rounded-lg bg-gradient-primary px-4 py-2 text-sm font-semibold text-white shadow-glow-sm"
        >
          Spin again (random winner)
        </button>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input type="checkbox" checked={meWins} onChange={(e) => setMeWins(e.target.checked)} />
          I am the winner
        </label>
        <span className="text-sm text-foreground-muted">
          winner: {winner.username ?? 'anon'} ({(winner.chance * 100).toFixed(0)}%)
          {done ? ' · onDone fired ✓' : ''}
        </span>
      </div>
    </div>
  );
}
