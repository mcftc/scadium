import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { CoinSide } from './flip-coin';

/**
 * Runtime textures for the $SCAD coin (no asset files, cached per key):
 * heads = the android-mascot bust (purple), tails = the "1 SCAD" denomination
 * (cyan), struck like a real minted coin — milled rim with per-wedge bevel
 * shading, a beaded inner ring, a circular legend and an embossed relief that
 * doubles as the material's bump map so the device catches the light in 3D.
 */

const cache = new Map<string, CanvasTexture>();

const SIZE = 1024;

const FACE = {
  heads: {
    ridgeA: '#8f72e8',
    ridgeB: '#4a3c84',
    rim: '#6c57b8',
    gradient: ['#d9c6ff', '#9a6ff0', '#5a3fa6'],
    field: '#7d5bd0',
    legendTop: 'SCADIUM',
    legendBottom: 'PROVABLY FAIR',
  },
  tails: {
    ridgeA: '#3fc6e6',
    ridgeB: '#0f5a72',
    rim: '#1d93b4',
    gradient: ['#bdf6ff', '#34d6ee', '#0c6f8c'],
    field: '#1aa6c6',
    legendTop: 'ONE SCAD',
    legendBottom: 'PROOF OF PLAY',
  },
} as const;

function finalize(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Characters laid out on a circular baseline. `flip` (for the lower arc) keeps
 * the glyphs upright/readable instead of letting them hang upside-down.
 */
function ringText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  sweep: number,
  size: number,
  color: string,
  flip = false,
): void {
  ctx.save();
  ctx.font = `800 ${size}px "Geist Mono", ui-monospace, monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const step = sweep / Math.max(1, text.length - 1);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? ' ';
    const a = startAngle + i * step;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.rotate(flip ? a - Math.PI / 2 : a + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

function beadedRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, count: number, r: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawBase(ctx: CanvasRenderingContext2D, side: CoinSide): void {
  const spec = FACE[side];
  const c = SIZE / 2;
  // Milled rim: alternating wedges, each shaded outer→inner to read as a bevel.
  const wedges = 120;
  for (let i = 0; i < wedges; i++) {
    const a0 = (i / wedges) * Math.PI * 2;
    const a1 = ((i + 1) / wedges) * Math.PI * 2;
    const grad = ctx.createRadialGradient(c, c, c * 0.86, c, c, c);
    grad.addColorStop(0, i % 2 === 0 ? spec.ridgeA : spec.ridgeB);
    grad.addColorStop(1, i % 2 === 0 ? spec.ridgeB : spec.ridgeA);
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, c, a0, a1);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }
  // Bevelled rim band.
  ctx.beginPath();
  ctx.arc(c, c, c * 0.865, 0, Math.PI * 2);
  ctx.fillStyle = spec.rim;
  ctx.fill();
  // Coin field — domed radial gradient (offset highlight = a metal sheen).
  const inner = c * 0.84;
  const grad = ctx.createRadialGradient(c * 0.72, c * 0.6, inner * 0.05, c, c, inner);
  grad.addColorStop(0, spec.gradient[0]);
  grad.addColorStop(0.5, spec.gradient[1]);
  grad.addColorStop(1, spec.gradient[2]);
  ctx.beginPath();
  ctx.arc(c, c, inner, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  // Beaded ring + framing lines around the legend channel.
  beadedRing(ctx, c, c, inner * 0.93, 96, SIZE * 0.006, 'rgba(255,255,255,0.55)');
  ctx.lineWidth = SIZE * 0.006;
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.beginPath();
  ctx.arc(c, c, inner * 0.76, 0, Math.PI * 2);
  ctx.stroke();
  // Circular legend: top arc reads normally, bottom arc curves the other way.
  ringText(ctx, spec.legendTop, c, c, inner * 0.85, Math.PI * 1.5 - 0.6, 1.2, SIZE * 0.045, 'rgba(255,255,255,0.85)');
  ringText(ctx, spec.legendBottom, c, c, inner * 0.85, Math.PI * 0.5 + 0.6, -1.2, SIZE * 0.038, 'rgba(255,255,255,0.7)', true);
  // Sheen sweep.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(c * 0.62, c * 0.52);
  ctx.rotate((-32 * Math.PI) / 180);
  ctx.beginPath();
  ctx.ellipse(0, 0, SIZE * 0.1, SIZE * 0.045, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fill();
  ctx.restore();
}

/** The android mascot, struck in relief like a portrait on a minted coin. */
function drawRobot(ctx: CanvasRenderingContext2D): void {
  const c = SIZE / 2;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ink = 'rgba(255,255,255,0.92)';
  const fill = 'rgba(255,255,255,0.16)';
  ctx.strokeStyle = ink;
  ctx.fillStyle = fill;
  ctx.lineWidth = SIZE * 0.014;
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowOffsetY = SIZE * 0.006;

  // Shoulders / chest plate.
  ctx.beginPath();
  ctx.moveTo(c - SIZE * 0.18, c + SIZE * 0.2);
  ctx.quadraticCurveTo(c - SIZE * 0.2, c + SIZE * 0.04, c - SIZE * 0.11, c + SIZE * 0.01);
  ctx.lineTo(c + SIZE * 0.11, c + SIZE * 0.01);
  ctx.quadraticCurveTo(c + SIZE * 0.2, c + SIZE * 0.04, c + SIZE * 0.18, c + SIZE * 0.2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Chest core.
  ctx.beginPath();
  ctx.arc(c, c + SIZE * 0.085, SIZE * 0.028, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();

  // Head — rounded helmet.
  const headW = SIZE * 0.27;
  const headH = SIZE * 0.24;
  const hx = c - headW / 2;
  const hy = c - SIZE * 0.2;
  const r = SIZE * 0.07;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(hx + r, hy);
  ctx.arcTo(hx + headW, hy, hx + headW, hy + headH, r);
  ctx.arcTo(hx + headW, hy + headH, hx, hy + headH, r * 1.3);
  ctx.arcTo(hx, hy + headH, hx, hy, r * 1.3);
  ctx.arcTo(hx, hy, hx + headW, hy, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Antenna.
  ctx.beginPath();
  ctx.moveTo(c, hy);
  ctx.lineTo(c, hy - SIZE * 0.06);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, hy - SIZE * 0.078, SIZE * 0.022, 0, Math.PI * 2);
  ctx.fillStyle = ink;
  ctx.fill();
  // Visor band (the face) — a dark inset with two bright eyes.
  const vY = hy + headH * 0.46;
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.85)';
  ctx.shadowBlur = SIZE * 0.02;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.roundRect(c - headW * 0.34, vY - SIZE * 0.018, headW * 0.68, SIZE * 0.036, SIZE * 0.018);
  ctx.fill();
  ctx.restore();
  // Mouth grill.
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (const dx of [-SIZE * 0.04, 0, SIZE * 0.04]) {
    ctx.beginPath();
    ctx.roundRect(c + dx - SIZE * 0.01, hy + headH * 0.74, SIZE * 0.02, headH * 0.16, SIZE * 0.006);
    ctx.fill();
  }
  ctx.restore();
}

/** The denomination side — big "1", SCAD, and laurel sprigs. */
function drawDenomination(ctx: CanvasRenderingContext2D): void {
  const c = SIZE / 2;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowOffsetY = SIZE * 0.008;
  ctx.fillStyle = 'rgba(255,255,255,0.96)';
  ctx.font = `900 ${SIZE * 0.4}px "Geist Sans", Inter, system-ui, sans-serif`;
  ctx.fillText('1', c, c - SIZE * 0.05);
  ctx.font = `800 ${SIZE * 0.1}px "Geist Sans", Inter, system-ui, sans-serif`;
  ctx.fillText('SCAD', c, c + SIZE * 0.17);
  // Laurel sprigs either side.
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.66)';
  ctx.lineWidth = SIZE * 0.011;
  ctx.lineCap = 'round';
  for (const dir of [-1, 1]) {
    const bx = c + dir * SIZE * 0.27;
    ctx.beginPath();
    ctx.moveTo(bx, c + SIZE * 0.12);
    ctx.quadraticCurveTo(c + dir * SIZE * 0.34, c, c + dir * SIZE * 0.28, c - SIZE * 0.16);
    ctx.stroke();
    for (let k = 0; k < 5; k++) {
      const ly = c + SIZE * 0.1 - k * SIZE * 0.055;
      const lx = bx + dir * SIZE * 0.012 + dir * k * SIZE * 0.004;
      ctx.beginPath();
      ctx.ellipse(lx + dir * SIZE * 0.022, ly, SIZE * 0.024, SIZE * 0.011, dir * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fill();
    }
  }
  ctx.restore();
}

/** heads = robot bust (TURA), tails = 1 SCAD denomination (YAZI). */
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
 * telegraph the outcome while the coin is still in the air). Shaded ridges so
 * the reeding catches light as the coin tumbles.
 */
export function getCoinEdgeTexture(): CanvasTexture {
  const key = 'edge';
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (let x = 0; x < 128; x += 4) {
      const g = ctx.createLinearGradient(x, 0, x + 4, 0);
      g.addColorStop(0, '#2c2748');
      g.addColorStop(0.5, '#7866c8');
      g.addColorStop(1, '#2c2748');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 4, 16);
    }
  }
  const texture = finalize(canvas);
  texture.wrapS = RepeatWrapping;
  texture.repeat.set(48, 1);
  cache.set(key, texture);
  return texture;
}
