'use client';

import { useMemo, type Ref } from 'react';
import { CanvasTexture, type Mesh } from 'three';

let blobTexture: CanvasTexture | null = null;

function getBlobTexture(): CanvasTexture {
  if (blobTexture) return blobTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
    gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.35)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  blobTexture = new CanvasTexture(canvas);
  return blobTexture;
}

export interface BlobShadowProps {
  position?: [number, number, number];
  scale?: number | [number, number, number];
  opacity?: number;
  /** For scenes that animate the shadow (breathe with toss height, etc.). */
  meshRef?: Ref<Mesh>;
}

/** Cheap fake contact shadow — no shadow maps anywhere in the stages. */
export function BlobShadow({
  position = [0, 0, 0],
  scale = 1,
  opacity = 0.5,
  meshRef,
}: BlobShadowProps) {
  const texture = useMemo(() => getBlobTexture(), []);
  return (
    <mesh ref={meshRef} position={position} rotation={[-Math.PI / 2, 0, 0]} scale={scale}>
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}
