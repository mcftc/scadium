'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Desktop shell preferences. `railOpen` is the left rail (airdrop + chat):
 * collapsing it gives the game the full width. Persisted so the choice sticks
 * across visits; mobile uses the chat panel's own drawer and ignores it.
 */
interface LayoutState {
  railOpen: boolean;
  setRailOpen: (open: boolean) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      railOpen: true,
      setRailOpen: (railOpen) => set({ railOpen }),
    }),
    { name: 'scadium_layout', storage: createJSONStorage(() => localStorage) },
  ),
);
