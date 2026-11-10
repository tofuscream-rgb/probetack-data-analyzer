/**
 * Probe-tack metrics of one run (the tensile part of the pull), in addition to the
 * peak-force analysis of the Data analysis tab.
 *
 * Tensile force T = −Fz (the instrument records pulling as negative), in N.
 * δ is the distance travelled, |z − z₀|, measured from the point where the force first
 * becomes tensile before the peak (the zero crossing, found by linear interpolation).
 *
 *   F_max, δ_peak             largest T and its δ
 *   σ_max = F_max / A          A = π d² / 4
 *   δ_max                      first δ after the peak where T ≤ 2% F_max (interpolated);
 *                              end of data if never (then "detachment incomplete")
 *   W = (1/A) ∫ T dδ           trapezoidal rule from the tensile onset to δ_max, in J/m²
 *   ε_max = δ_max / h₀ (strain at break), ε_peak = δ_peak / h₀ (strain at peak stress)
 *   k                          least-squares slope of T vs δ on the loading branch between
 *                              10% and 60% of F_max; C = 1/k; E_app = k h₀ / A
 *   plateau                    after the peak, the longest stretch where T stays within ±20%
 *                              of one level (max/min ≤ 1.2/0.8); > 0.3 mm → plateau stress
 *                              (mean T / A) and length (no classification of the curve)
 *   dwell                      Fz at the start and end of the preceding Wait section
 *                              (compression positive) and the relaxation in %
 *
 * Raw data are never modified; nothing throws.
 */
import { GF_TO_N } from '../types';

export interface TackMetricInput {
  z_mm: ArrayLike<number>;
  force_gf: ArrayLike<number>;
  holdForce_gf: ArrayLike<number> | null;
  /** Force reading removed by a Zero Load step after the dwell (gf), if any. */
  zeroedGf?: number | null;
}

export interface TackMetricOptions {
  /** Probe diameter d (mm). */
  diameterMm: number;
  /** Gel thickness h₀ (mm); null = strain and apparent modulus are skipped. */
  h0Mm: number | null;
  /** End of detachment, fraction of F_max (default 0.02). */
  endFraction?: number;
  /** Slope window, fractions of F_max (default 0.10–0.60). */
  slopeFrom?: number;
  slopeTo?: number;
  /** Plateau: ± tolerance around the level (default 0.20) and minimum length in mm (default 0.3). */
  plateauTol?: number;
  plateauMinMm?: number;
}

export const TACK_DEFAULTS = { endFraction: 0.02, slopeFrom: 0.1, slopeTo: 0.6, plateauTol: 0.2, plateauMinMm: 0.3 };
/** Below this many force-resolution steps at F_max, the run is flagged as coarse. */
export const LOW_RESOLUTION_STEPS = 10;

export interface TackMetrics {
  ok: boolean;
  error: string | null;
  areaMm2: number;
  fmaxN: number;
  sigmaMaxKPa: number;
  deltaPeakMm: number;
  deltaMaxMm: number;
  wJm2: number;
  epsMax: number | null;
  /** Strain at peak stress, δ_peak / h₀. */
  epsPeak: number | null;
  kNmm: number | null;
  complianceMmN: number | null;
  eAppKPa: number | null;
  /** Fitted line T = k δ + b over the slope window (for the plot). */
  fit: { k: number; b: number; fromMm: number; toMm: number; n: number } | null;
  plateau: { stressKPa: number; lengthMm: number; fromMm: number; toMm: number; levelN: number } | null;
  dwell: { startN: number; endN: number; relaxPct: number } | null;
  /** The pull ended before T fell to ≤ 2% F_max: W and δ_max are underestimated. */
  incomplete: boolean;
  /** Smallest force step in the run (N) and F_max in such steps; few steps = coarse metrics. */
  resolutionN: number | null;
  peakSteps: number | null;
  /** Force zeroed after the dwell (N): forces are measured from the end of the dwell. */
  zeroedN: number | null;
  notes: string[];
  /** Curve for plotting: δ from the tensile onset (mm) and T (N). */
  curve: { deltaMm: Float64Array; tN: Float64Array };
}

const nan = NaN;

export function analyzeTack(run: TackMetricInput, o: TackMetricOptions): TackMetrics {
  const endFraction = o.endFraction ?? TACK_DEFAULTS.endFraction;
  const slopeFrom = o.slopeFrom ?? TACK_DEFAULTS.slopeFrom;
  const slopeTo = o.slopeTo ?? TACK_DEFAULTS.slopeTo;
  const tol = o.plateauTol ?? TACK_DEFAULTS.plateauTol;
  const minLen = o.plateauMinMm ?? TACK_DEFAULTS.plateauMinMm;
  const area = o.diameterMm > 0 ? (Math.PI * o.diameterMm * o.diameterMm) / 4 : nan;
  const h0 = o.h0Mm !== null && o.h0Mm > 0 ? o.h0Mm : null;
  const notes: string[] = [];

  // Valid points only (finite z and force), in recorded order.
  const d: number[] = [];
  const t: number[] = [];
  const n0 = Math.min(run.z_mm.length, run.force_gf.length);
  const z0 = n0 ? run.z_mm[0] : 0;
  for (let i = 0; i < n0; i++) {
    const z = run.z_mm[i];
    const f = run.force_gf[i];
    if (Number.isFinite(z) && Number.isFinite(f)) {
      d.push(Math.abs(z - z0));
      t.push(-f * GF_TO_N);
    }
  }
  const dwell = dwellOf(run.holdForce_gf);
  const base: TackMetrics = {
    ok: false, error: null, areaMm2: area, fmaxN: nan, sigmaMaxKPa: nan, deltaPeakMm: nan, deltaMaxMm: nan, wJm2: nan,
    epsMax: null, epsPeak: null, kNmm: null, complianceMmN: null, eAppKPa: null, fit: null, plateau: null,
    dwell, incomplete: false, resolutionN: null, peakSteps: null, zeroedN: run.zeroedGf !== null && run.zeroedGf !== undefined ? run.zeroedGf * GF_TO_N : null,
    notes, curve: { deltaMm: new Float64Array(), tN: new Float64Array() },
  };
  if (!(area > 0)) return { ...base, error: 'Enter the probe diameter.' };
  if (d.length < 3) return { ...base, error: 'Fewer than 3 valid points with position and force.' };

  let ip = 0;
  for (let i = 1; i < t.length; i++) if (t[i] > t[ip]) ip = i;
  const fmax = t[ip];
  if (!(fmax > 0)) return { ...base, error: 'The force never becomes tensile (no pulling force).' };

  // Tensile onset: start of the positive stretch that contains the peak.
  let j = ip;
  while (j > 0 && t[j - 1] > 0) j--;
  let dOn: number;
  if (j === 0) {
    dOn = d[0];
    notes.push('The force is tensile from the first point; δ starts there.');
  } else {
    const f = -t[j - 1] / (t[j] - t[j - 1]);
    dOn = d[j - 1] + f * (d[j] - d[j - 1]);
  }
  const delta = d.map((v) => v - dOn);

  // End of detachment: first point after the peak at or below 2% F_max.
  const level = endFraction * fmax;
  let ie = -1;
  for (let i = ip + 1; i < t.length; i++) if (t[i] <= level) { ie = i; break; }
  let incomplete = false;
  let deltaMax: number;
  let tEnd: number;
  if (ie < 0) {
    incomplete = true;
    ie = t.length;
    deltaMax = delta[t.length - 1];
    tEnd = t[t.length - 1];
    notes.push(`Detachment incomplete – W underestimated: the pull ended before the force returned to ≤ ${endFraction * 100}% of F_max.`);
  } else {
    const f = (t[ie - 1] - level) / (t[ie - 1] - t[ie]);
    deltaMax = delta[ie - 1] + f * (delta[ie] - delta[ie - 1]);
    tEnd = level;
  }

  // Work: trapezoids from (0, 0) at the onset through the points to (δ_max, T_end).
  const px: number[] = [0];
  const py: number[] = [0];
  for (let i = j; i < ie; i++) { px.push(delta[i]); py.push(t[i]); }
  if (!incomplete) { px.push(deltaMax); py.push(tEnd); }
  let work = 0; // N·mm
  for (let i = 1; i < px.length; i++) work += ((py[i] + py[i - 1]) / 2) * (px[i] - px[i - 1]);
  const wJm2 = (work / area) * 1000; // N·mm / mm² = N/mm = 1000 J/m²

  // Initial stiffness: loading branch (onset → peak), 10–60% of F_max.
  const fx: number[] = [];
  const fy: number[] = [];
  for (let i = j; i <= ip; i++) if (t[i] >= slopeFrom * fmax && t[i] <= slopeTo * fmax) { fx.push(delta[i]); fy.push(t[i]); }
  let fit: TackMetrics['fit'] = null;
  if (fx.length >= 3) {
    const mx = fx.reduce((s, v) => s + v, 0) / fx.length;
    const my = fy.reduce((s, v) => s + v, 0) / fy.length;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < fx.length; i++) { sxx += (fx[i] - mx) ** 2; sxy += (fx[i] - mx) * (fy[i] - my); }
    if (sxx > 0 && sxy > 0) {
      const k = sxy / sxx;
      fit = { k, b: my - k * mx, fromMm: Math.min(...fx), toMm: Math.max(...fx), n: fx.length };
    }
  }
  if (!fit) notes.push(`Initial stiffness not computed: fewer than 3 points between ${slopeFrom * 100}% and ${slopeTo * 100}% of F_max on the loading branch.`);

  // Plateau after the peak (before the end of detachment): longest window with max ≤ (1+tol)/(1−tol) × min.
  const ratio = (1 + tol) / (1 - tol);
  let best: { a: number; b: number } | null = null;
  const qMax: number[] = [];
  const qMin: number[] = [];
  let a = ip;
  for (let b = ip; b < ie; b++) {
    while (qMax.length && t[qMax[qMax.length - 1]] <= t[b]) qMax.pop();
    qMax.push(b);
    while (qMin.length && t[qMin[qMin.length - 1]] >= t[b]) qMin.pop();
    qMin.push(b);
    while (a <= b && t[qMax[0]] > ratio * t[qMin[0]]) {
      a++;
      if (qMax[0] < a) qMax.shift();
      if (qMin[0] < a) qMin.shift();
    }
    if (a <= b && (!best || delta[b] - delta[a] > delta[best.b] - delta[best.a])) best = { a, b };
  }
  let plateau: TackMetrics['plateau'] = null;
  if (best && delta[best.b] - delta[best.a] > minLen) {
    let s = 0;
    for (let i = best.a; i <= best.b; i++) s += t[i];
    const lvl = s / (best.b - best.a + 1);
    plateau = { levelN: lvl, stressKPa: (lvl / area) * 1000, lengthMm: delta[best.b] - delta[best.a], fromMm: delta[best.a], toMm: delta[best.b] };
  }

  // Force resolution: smallest step between distinct recorded force values.
  const uniq = [...new Set(t.map((v) => Math.round(v * 1e9) / 1e9))].sort((x, y) => x - y);
  let res = Infinity;
  for (let i = 1; i < uniq.length; i++) if (uniq[i] - uniq[i - 1] > 1e-9) res = Math.min(res, uniq[i] - uniq[i - 1]);
  const resolutionN = Number.isFinite(res) ? res : null;
  const peakSteps = resolutionN ? fmax / resolutionN : null;
  if (peakSteps !== null && peakSteps < LOW_RESOLUTION_STEPS) notes.push(`F_max is only ${peakSteps.toFixed(1)} force steps of ${resolutionN!.toFixed(4)} N: stiffness, plateau and relaxation are approximate.`);
  if (base.zeroedN !== null) notes.push(`Load cell zeroed after the dwell (${base.zeroedN.toFixed(4)} N removed): forces are measured from the end of the dwell.`);

  return {
    ...base,
    ok: true,
    resolutionN,
    peakSteps,
    fmaxN: fmax,
    sigmaMaxKPa: (fmax / area) * 1000,
    deltaPeakMm: delta[ip],
    deltaMaxMm: deltaMax,
    wJm2,
    epsMax: h0 !== null ? deltaMax / h0 : null,
    epsPeak: h0 !== null ? delta[ip] / h0 : null,
    kNmm: fit ? fit.k : null,
    complianceMmN: fit ? 1 / fit.k : null,
    eAppKPa: fit && h0 !== null ? ((fit.k * h0) / area) * 1000 : null,
    fit,
    plateau,
    incomplete,
    curve: { deltaMm: Float64Array.from(delta), tN: Float64Array.from(t) },
  };
}

/** Fz at the start and end of the Wait section (compression positive, as recorded) and the relaxation in %. */
function dwellOf(hold: ArrayLike<number> | null): TackMetrics['dwell'] {
  if (!hold || !hold.length) return null;
  let first = NaN;
  let last = NaN;
  for (let i = 0; i < hold.length; i++) if (Number.isFinite(hold[i])) { first = hold[i]; break; }
  for (let i = hold.length - 1; i >= 0; i--) if (Number.isFinite(hold[i])) { last = hold[i]; break; }
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  const startN = first * GF_TO_N;
  const endN = last * GF_TO_N;
  return { startN, endN, relaxPct: Math.abs(startN) > 1e-9 ? ((startN - endN) / startN) * 100 : NaN };
}

/** Mean and sample SD (n − 1) of the finite values. */
export function meanSd(values: (number | null)[]): { mean: number; sd: number; n: number } {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x));
  if (!v.length) return { mean: NaN, sd: NaN, n: 0 };
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : NaN;
  return { mean: m, sd, n: v.length };
}
