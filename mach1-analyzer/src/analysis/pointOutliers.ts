/**
 * Level A — screening of individual points within one movement curve.
 *
 * Method (Hampel-type with an isolation check):
 *  1. rolling median m over ±halfWindow points; residual r = x − m
 *  2. local robust scale s = max(1.4826 · median|r| over the window, floor)
 *  3. Hampel z = |r| / s
 *  4. isolation = min over w = 1, 2 of |x − (x[i−w] + x[i+w]) / 2| / s
 *  5. robust z = min(Hampel z, isolation)
 * A point must depart from the local median AND from the line through its
 * immediate neighbours to be flagged.
 *
 * Why this is conservative for adhesion peaks:
 *  - A median filter follows monotonic ramps and steps exactly, so the steep
 *    loading and detachment parts of a curve produce near-zero residuals.
 *  - A broad peak (wider than the window) is followed by the median too.
 *  - Only short, isolated departures from the local trend (spikes of a few
 *    samples) produce large residuals.
 *  - Mach-1 forces are quantized (~0.5 gf steps here), so the local MAD is
 *    often exactly 0. The floor (default: one resolution step) prevents a
 *    single-step change from being called an outlier.
 *
 * The score maps z to 0–1 with score = z² / (z² + zHalf²). It is a severity
 * index for review, not a probability that the point is wrong.
 */
import type { PointOutlierSettings, QCClass } from '../types';
import { resolutionStep } from './stats';

export const QC_ORDER: QCClass[] = ['green', 'yellow', 'orange', 'red'];
export const QC_LABEL: Record<QCClass, string> = {
  green: 'Normal',
  yellow: 'Potential outlier',
  orange: 'Strongly suspicious',
  red: 'Outlier candidate — review',
};

export interface PointScores {
  score: Float64Array;
  z: Float64Array;
  localMedian: Float64Array;
  localScale: Float64Array;
  isolation: Float64Array;
  cls: Uint8Array; // index into QC_ORDER
  floorUsed: number;
  counts: [number, number, number, number];
  maxScore: number;
}

export function classify(score: number, s: { yellow: number; orange: number; red: number }): number {
  if (!(score >= s.yellow)) return 0;
  if (score < s.orange) return 1;
  if (score < s.red) return 2;
  return 3;
}

function medianOf(buf: number[]): number {
  buf.sort((a, b) => a - b);
  const m = buf.length >> 1;
  return buf.length % 2 ? buf[m] : (buf[m - 1] + buf[m]) / 2;
}

export function scorePoints(force: ArrayLike<number>, settings: PointOutlierSettings): PointScores {
  const n = force.length;
  const score = new Float64Array(n);
  const z = new Float64Array(n);
  const localMedian = new Float64Array(n);
  const localScale = new Float64Array(n);
  const isolation = new Float64Array(n);
  const cls = new Uint8Array(n);
  const counts: [number, number, number, number] = [0, 0, 0, 0];

  let floor = settings.scaleFloorGf;
  if (!(floor > 0)) {
    const step = resolutionStep(force);
    floor = Number.isFinite(step) ? step : 1e-6;
  }
  const k = Math.max(1, Math.floor(settings.halfWindow));
  const win: number[] = [];
  const resid = new Float64Array(n);

  // Pass 1: rolling median and residuals from it.
  for (let i = 0; i < n; i++) {
    win.length = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) if (Number.isFinite(force[j])) win.push(force[j]);
    const med = win.length ? medianOf(win) : NaN;
    localMedian[i] = med;
    resid[i] = Number.isFinite(force[i]) && Number.isFinite(med) ? force[i] - med : 0;
  }

  // Pass 2: robust local scale from the residuals (so smooth trends do not inflate it),
  // Hampel z, and an isolation check against the immediate neighbours.
  let maxScore = 0;
  for (let i = 0; i < n; i++) {
    win.length = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) win.push(Math.abs(resid[j]));
    const scale = Math.max(1.4826 * medianOf(win), floor);
    localScale[i] = scale;
    const zh = Math.abs(resid[i]) / scale;
    // Isolation: distance from the straight line through neighbours at ±1 and ±2 points.
    let iso = Infinity;
    for (let w = 1; w <= 2; w++) {
      if (i - w >= 0 && i + w < n) iso = Math.min(iso, Math.abs(force[i] - (force[i - w] + force[i + w]) / 2) / scale);
    }
    if (!Number.isFinite(iso)) iso = zh; // first/last points: Hampel only
    isolation[i] = iso;
    const zi = Number.isFinite(force[i]) ? Math.min(zh, iso) : 0;
    const si = (zi * zi) / (zi * zi + settings.zHalf * settings.zHalf);
    z[i] = zi;
    score[i] = si;
    const c = classify(si, settings);
    cls[i] = c;
    counts[c]++;
    if (si > maxScore) maxScore = si;
  }
  return { score, z, localMedian, localScale, isolation, cls, floorUsed: floor, counts, maxScore };
}

/** Human-readable explanation for one flagged point. */
export function explainPoint(p: PointScores, i: number, force: ArrayLike<number>, settings: PointOutlierSettings): string {
  const cls = QC_ORDER[p.cls[i]];
  const dev = force[i] - p.localMedian[i];
  const zh = Math.abs(dev) / p.localScale[i];
  const base = `Force ${force[i].toFixed(3)} gf is ${dev.toFixed(3)} gf from the ${2 * settings.halfWindow + 1}-point rolling median (${p.localMedian[i].toFixed(3)} gf): ${zh.toFixed(1)} × the local robust scale (${p.localScale[i].toFixed(3)} gf); isolation from neighbours ${p.isolation[i].toFixed(1)} ×. Robust z used = ${p.z[i].toFixed(2)} (the smaller of the two).`;
  if (cls === 'green') return `Normal. ${base}`;
  return `${QC_LABEL[cls]} (score ${p.score[i].toFixed(2)}). ${base} Isolated departures like this are typical of recording spikes; confirm visually before excluding.`;
}
