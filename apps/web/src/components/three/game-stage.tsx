'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import { useQualityTier, type QualityTier } from './use-quality';

export interface StageRuntime {
  /** Effective render tier ('off' never reaches the canvas). */
  tier: Exclude<QualityTier, 'off'>;
  /** False while the stage is scrolled out of view — the canvas stops rendering. */
  visible: boolean;
  /** Called by the canvas once its first frame commits; hides the 2D fallback. */
  onReady: () => void;
  /** Called on webglcontextlost; swaps back to the 2D fallback for the session. */
  onContextLost: () => void;
}

const StageRuntimeContext = createContext<StageRuntime | null>(null);

export function useStageRuntime(): StageRuntime {
  const runtime = useContext(StageRuntimeContext);
  if (!runtime) throw new Error('useStageRuntime must be used under <GameStage>');
  return runtime;
}

export interface GameStageProps {
  /**
   * The 3D stage — a `next/dynamic(..., { ssr: false })` component, so three.js
   * stays out of the page's initial bundle. Rendered inside the runtime context.
   */
  children: ReactNode;
  /**
   * The existing 2D visual. Shown during SSR/chunk load, hidden once the canvas
   * draws, and shown permanently when WebGL is unavailable, reduced motion is
   * requested, or the GL context is lost.
   */
  fallback: ReactNode;
  /** Must size the stage box (e.g. `aspect-video w-full`) — both layers fill it. */
  className?: string;
  /** Stages are visual theater by default; the DOM keeps all input. */
  interactive?: boolean;
}

export function GameStage({ children, fallback, className, interactive = false }: GameStageProps) {
  const tier = useQualityTier();
  const [ready, setReady] = useState(false);
  const [lost, setLost] = useState(false);
  const [visible, setVisible] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: '64px' },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  const onReady = useCallback(() => setReady(true), []);
  const onContextLost = useCallback(() => setLost(true), []);

  const runtime = useMemo<StageRuntime | null>(() => {
    if (tier !== 'low' && tier !== 'high') return null;
    return { tier, visible, onReady, onContextLost };
  }, [tier, visible, onReady, onContextLost]);

  const showCanvas = runtime !== null && !lost;

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div className={cn('absolute inset-0', showCanvas && ready && 'invisible')}>{fallback}</div>
      {showCanvas ? (
        <div
          className={cn(
            'absolute inset-0',
            !interactive && 'pointer-events-none',
            !ready && 'opacity-0',
          )}
        >
          <StageRuntimeContext.Provider value={runtime}>{children}</StageRuntimeContext.Provider>
        </div>
      ) : null}
    </div>
  );
}
