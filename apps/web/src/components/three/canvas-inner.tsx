'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useRef, type ReactNode } from 'react';
import { NeonBloom } from './effects';
import { useStageRuntime } from './game-stage';

export interface StageCanvasProps {
  children: ReactNode;
  /**
   * 'always' only for scenes that truly never rest (crash). Everything else:
   * 'demand' + invalidate() while an animation is active.
   */
  frameloop?: 'always' | 'demand';
  camera?: { position?: [number, number, number]; fov?: number };
  /** Bloom renders on the high tier only; false for scenes with their own composer. */
  bloom?: boolean | { intensity?: number };
}

function ReadySignal({ onReady }: { onReady: () => void }) {
  const fired = useRef(false);
  useFrame(() => {
    if (!fired.current) {
      fired.current = true;
      onReady();
    }
  });
  return null;
}

/**
 * The ONLY file that may import `Canvas`. Scene modules compose this and are
 * themselves loaded via `next/dynamic(..., { ssr: false })`, which keeps the
 * whole three.js graph in async chunks.
 */
export function StageCanvas({
  children,
  frameloop = 'demand',
  camera,
  bloom = true,
}: StageCanvasProps) {
  const { tier, visible, onReady, onContextLost } = useStageRuntime();
  return (
    <Canvas
      frameloop={visible ? frameloop : 'never'}
      dpr={tier === 'low' ? [1, 1.25] : [1, 1.75]}
      camera={{ position: camera?.position ?? [0, 0, 8], fov: camera?.fov ?? 45 }}
      gl={{ antialias: false, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener(
          'webglcontextlost',
          (event) => {
            event.preventDefault();
            onContextLost();
          },
          false,
        );
      }}
    >
      <ReadySignal onReady={onReady} />
      <Suspense fallback={null}>{children}</Suspense>
      {bloom !== false && tier === 'high' ? (
        <NeonBloom intensity={typeof bloom === 'object' ? bloom.intensity : undefined} />
      ) : null}
    </Canvas>
  );
}
