'use client';

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { WalletConnectModal } from './wallet-connect-modal';

interface WalletModalContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const WalletModalContext = createContext<WalletModalContextValue | null>(null);

/**
 * Supplies any descendant component with `useWalletModal()` — the canonical
 * way to pop the Scadium connect modal from anywhere (header button, empty
 * state on /profile, bet form when unauthenticated, etc.)
 */
export function WalletModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <WalletModalContext.Provider value={{ open, close, isOpen }}>
      {children}
      <WalletConnectModal open={isOpen} onClose={close} />
    </WalletModalContext.Provider>
  );
}

export function useWalletModal(): WalletModalContextValue {
  const ctx = useContext(WalletModalContext);
  if (!ctx) throw new Error('useWalletModal must be used within WalletModalProvider');
  return ctx;
}
