'use client';

import { useState } from 'react';
import { JackpotReel, type JackpotReveal } from '@/app/jackpot/jackpot-reel';
import type { JackpotRange } from '@/hooks/use-jackpot';

const STAKES: [string, string][] = [
  ['degenking', '2400000000'],
  ['moonshot', '1700000000'],
  ['7kJy…7USS', '1100000000'],
  ['cryptomommy', '800000000'],
  ['bonkbonk', '600000000'],
  ['lucky_luc', '400000000'],
];
// Entry-ordered ticket ranges, as the settle produces them.
const FAKE_RANGES: JackpotRange[] = (() => {
  let cursor = 0n;
  return STAKES.map(([player, amount], i) => {
    const start = cursor;
    cursor += BigInt(amount);
    return {
      playerId: `p${i}`,
      player,
      amountLamports: amount,
      start: `${start}`,
      end: `${cursor}`,
    };
  });
})();
const TOTAL = FAKE_RANGES[FAKE_RANGES.length - 1]!.end;

export function JackpotPreview() {
  const [run, setRun] = useState(0);
  const [winnerIdx, setWinnerIdx] = useState(0);
  const [meWins, setMeWins] = useState(false);
  const [done, setDone] = useState(false);

  const winner = FAKE_RANGES[winnerIdx]!;
  // A ticket a third of the way into the winner's range.
  const ticket = BigInt(winner.start) + (BigInt(winner.end) - BigInt(winner.start)) / 3n;
  const reveal: JackpotReveal = {
    ranges: FAKE_RANGES,
    winnerPlayerId: winner.playerId,
    winnerName: winner.player,
    payoutLamports: '6650000000',
    winningTicket: ticket.toString(),
    totalLamports: TOTAL,
    myPlayerId: meWins ? winner.playerId : 'someone-else',
  };

  return (
    <div className="space-y-4">
      {/* key remounts the whole reveal — exactly how the game page uses it */}
      <JackpotReel key={run} reveal={reveal} onDone={() => setDone(true)} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setWinnerIdx(Math.floor(Math.random() * FAKE_RANGES.length));
            setDone(false);
            setRun((n) => n + 1);
          }}
          className="rounded-lg bg-gradient-primary px-4 py-2 text-sm font-semibold text-white shadow-glow-sm"
        >
          Spin again (random winner)
        </button>
        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input type="checkbox" checked={meWins} onChange={(e) => setMeWins(e.target.checked)} />I
          am the winner
        </label>
        <span className="text-sm text-foreground-muted">
          winner: {winner.player} (
          {((Number(winner.amountLamports) / Number(TOTAL)) * 100).toFixed(0)}%)
          {done ? ' · onDone fired ✓' : ''}
        </span>
      </div>
    </div>
  );
}
