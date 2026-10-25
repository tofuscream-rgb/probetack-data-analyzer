/**
 * Per-cycle mechanical metrics. Everything is computed in gf internally and
 * converted for display/export only, so the unit choice never changes results.
 */
import type { AnalysisSettings, Cycle, DisplacementMode, PeakMetric } from '../types';
import { GF_TO_N } from '../types';
import { mean, median, sampleSD } from './stats';

export interface Metrics {
  n: number;
  min: number;
  max: number;
  absPeak: number;
  mean: number;
  sd: number;
  tAtMin: number;
  tAtMax: number;
  zAtMin: number;
  zAtMax: number;
  dispAtMin: number;
  dispAtMax: number;
  baseline: number | null;
  baselineMin: number | null; // min(F − baseline)
}

export const PEAK_LABEL: Record<PeakMetric, string> = {
  min: 'Minimum force',
  max: 'Maximum force',
  absmax: 'Maximum absolute force',
  baselineMin: 'Baseline-corrected minimum (pull-off)',
};

export const DISPLACEMENT_LABEL: Record<DisplacementMode, string> = {
  signed: 'z − z₀ (signed, as recorded)',
  distance: '|z − z₀| (distance travelled)',
  inverted: 'z₀ − z (sign inverted)',
};

export function unitFactor(unit: 'gf' | 'N'): number {
  return unit === 'N' ? GF_TO_N : 1;
}

/**
 * Factor for every force that is displayed or exported: unit conversion × sign.
 * With 'positive', adhesion (recorded as negative force) is shown as a positive
 * number. Calculations and flags always use the recorded values in gf. Spreads,
 * such as SD, use Math.abs of this factor.
 */
export function displayFactor(s: Pick<AnalysisSettings, 'forceUnit' | 'forceSign'>): number {
  return unitFactor(s.forceUnit) * (s.forceSign === 'positive' ? -1 : 1);
}

/** Name of the selected peak metric as displayed, taking the sign setting into account. */
export function peakLabel(s: Pick<AnalysisSettings, 'peakMetric' | 'forceSign'>): string {
  if (s.forceSign !== 'positive') return PEAK_LABEL[s.peakMetric];
  if (s.peakMetric === 'min') return 'Peak adhesion force';
  if (s.peakMetric === 'baselineMin') return 'Baseline-corrected pull-off force';
  return `${PEAK_LABEL[s.peakMetric]} (sign inverted)`;
}

export const FORCE_SIGN_LABEL = {
  positive: 'Adhesion as positive force (sign inverted)',
  recorded: 'As recorded (adhesion is negative)',
} as const;

export function displacement(z: ArrayLike<number>, mode: DisplacementMode): Float64Array {
  const out = new Float64Array(z.length);
  if (z.length === 0) return out;
  const z0 = z[0];
  for (let i = 0; i < z.length; i++) {
    const d = z[i] - z0;
    out[i] = mode === 'signed' ? d : mode === 'distance' ? Math.abs(d) : -d;
  }
  return out;
}

/**
 * Baseline force, or null when baseline correction is off or not computable.
 *  - holdMean: mean force over the last N seconds of the preceding Wait block.
 *  - moveInterval: mean force within [t0, t1] seconds of the movement itself.
 * The baseline region is never guessed automatically.
 */
export function computeBaseline(c: Cycle, s: AnalysisSettings): { value: number | null; note: string } {
  if (s.baselineMode === 'none') return { value: null, note: 'Baseline correction off.' };
  if (s.baselineMode === 'holdMean') {
    if (!c.holdForce_gf || !c.holdTime_s || c.holdForce_gf.length === 0) {
      return { value: null, note: 'No hold data before this movement; baseline unavailable.' };
    }
    const tEnd = c.holdTime_s[c.holdTime_s.length - 1];
    const from = tEnd - s.baselineHoldLastS;
    const vals: number[] = [];
    for (let i = 0; i < c.holdForce_gf.length; i++) if (c.holdTime_s[i] >= from) vals.push(c.holdForce_gf[i]);
    return vals.length
      ? { value: mean(vals), note: `Mean of last ${s.baselineHoldLastS} s of hold (${vals.length} points).` }
      : { value: null, note: 'Hold interval empty.' };
  }
  const [a, b] = s.baselineInterval;
  const vals: number[] = [];
  for (let i = 0; i < c.force_gf.length; i++) if (c.time_s[i] >= a && c.time_s[i] <= b) vals.push(c.force_gf[i]);
  return vals.length
    ? { value: mean(vals), note: `Mean of movement interval ${a}–${b} s (${vals.length} points).` }
    : { value: null, note: `No points in movement interval ${a}–${b} s; baseline unavailable.` };
}

/** Metrics over points where include[i] is true (all points when include is undefined). */
export function computeMetrics(
  c: Cycle,
  s: AnalysisSettings,
  baseline: number | null,
  include?: ArrayLike<boolean>,
): Metrics {
  const disp = displacement(c.z_mm, s.displacementMode);
  let n = 0;
  let iMin = -1;
  let iMax = -1;
  const used: number[] = [];
  for (let i = 0; i < c.force_gf.length; i++) {
    if (include && !include[i]) continue;
    const f = c.force_gf[i];
    if (!Number.isFinite(f)) continue;
    n++;
    used.push(f);
    if (iMin < 0 || f < c.force_gf[iMin]) iMin = i; // first occurrence wins (deterministic)
    if (iMax < 0 || f > c.force_gf[iMax]) iMax = i;
  }
  const min = iMin >= 0 ? c.force_gf[iMin] : NaN;
  const max = iMax >= 0 ? c.force_gf[iMax] : NaN;
  const pick = (arr: ArrayLike<number>, i: number) => (i >= 0 && i < arr.length ? arr[i] : NaN);
  return {
    n,
    min,
    max,
    absPeak: n ? Math.max(Math.abs(min), Math.abs(max)) : NaN,
    mean: mean(used),
    sd: sampleSD(used),
    tAtMin: pick(c.time_s, iMin),
    tAtMax: pick(c.time_s, iMax),
    zAtMin: pick(c.z_mm, iMin),
    zAtMax: pick(c.z_mm, iMax),
    dispAtMin: pick(disp, iMin),
    dispAtMax: pick(disp, iMax),
    baseline,
    baselineMin: baseline === null || !n ? null : min - baseline,
  };
}

export function peakValue(m: Metrics, metric: PeakMetric): number {
  switch (metric) {
    case 'min':
      return m.min;
    case 'max':
      return m.max;
    case 'absmax':
      return m.absPeak;
    case 'baselineMin':
      return m.baselineMin ?? NaN;
  }
}

/** Reference force level used for QC: baseline if set, otherwise the median of the hold or the first points. */
export function referenceLevel(c: Cycle, baseline: number | null): number {
  if (baseline !== null) return baseline;
  if (c.holdForce_gf && c.holdForce_gf.length) return median(c.holdForce_gf);
  return median(c.force_gf.slice(0, Math.min(10, c.force_gf.length)));
}
