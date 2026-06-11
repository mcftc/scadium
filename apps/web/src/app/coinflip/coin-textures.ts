import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { CoinSide } from './flip-coin';

/**
 * Runtime textures for the 3D coin, reproducing the DOM FlipCoin design:
 * radial-gradient face, embossed letter, glint, ridged rim. Cached per side.
 */

const cache = new Map<string, CanvasTexture>();

const SIZE = 512;

const FACE = {
  heads: {
    ridgeA: '#7c5fd4',
    ridgeB: '#4c3f8f',
    gradient: ['#c4a8ff', '#8b5cf6', '#5b3fa8'],
    letter: 'H',
  },
  tails: {
    ridgeA: '#22a8c4',
    ridgeB: '#156a80',
    gradient: ['#a5f3ff', '#22d3ee', '#0e7490'],
    letter: 'T',
  },
} as const;

function finalize(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Full cap texture: ridged outer ring + radial face + embossed letter + glint. */
export function getCoinFaceTexture(side: CoinSide, mirrored = false): CanvasTexture {
  const key = `face:${side}:${mirrored}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const spec = FACE[side];
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const c = SIZE / 2;
    if (mirrored) {
      ctx.translate(SIZE, 0);
      ctx.scale(-1, 1);
    }
    // Ridged rim: alternating wedges, 6° each (repeating-conic-gradient analog).
    for (let i = 0; i < 60; i++) {
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, c, (i * 6 * Math.PI) / 180, ((i + 1) * 6 * Math.PI) / 180);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? spec.ridgeA : spec.ridgeB;
      ctx.fill();
    }
    // Inner face (inset 6% like the DOM version).
    const inner = c * 0.88;
    const grad = ctx.createRadialGradient(c * 0.7, c * 0.6, inner * 0.05, c, c, inner);
    grad.addColorStop(0, spec.gradient[0]);
    grad.addColorStop(0.45, spec.gradient[1]);
    grad.addColorStop(1, spec.gradient[2]);
    ctx.beginPath();
    ctx.arc(c, c, inner, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    // Embossed letter.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${SIZE * 0.42}px "Geist Sans", Inter, system-ui, sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowOffsetY = SIZE * 0.008;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(spec.letter, c, c * 1.04);
    ctx.shadowColor = 'transparent';
    // Glint.
    ctx.save();
    ctx.translate(c * 0.62, c * 0.52);
    ctx.rotate((-30 * Math.PI) / 180);
    ctx.beginPath();
    ctx.ellipse(0, 0, SIZE * 0.11, SIZE * 0.05, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fill();
    ctx.restore();
  }
  const texture = finalize(canvas);
  cache.set(key, texture);
  return texture;
}

/** Tiny vertical stripe texture for the cylinder side — milled coin edge. */
export function getCoinEdgeTexture(side: CoinSide): CanvasTexture {
  const key = `edge:${side}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const spec = FACE[side];
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (let x = 0; x < 64; x += 4) {
      ctx.fillStyle = (x / 4) % 2 === 0 ? spec.ridgeA : spec.ridgeB;
      ctx.fillRect(x, 0, 4, 8);
    }
  }
  const texture = finalize(canvas);
  texture.wrapS = RepeatWrapping;
  texture.repeat.set(24, 1);
  cache.set(key, texture);
  return texture;
}
