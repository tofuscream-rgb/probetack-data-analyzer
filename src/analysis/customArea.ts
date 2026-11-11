/**
 * User-selected area under a force–displacement curve (an additional tool; the
 * automatic metrics are not affected):
 *
 *   W_selected = ∫_{δ1}^{δ2} F dδ
 *
 * Trapezoidal rule over the recorded points, with the force interpolated linearly at the
 * exact boundaries δ1 and δ2. Segments are taken in recorded order, so a segment where δ
 * decreases counts negatively (back-and-forth movement cancels). F in N, δ in mm → N·mm = mJ.
 */
export interface CustomArea {
  fromMm: number | null;
  toMm: number | null;
}

export const EMPTY_AREA: CustomArea = { fromMm: null, toMm: null };

/** [δ1, δ2] with δ1 < δ2, or null when the limits are not both set. */
export function areaLimits(a: CustomArea | undefined): [number, number] | null {
  if (!a || a.fromMm === null || a.toMm === null || !Number.isFinite(a.fromMm) || !Number.isFinite(a.toMm) || a.fromMm === a.toMm) return null;
  return a.fromMm < a.toMm ? [a.fromMm, a.toMm] : [a.toMm, a.fromMm];
}

export interface AreaResult {
  /** ∫ F dδ over [δ1, δ2] in N·mm = mJ. */
  workMJ: number;
  /** The recorded displacement reaches both limits (otherwise only the recorded part is integrated). */
  covered: boolean;
}

export function integrateRange(x: ArrayLike<number>, fN: ArrayLike<number>, lo: number, hi: number): AreaResult {
  let w = 0;
  let xmin = Infinity;
  let xmax = -Infinity;
  const n = Math.min(x.length, fN.length);
  for (let i = 0; i < n; i++) if (Number.isFinite(x[i])) { xmin = Math.min(xmin, x[i]); xmax = Math.max(xmax, x[i]); }
  for (let i = 1; i < n; i++) {
    const x0 = x[i - 1], x1 = x[i], y0 = fN[i - 1], y1 = fN[i];
    if (![x0, x1, y0, y1].every(Number.isFinite) || x1 === x0) continue;
    const a = Math.max(Math.min(x0, x1), lo);
    const b = Math.min(Math.max(x0, x1), hi);
    if (!(b > a)) continue;
    const at = (xx: number) => y0 + ((y1 - y0) * (xx - x0)) / (x1 - x0);
    w += (Math.sign(x1 - x0) * (at(a) + at(b)) * (b - a)) / 2;
  }
  return { workMJ: w, covered: xmin <= lo && xmax >= hi };
}

/** Points of a displayed curve inside [lo, hi], with the interpolated boundary points (for shading). */
export function areaFillXY(x: ArrayLike<number>, y: ArrayLike<number>, lo: number, hi: number): { x: number[]; y: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue;
    if (i > 0 && Number.isFinite(x[i - 1]) && Number.isFinite(y[i - 1])) {
      for (const edge of [lo, hi]) {
        if ((x[i - 1] - edge) * (x[i] - edge) < 0) {
          xs.push(edge);
          ys.push(y[i - 1] + ((y[i] - y[i - 1]) * (edge - x[i - 1])) / (x[i] - x[i - 1]));
        }
      }
    }
    if (x[i] >= lo && x[i] <= hi) { xs.push(x[i]); ys.push(y[i]); }
  }
  return { x: xs, y: ys };
}

/** New limits from a Plotly relayout event after a boundary line (shape 0 = δ1, 1 = δ2) was dragged. */
export function areaFromRelayout(e: Record<string, unknown>, current: CustomArea, toMm: (x: number) => number = (v) => v): CustomArea | null {
  const pos = (k: number) => {
    const x0 = e[`shapes[${k}].x0`];
    const x1 = e[`shapes[${k}].x1`];
    const vals = [x0, x1].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return vals.length ? toMm(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  };
  const a = pos(0);
  const b = pos(1);
  if (a === null && b === null) return null;
  return { fromMm: a ?? current.fromMm, toMm: b ?? current.toMm };
}
