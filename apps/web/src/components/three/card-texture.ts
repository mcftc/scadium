import { CanvasTexture, SRGBColorSpace } from 'three';

/**
 * Runtime-generated CanvasTextures (no asset files): playing-card faces/backs
 * for blackjack and digit decals for lottery balls. Cached per key for the
 * session — call freely from render paths.
 */

export type CardSuit = 'hearts' | 'diamonds' | 'clubs' | 'spades';

const SUIT_GLYPH: Record<CardSuit, string> = {
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
  spades: '♠',
};

const SUIT_COLOR: Record<CardSuit, string> = {
  hearts: '#DC2626',
  diamonds: '#DC2626',
  clubs: '#111827',
  spades: '#111827',
};

const cache = new Map<string, CanvasTexture>();

const CARD_W = 512;
const CARD_H = 712;

function finalize(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** White card face matching the DOM CardFace design: corner rank+pip, big center pip. */
export function getCardFaceTexture(rank: string, suit: CardSuit): CanvasTexture {
  const key = `face:${rank}:${suit}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#FFFFFF';
    roundedRect(ctx, 0, 0, CARD_W, CARD_H, 44);
    ctx.fill();
    ctx.strokeStyle = 'rgba(17, 24, 39, 0.12)';
    ctx.lineWidth = 6;
    roundedRect(ctx, 8, 8, CARD_W - 16, CARD_H - 16, 38);
    ctx.stroke();

    const glyph = SUIT_GLYPH[suit];
    const color = SUIT_COLOR[suit];
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const drawCorner = () => {
      ctx.font = 'bold 96px "Geist Sans", Inter, system-ui, sans-serif';
      ctx.fillText(rank, 76, 88);
      ctx.font = '72px system-ui, sans-serif';
      ctx.fillText(glyph, 76, 176);
    };
    drawCorner();
    ctx.save();
    ctx.translate(CARD_W, CARD_H);
    ctx.rotate(Math.PI);
    drawCorner();
    ctx.restore();

    ctx.font = '300px system-ui, sans-serif';
    ctx.fillText(glyph, CARD_W / 2, CARD_H / 2 + 16);
  }
  const texture = finalize(canvas);
  cache.set(key, texture);
  return texture;
}

/** Purple gradient back with the nested-border look of the DOM face-down card. */
export function getCardBackTexture(): CanvasTexture {
  const key = 'back';
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    gradient.addColorStop(0, '#6F5FCC');
    gradient.addColorStop(1, '#3B3270');
    ctx.fillStyle = gradient;
    roundedRect(ctx, 0, 0, CARD_W, CARD_H, 44);
    ctx.fill();

    ctx.strokeStyle = 'rgba(238, 134, 255, 0.4)';
    ctx.lineWidth = 8;
    roundedRect(ctx, 14, 14, CARD_W - 28, CARD_H - 28, 36);
    ctx.stroke();

    ctx.setLineDash([18, 14]);
    ctx.strokeStyle = 'rgba(245, 243, 255, 0.35)';
    ctx.lineWidth = 5;
    roundedRect(ctx, CARD_W * 0.2, CARD_H * 0.2, CARD_W * 0.6, CARD_H * 0.6, 24);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const texture = finalize(canvas);
  cache.set(key, texture);
  return texture;
}

/** White disc with a bold dark digit — decal for lottery balls (0–9). */
export function getDigitTexture(digit: number): CanvasTexture {
  const safe = Math.abs(Math.trunc(digit)) % 10;
  const key = `digit:${safe}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(17, 24, 39, 0.2)';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 150px "Geist Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(safe), size / 2, size / 2 + 8);
  }
  const texture = finalize(canvas);
  cache.set(key, texture);
  return texture;
}
