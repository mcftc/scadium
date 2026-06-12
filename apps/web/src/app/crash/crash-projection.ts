/**
 * Shared crash-plot projection — extracted verbatim from CrashTrail so the SVG
 * fallback, the DOM cashout chips and the 3D scene all pin to the SAME curve.
 *
 * The engine grows the multiplier exponentially (`m(t) = GROWTH_RATE^(t/10)`),
 * so the characteristic hockey stick comes from plotting TIME on x and the
 * MULTIPLIER on y:
 *   x ∝ ln(v)   (elapsed time is proportional to ln of the multiplier)
 *   y ∝ v       (linear in the multiplier value)
 * The axes auto-range with the live multiplier so the tip floats ~70% up.
 */

export interface CrashAxes {
  m: number;
  yMax: number;
  lnX: number;
}

export function crashAxes(multiplier: number): CrashAxes {
  const m = Math.max(1.0001, multiplier);
  const yMax = Math.max(2, m * 1.45); // headroom so the tip sits ~69% up
  const lnX = Math.log(Math.max(2.2, m * 1.5)); // time scale → keeps the tip off the edge
  return { m, yMax, lnX };
}

/** Normalized plot fractions (0..1 on each axis) for a multiplier value v. */
export function toFrac(v: number, axes: CrashAxes): { fx: number; fy: number } {
  const fx = Math.min(0.84, Math.log(Math.max(1.0001, v)) / axes.lnX);
  const fy = Math.max(1.0001, v) / axes.yMax;
  return { fx, fy };
}

/** Legacy percentage coordinates used by the DOM overlays (cashout chips). */
export function toXY(v: number, axes: CrashAxes): { x: number; y: number } {
  const { fx, fy } = toFrac(v, axes);
  return { x: 6 + fx * 82, y: 94 - fy * 84 };
}

/** Number of segments used to tessellate the curve (shared by SVG + 3D). */
export const CURVE_STEPS = 72;

/** Geometric sweep 1 → m, matching the SVG path generator. */
export function sweepValues(m: number, steps = CURVE_STEPS): number[] {
  const values: number[] = [];
  for (let i = 0; i <= steps; i++) values.push(Math.pow(m, i / steps));
  return values;
}
