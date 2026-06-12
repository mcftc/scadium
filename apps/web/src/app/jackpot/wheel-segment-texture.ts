import { CanvasTexture, SRGBColorSpace } from 'three';
import type { JackpotPlayer } from '@/hooks/use-jackpot';
import { shortAddress } from '@/lib/format';

/**
 * The whole wheel face as ONE runtime canvas texture (1024², 1 draw call):
 * colored sectors ∝ pot share, separator spokes, initial avatar + name + %
 * along each sector's bisector. Redrawn once more at the win to dim everyone
 * but the winner.
 */

export const WHEEL_PALETTE = [
  '#22d3ee',
  '#a855f7',
  '#f59e0b',
  '#34d399',
  '#f472b6',
  '#60a5fa',
  '#fb7185',
  '#4ade80',
] as const;

const MIN_FRAC = 0.055; // smallest stake still readable as a wedge

export interface WheelLayout {
  /** start/end angle of each wedge (radians, CCW from +x), aligned with players[] */
  arcs: { start: number; end: number; center: number }[];
}

export function wheelLayout(players: JackpotPlayer[]): WheelLayout {
  const weights = players.map((p) => Math.max(MIN_FRAC, p.chance));
  const total = weights.reduce((s, w) => s + w, 0);
  const arcs: WheelLayout['arcs'] = [];
  let angle = Math.PI / 2; // first wedge starts at the pointer (12 o'clock)
  for (const w of weights) {
    const span = (w / total) * Math.PI * 2;
    arcs.push({ start: angle, end: angle + span, center: angle + span / 2 });
    angle += span;
  }
  return { arcs };
}

export function drawWheelTexture(
  players: JackpotPlayer[],
  layout: WheelLayout,
  dimExceptIndex: number | null,
): CanvasTexture {
  const SIZE = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  const c = SIZE / 2;
  const R = SIZE / 2 - 8;
  if (ctx) {
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      const arc = layout.arcs[i];
      if (!player || !arc) continue;
      const color = WHEEL_PALETTE[i % WHEEL_PALETTE.length]!;
      const dim = dimExceptIndex !== null && dimExceptIndex !== i;
      // Sector — canvas y is flipped vs world, so negate the angles.
      // Saturated wheel-of-fortune fills: dark bold text stays readable.
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, R, -arc.end, -arc.start);
      ctx.closePath();
      const grad = ctx.createRadialGradient(c, c, R * 0.15, c, c, R);
      grad.addColorStop(0, `${color}${dim ? '30' : 'b3'}`);
      grad.addColorStop(1, `${color}${dim ? '40' : 'e6'}`);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = dim ? 'rgba(42,38,64,0.9)' : 'rgba(11,11,15,0.65)';
      ctx.lineWidth = 5;
      ctx.stroke();

      // Content along the bisector, rotated to stay readable.
      const name = player.username ?? shortAddress(player.walletAddress);
      const mid = -arc.center;
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(mid);
      const flip = Math.cos(mid) < 0 ? -1 : 1; // keep text upright on the left half
      if (flip === -1) ctx.rotate(Math.PI);
      const dir = flip;
      ctx.globalAlpha = dim ? 0.4 : 1;
      // avatar disc — dark plate, bright initial
      ctx.beginPath();
      ctx.arc(dir * R * 0.8, 0, 44, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(11,11,15,0.85)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 56px "Geist Sans", Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name.slice(0, 1).toUpperCase(), dir * R * 0.8, 3);
      // name + share — big, dark on the saturated wedge
      ctx.fillStyle = '#0b0b0f';
      ctx.font = '900 46px "Geist Sans", Inter, system-ui, sans-serif';
      ctx.textAlign = dir === 1 ? 'right' : 'left';
      ctx.fillText(name.slice(0, 10), dir * R * 0.64, -16);
      ctx.font = '800 40px "Geist Mono", ui-monospace, monospace';
      ctx.fillStyle = 'rgba(11,11,15,0.82)';
      ctx.fillText(`${(player.chance * 100).toFixed(0)}%`, dir * R * 0.64, 34);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // hub
    ctx.beginPath();
    ctx.arc(c, c, R * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = '#1C1930';
    ctx.fill();
    ctx.strokeStyle = 'rgba(238,134,255,0.5)';
    ctx.lineWidth = 4;
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
