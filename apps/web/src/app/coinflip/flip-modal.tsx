'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Swords } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { subscribeFlipResolved, type CoinflipGame } from '@/hooks/use-coinflip';
import { useMe } from '@/hooks/use-me';
import { shortAddress, formatSol } from '@/lib/format';
import { cn } from '@/lib/cn';
import { FlipCoin3D } from './flip-coin-3d';

type Stage = 'waiting' | 'flipping' | 'done';

/**
 * The flip theater: spectate an open game live, ride along as the joiner, or
 * replay a settled one. Stages: waiting (joiner pending) → flipping (3D coin
 * spins ~2.4s of suspense even though the result is already known) → done
 * (winner highlight + payout + verify link).
 */
export function FlipModal({
  game: initial,
  open,
  onClose,
}: {
  game: CoinflipGame | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: me } = useMe();
  const [game, setGame] = useState<CoinflipGame | null>(initial);
  const [stage, setStage] = useState<Stage>('waiting');

  // (Re)arm whenever a different game is opened (or the modal re-opens). Settled
  // games replay the flip. Reset during render on the open/initial edge rather
  // than via a setState-in-effect; the socket effect below still mutates
  // game/stage live afterwards.
  const armKey = `${open}:${initial?.id ?? 'none'}`;
  const [prevArmKey, setPrevArmKey] = useState(armKey);
  if (prevArmKey !== armKey) {
    setPrevArmKey(armKey);
    setGame(initial);
    setStage(initial?.status === 'completed' ? 'flipping' : 'waiting');
  }

  // Live spectate: when the watched open game resolves, run the animation.
  useEffect(() => {
    if (!open || !game || game.status !== 'open') return;
    return subscribeFlipResolved(game.id, (resolved) => {
      setGame(resolved);
      setStage('flipping');
    });
  }, [open, game]);

  if (!game) return null;

  const creatorName = game.creatorUsername ?? shortAddress(game.creatorWallet ?? '');
  const joinerName = game.joinerId
    ? (game.joinerUsername ?? shortAddress(game.joinerWallet ?? ''))
    : null;
  const creatorWon = game.winnerId != null && game.winnerId === game.creatorId;
  const joinerWon = game.winnerId != null && game.winnerId === game.joinerId;
  const payout = (BigInt(game.amountLamports) * BigInt(19)) / BigInt(10);
  const iWon = me?.id != null && game.winnerId === me.id;
  const iPlayed = me?.id != null && (game.creatorId === me.id || game.joinerId === me.id);

  const verifyHref =
    game.serverSeed && game.clientSeed
      ? `/fairness?game=coinflip&clientSeed=${encodeURIComponent(game.clientSeed)}` +
        `&nonce=${game.nonce ?? 0}&commit=${game.serverSeedHash ?? ''}` +
        `&serverSeed=${game.serverSeed}`
      : null;

  return (
    <Dialog open={open} onClose={onClose} title="Coinflip" className="max-w-lg">
      <div className="space-y-5">
        {/* Players */}
        <div className="flex items-center justify-between gap-3">
          <PlayerCard
            name={creatorName}
            side={game.creatorSide}
            highlight={stage === 'done' ? (creatorWon ? 'win' : 'lose') : null}
          />
          <Swords className="h-5 w-5 shrink-0 text-foreground-muted" />
          {joinerName ? (
            <PlayerCard
              name={joinerName}
              side={game.creatorSide === 'heads' ? 'tails' : 'heads'}
              highlight={stage === 'done' ? (joinerWon ? 'win' : 'lose') : null}
            />
          ) : (
            <div className="flex-1 rounded-xl border border-dashed border-border px-3 py-3 text-center">
              <div className="text-xs text-foreground-muted animate-pulse">Waiting for player…</div>
            </div>
          )}
        </div>

        {/* The coin — 3D toss, falls back to the DOM coin without WebGL */}
        <div className="py-3">
          <FlipCoin3D
            result={game.result ?? game.creatorSide}
            spinning={stage === 'flipping'}
            size={150}
            celebrate={iWon}
            onSpinComplete={() => setStage('done')}
          />
        </div>

        {/* Status line */}
        <div className="text-center min-h-[3.5rem]">
          {stage === 'waiting' && (
            <p className="text-xs text-foreground-muted">
              Pot{' '}
              <span className="font-mono font-bold text-foreground">
                {formatSol((BigInt(game.amountLamports) * BigInt(2)).toString(), 3)} SOL
              </span>{' '}
              · winner takes {formatSol(payout.toString(), 3)} SOL
            </p>
          )}
          {stage === 'flipping' && (
            <p className="text-xs uppercase tracking-[0.3em] text-foreground-muted animate-pulse">
              Flipping…
            </p>
          )}
          {stage === 'done' && game.result && (
            <div className="space-y-1.5">
              <div
                className={cn(
                  'text-xl font-black uppercase',
                  game.result === 'heads' ? 'text-primary-400' : 'text-cyan-400',
                )}
              >
                {game.result}!
              </div>
              <div className="text-sm">
                <span className="font-bold text-success">
                  {creatorWon ? creatorName : joinerName}
                </span>{' '}
                <span className="text-foreground-muted">wins</span>{' '}
                <span className="font-mono font-bold text-success">
                  +{formatSol(payout.toString(), 3)} SOL
                </span>
              </div>
              {iPlayed && (
                <div
                  className={cn(
                    'inline-block rounded-lg px-3 py-1 text-xs font-bold',
                    iWon
                      ? 'bg-success/15 text-success border border-success/40'
                      : 'bg-danger/10 text-danger border border-danger/30',
                  )}
                >
                  {iWon ? 'You won!' : 'You lost'}
                </div>
              )}
              {verifyHref && (
                <div>
                  <Link
                    href={verifyHref}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary-400 hover:text-primary-300 transition-colors"
                  >
                    Verify flip
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function PlayerCard({
  name,
  side,
  highlight,
}: {
  name: string;
  side: 'heads' | 'tails';
  highlight: 'win' | 'lose' | null;
}) {
  return (
    <div
      className={cn(
        'flex-1 rounded-xl border px-3 py-3 text-center transition-colors',
        highlight === 'win'
          ? 'border-success/50 bg-success/10'
          : highlight === 'lose'
            ? 'border-danger/30 bg-danger/5 opacity-70'
            : 'border-border bg-surface-elevated/50',
      )}
    >
      <span
        className={cn(
          'mx-auto mb-1.5 flex h-9 w-9 items-center justify-center rounded-full text-sm font-black text-white ring-2',
          side === 'heads'
            ? 'bg-primary-400/80 ring-primary-400/50'
            : 'bg-cyan-500/80 ring-cyan-400/50',
        )}
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div className="truncate text-xs font-bold">{name}</div>
      <div
        className={cn(
          'text-[10px] font-mono uppercase',
          side === 'heads' ? 'text-primary-400' : 'text-cyan-400',
        )}
      >
        {side}
      </div>
    </div>
  );
}
