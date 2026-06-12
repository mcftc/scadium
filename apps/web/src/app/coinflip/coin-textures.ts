import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { CoinSide } from './flip-coin';

/**
 * Runtime textures for the $SCAD coin (no asset files, cached per key):
 * heads = the android-robot emblem face (purple), tails = the "1 SCAD"
 * denomination face (cyan), like a real minted coin. Ridged rim ring and a
 * circular legend around each face.
 */

const cache = new Map<string, CanvasTexture>();

const SIZE = 512;

const FACE = {
  heads: {
    ridgeA: '#7c5fd4',
    ridgeB: '#4c3f8f',
    gradient: ['#c4a8ff', '#8b5cf6', '#5b3fa8'],
    legend: '★ SCADIUM ★ CASINO ★ SCADIUM ★ CASINO ',
  },
  tails: {
    ridgeA: '#22a8c4',
    ridgeB: '#156a80',
    gradient: ['#a5f3ff', '#22d3ee', '#0e7490'],
    legend: '★ 1 SCAD ★ PROVABLY FAIR ★ 1 SCAD ★ FAIR ',
  },
} as const;

const EMBOSS = 'rgba(255,255,255,0.92)';

function finalize(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Characters laid out on a circle, reading clockwise from the top. */
function ringText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
): void {
  const step = (Math.PI * 2) / text.length;
  ctx.save();
  ctx.font = `700 ${SIZE * 0.052}px "Geist Mono", ui-monospace, monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? ' ';
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(i * step);
    ctx.translate(0, -radius);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function drawBase(ctx: CanvasRenderingContext2D, side: CoinSide): void {
  const spec = FACE[side];
  const c = SIZE / 2;
  // Ridged rim: alternating 6° wedges.
  for (let i = 0; i < 60; i++) {
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, c, (i * 6 * Math.PI) / 180, ((i + 1) * 6 * Math.PI) / 180);
    ctx.closePath();
    ctx.fillStyle = i % 2 === 0 ? spec.ridgeA : spec.ridgeB;
    ctx.fill();
  }
  // Coin face.
  const inner = c * 0.9;
  const grad = ctx.createRadialGradient(c * 0.7, c * 0.6, inner * 0.05, c, c, inner);
  grad.addColorStop(0, spec.gradient[0]);
  grad.addColorStop(0.45, spec.gradient[1]);
  grad.addColorStop(1, spec.gradient[2]);
  ctx.beginPath();
  ctx.arc(c, c, inner, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  // Inner border ring framing the legend.
  ctx.beginPath();
  ctx.arc(c, c, inner * 0.97, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = SIZE * 0.008;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, inner * 0.78, 0, Math.PI * 2);
  ctx.stroke();
  ringText(ctx, spec.legend, c, c, inner * 0.875);
  // Glint.
  ctx.save();
  ctx.translate(c * 0.6, c * 0.5);
  ctx.rotate((-30 * Math.PI) / 180);
  ctx.beginPath();
  ctx.ellipse(0, 0, SIZE * 0.1, SIZE * 0.045, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill();
  ctx.restore();
}

/** The android mascot, embossed like a portrait on a minted coin. */
function drawRobot(ctx: CanvasRenderingContext2D): void {
  const c = SIZE / 2;
  ctx.save();
  ctx.strokeStyle = EMBOSS;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = SIZE * 0.018;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowOffsetY = SIZE * 0.006;

  const headW = SIZE * 0.34;
  const headH = SIZE * 0.27;
  const headX = c - headW / 2;
  const headY = c - SIZE * 0.21;
  const r = SIZE * 0.06;
  // Head.
  ctx.beginPath();
  ctx.moveTo(headX + r, headY);
  ctx.arcTo(headX + headW, headY, headX + headW, headY + headH, r);
  ctx.arcTo(headX + headW, headY + headH, headX, headY + headH, r);
  ctx.arcTo(headX, headY + headH, headX, headY, r);
  ctx.arcTo(headX, headY, headX + headW, headY, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Antenna.
  ctx.beginPath();
  ctx.moveTo(c, headY);
  ctx.lineTo(c, headY - SIZE * 0.055);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, headY - SIZE * 0.075, SIZE * 0.02, 0, Math.PI * 2);
  ctx.fillStyle = EMBOSS;
  ctx.fill();
  // Eyes — glowing.
  ctx.shadowColor = 'rgba(255,255,255,0.8)';
  ctx.shadowBlur = SIZE * 0.025;
  ctx.shadowOffsetY = 0;
  const eyeY = headY + headH * 0.45;
  for (const dx of [-headW * 0.22, headW * 0.22]) {
    ctx.beginPath();
    ctx.arc(c + dx, eyeY, SIZE * 0.038, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowOffsetY = SIZE * 0.006;
  // Mouth grill.
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  const grillY = headY + headH * 0.74;
  for (const dx of [-SIZE * 0.045, 0, SIZE * 0.045]) {
    ctx.beginPath();
    ctx.roundRect(c + dx - SIZE * 0.011, grillY, SIZE * 0.022, headH * 0.14, SIZE * 0.008);
    ctx.fill();
  }
  // Shoulders.
  ctx.beginPath();
  ctx.moveTo(c - headW * 0.62, c + SIZE * 0.21);
  ctx.quadraticCurveTo(c, c + SIZE * 0.075, c + headW * 0.62, c + SIZE * 0.21);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** The denomination, like the number side of a real coin. */
function drawDenomination(ctx: CanvasRenderingContext2D): void {
  const c = SIZE / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowOffsetY = SIZE * 0.008;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = `900 ${SIZE * 0.4}px "Geist Sans", Inter, system-ui, sans-serif`;
  ctx.fillText('1', c, c - SIZE * 0.045);
  ctx.font = `800 ${SIZE * 0.105}px "Geist Sans", Inter, system-ui, sans-serif`;
  ctx.fillText('SCAD', c, c + SIZE * 0.185);
  // Side sprigs.
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = SIZE * 0.012;
  ctx.lineCap = 'round';
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(c + dir * SIZE * 0.26, c + SIZE * 0.1);
    ctx.quadraticCurveTo(c + dir * SIZE * 0.32, c - SIZE * 0.02, c + dir * SIZE * 0.27, c - SIZE * 0.15);
    ctx.stroke();
  }
  ctx.restore();
}

/** heads = robot emblem (TURA), tails = 1 SCAD denomination (YAZI). */
export function getCoinFaceTexture(side: CoinSide): CanvasTexture {
  const key = `face:${side}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    drawBase(ctx, side);
    if (side === 'heads') drawRobot(ctx);
    else drawDenomination(ctx);
  }
  const texture = finalize(canvas);
  cache.set(key, texture);
  return texture;
}

/**
 * Milled coin edge — neutral (NOT result-colored: a side-tinted edge would
 * telegraph the outcome while the coin is still in the air).
 */
export function getCoinEdgeTexture(): CanvasTexture {
  const key = 'edge';
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 8;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (let x = 0; x < 64; x += 4) {
      ctx.fillStyle = (x / 4) % 2 === 0 ? '#6F5FCC' : '#3a3360';
      ctx.fillRect(x, 0, 4, 8);
    }
  }
  const texture = finalize(canvas);
  texture.wrapS = RepeatWrapping;
  texture.repeat.set(24, 1);
  cache.set(key, texture);
  return texture;
}
