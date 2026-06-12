'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { CanvasTexture, SRGBColorSpace, type Mesh } from 'three';

/**
 * Chart anatomy for the side-scroller flight, camera-anchored:
 *  - right edge: multiplier ruler (value ↔ altitude mapping, auto-ranging)
 *  - bottom edge: seconds axis whose ticks drift with the world stream
 * Both are single canvas-texture strips redrawn only when their content
 * actually changes; the rig drives them through handles — no React re-renders.
 */

export const ALT_PER_LOG = 0.42; // worldY = CRUISE_Y + ln(m) * ALT_PER_LOG
export const CRUISE_Y = 0.35;

export function altitudeOf(m: number): number {
  return Math.log(Math.max(1.0001, m)) * ALT_PER_LOG;
}

export interface SecondMark {
  sec: number;
  x: number; // world-x, drifted by the rig with everything else
}

export interface AxesHandles {
  update(
    camX: number,
    camY: number,
    displayM: number,
    marks: SecondMark[],
    levels: { v: number; y: number }[],
    visible: boolean,
  ): void;
}

const VIEW_HALF_H = 3.05; // half of the visible world height at the action plane
const RULER_W = 1.05;
const TIME_W = 9.2;
const TIME_H = 0.62;

/** 1-2-5 ladder of multiplier levels inside [vLo, vHi], with their altitudes. */
export function niceLevels(vLo: number, vHi: number): { v: number; y: number }[] {
  const levels: { v: number; y: number }[] = [];
  const LADDER = [1, 1.5, 2, 3, 5, 7, 10, 15, 20, 30, 50, 70, 100, 150, 200, 300, 500, 1000];
  for (const v of LADDER) {
    if (v >= vLo && v <= vHi) levels.push({ v, y: CRUISE_Y + Math.log(v) * ALT_PER_LOG });
    if (levels.length >= 10) break;
  }
  return levels;
}

export function ChartAxes({ handles }: { handles: { current: AxesHandles | null } }) {
  const rulerRef = useRef<Mesh>(null);
  const timeRef = useRef<Mesh>(null);

  const ruler = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 176;
    canvas.height = 1024;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return { canvas, texture, sig: '' };
  }, []);

  const time = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 72;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return { canvas, texture, last: 0 };
  }, []);

  const api = useMemo<AxesHandles>(
    () => ({
      update(camX, camY, displayM, marks, levels, visible) {
        const rulerMesh = rulerRef.current;
        const timeMesh = timeRef.current;
        if (!rulerMesh || !timeMesh) return;
        rulerMesh.visible = visible;
        timeMesh.visible = visible;
        if (!visible) return;

        // ---- right multiplier ruler — labels sit ON the backdrop lines ----
        rulerMesh.position.set(camX + 4.75, camY, 0.4);
        const yLo = camY - VIEW_HALF_H;
        const sig =
          levels.map((l) => l.v).join(',') + `:${camY.toFixed(2)}:${displayM.toFixed(1)}`;
        if (sig !== ruler.sig) {
          ruler.sig = sig;
          const ctx = ruler.canvas.getContext('2d');
          if (ctx) {
            const { width, height } = ruler.canvas;
            ctx.clearRect(0, 0, width, height);
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.font = '600 30px "Geist Mono", ui-monospace, monospace';
            for (const { v, y } of levels) {
              const yPix = (1 - (y - yLo) / (VIEW_HALF_H * 2)) * height;
              if (yPix < 20 || yPix > height - 20) continue;
              const active = displayM >= v;
              ctx.strokeStyle = active ? 'rgba(34,211,238,0.9)' : 'rgba(140,140,200,0.45)';
              ctx.lineWidth = active ? 5 : 3;
              ctx.beginPath();
              ctx.moveTo(0, yPix);
              ctx.lineTo(active ? 34 : 24, yPix);
              ctx.stroke();
              ctx.fillStyle = active ? '#67e8f9' : 'rgba(170,170,215,0.6)';
              ctx.shadowColor = active ? 'rgba(34,211,238,0.6)' : 'transparent';
              ctx.shadowBlur = active ? 10 : 0;
              ctx.fillText(`${Number.isInteger(v) ? v : v.toFixed(1)}x`, 42, yPix);
              ctx.shadowBlur = 0;
            }
          }
          ruler.texture.needsUpdate = true;
        }

        // ---- bottom seconds axis -----------------------------------------
        timeMesh.position.set(camX, camY - VIEW_HALF_H + 0.42, 0.4);
        const now = performance.now();
        if (now - time.last > 80) {
          time.last = now;
          const ctx = time.canvas.getContext('2d');
          if (ctx) {
            const { width, height } = time.canvas;
            ctx.clearRect(0, 0, width, height);
            ctx.strokeStyle = 'rgba(140,140,200,0.35)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(0, 8);
            ctx.lineTo(width, 8);
            ctx.stroke();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.font = '600 28px "Geist Mono", ui-monospace, monospace';
            for (const mark of marks) {
              const xPix = ((mark.x - (camX - TIME_W / 2)) / TIME_W) * width;
              if (xPix < 18 || xPix > width - 18) continue;
              ctx.strokeStyle = 'rgba(170,170,215,0.55)';
              ctx.beginPath();
              ctx.moveTo(xPix, 0);
              ctx.lineTo(xPix, 18);
              ctx.stroke();
              ctx.fillStyle = 'rgba(190,190,230,0.75)';
              ctx.fillText(`${mark.sec}s`, xPix, 26);
            }
          }
          time.texture.needsUpdate = true;
        }
      },
    }),
    [ruler, time],
  );
  handles.current = api;

  useLayoutEffect(() => {
    if (rulerRef.current) rulerRef.current.visible = false;
    if (timeRef.current) timeRef.current.visible = false;
  }, []);

  return (
    <>
      <mesh ref={rulerRef} renderOrder={15}>
        <planeGeometry args={[RULER_W, VIEW_HALF_H * 2]} />
        <meshBasicMaterial
          map={ruler.texture}
          transparent
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={timeRef} renderOrder={15}>
        <planeGeometry args={[TIME_W, TIME_H]} />
        <meshBasicMaterial
          map={time.texture}
          transparent
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </mesh>
    </>
  );
}
