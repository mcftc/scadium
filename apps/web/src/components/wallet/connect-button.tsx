'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Wallet, LogOut, User as UserIcon, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWalletModal } from '@/components/wallet/wallet-modal-provider';
import { useWalletAuth } from '@/hooks/use-wallet-auth';
import { cn } from '@/lib/cn';

/**
 * Header button that becomes a wallet dropdown once authenticated.
 * Shows a shortened wallet address + a menu (Profile / Sign out).
 */
export function ConnectButton() {
  const { open } = useWalletModal();
  const { isAuthenticated, walletAddress, signOut } = useWalletAuth();
  const [mounted, setMounted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Avoid hydration mismatch — zustand persist reads from localStorage after mount
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  if (!mounted || !isAuthenticated || !walletAddress) {
    return (
      <Button variant="primary" size="md" onClick={open}>
        <Wallet className="h-4 w-4" />
        Connect Wallet
      </Button>
    );
  }

  const short = `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        className={cn(
          'flex items-center gap-2 rounded-xl border border-border bg-surface-elevated px-4 h-11 whitespace-nowrap',
          'font-semibold text-sm hover:border-primary-400/50 transition-colors',
        )}
      >
        <div className="h-2 w-2 rounded-full bg-success animate-pulse-glow" />
        <span className="font-mono">{short}</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', menuOpen && 'rotate-180')} />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border bg-surface shadow-2xl shadow-primary-900/30 overflow-hidden">
          <Link
            href="/profile"
            onClick={() => setMenuOpen(false)}
            className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-surface-elevated transition-colors"
          >
            <UserIcon className="h-4 w-4 text-foreground-muted" />
            Profile
          </Link>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              void signOut();
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-surface-elevated transition-colors text-left border-t border-border"
          >
            <LogOut className="h-4 w-4 text-foreground-muted" />
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
