'use client';

import { Copy, ExternalLink, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { useSolBalance } from '@/hooks/use-sol-balance';
import { formatSol } from '@/lib/format';
import { Avatar } from '@/components/ui/avatar';
import { env } from '@/config/env';
import { solscanAccount } from '@/lib/explorer';
import { StatsGrid } from '@/components/profile/stats-grid';
import { BetHistory } from '@/components/profile/bet-history';
import { UsernameForm } from '@/components/profile/username-form';
import { useMe } from '@/hooks/use-me';

export function ProfileContent() {
  const { walletAddress, signOut, signOutEverywhere } = useWalletAuth();
  const { sol, loading } = useSolBalance();
  const { data: me } = useMe();
  const [copied, setCopied] = useState(false);

  if (!walletAddress) return null;

  const explorerUrl = solscanAccount(walletAddress);

  async function copyAddress() {
    if (!walletAddress) return;
    await navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-6">
      <LevelBar />
      <StatsGrid />

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Wallet</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-foreground-muted mb-2">
                Address
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-sm bg-surface-elevated px-4 py-3 rounded-xl border border-border overflow-x-auto">
                  {walletAddress}
                </code>
                <Button variant="secondary" size="icon" onClick={copyAddress} aria-label="Copy">
                  <Copy className="h-4 w-4" />
                </Button>
                <a
                  href={explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center h-10 w-10 rounded-xl border border-border bg-surface-elevated hover:border-primary-400/50 transition-colors"
                  aria-label="View on Solscan"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              {copied && <p className="text-xs text-success mt-2">Copied to clipboard</p>}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-6 border-t border-border">
              <div>
                <div className="text-xs uppercase tracking-wider text-foreground-muted mb-1">
                  Play Balance
                </div>
                <div className="font-semibold text-success">
                  {me ? formatSol(me.playBalanceLamports, 4) : '…'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-foreground-muted mb-1">
                  Wallet SOL
                </div>
                <div className="font-semibold">
                  {loading ? '…' : sol !== null ? `${sol.toFixed(4)} SOL` : '—'}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-foreground-muted mb-1">
                  Network
                </div>
                <div className="font-semibold capitalize">{env.solanaNetwork}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-foreground-muted mb-1">
                  Ref code
                </div>
                <div className="font-semibold font-mono text-primary-400">{me?.refCode ?? '—'}</div>
              </div>
            </div>

            <div className="pt-6 border-t border-border">
              <UsernameForm />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Session</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-foreground-muted">
              You&apos;re signed in via Sign-In With Solana. Your session is non-custodial — we
              never hold your funds.
            </div>
            <Button variant="secondary" className="w-full" onClick={() => void signOut()}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
            <Button
              variant="ghost"
              className="w-full text-foreground-muted"
              onClick={() => void signOutEverywhere()}
            >
              Log out everywhere
            </Button>
          </CardContent>
        </Card>
      </div>

      <BetHistory />
    </div>
  );
}

/** solpump-style XP/level bar — XP derives from lifetime wager (10k XP/SOL). */
function LevelBar() {
  const { data: me } = useMe();
  if (!me) return null;
  const span = me.xpNextLevelAt - me.xpCurrentLevelFloor;
  const into = me.xp - me.xpCurrentLevelFloor;
  const pct = span > 0 ? Math.min(100, (into / span) * 100) : 0;
  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex items-center gap-4">
      <div className="relative shrink-0">
        <Avatar
          src={me.avatarUrl}
          name={me.username ?? me.walletAddress}
          className="h-12 w-12 rounded-xl text-lg"
        />
        <span className="absolute -bottom-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-primary px-1 text-[10px] font-black text-white ring-2 ring-surface">
          {me.level}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="font-semibold">Level {me.level}</span>
          <span className="font-mono text-foreground-muted">
            {me.xp.toLocaleString()} / {me.xpNextLevelAt.toLocaleString()} XP
          </span>
        </div>
        <div className="h-2 rounded-full bg-surface-elevated overflow-hidden">
          <div className="h-full bg-gradient-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="hidden sm:block text-right shrink-0">
        <div className="text-[10px] uppercase tracking-wider text-foreground-muted">Next</div>
        <div className="text-sm font-bold">Lv {me.level + 1}</div>
      </div>
    </div>
  );
}
