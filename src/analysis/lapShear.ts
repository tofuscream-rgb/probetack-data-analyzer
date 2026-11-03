/**
 * Lap-shear analysis of one Mach-1 movement (run).
 *
 * Measured quantities (no interpretation):
 *   peak loading force, displacement and time at peak,
 *   apparent nominal lap-shear strength τ = F_max / A, with A = overlap length × width,
 *   mechanical work W = ∫ F dδ (trapezoidal rule, N·mm = mJ), and W / A (J/m²).
 * Gel thickness is recorded but does not enter τ. Work per area is NOT called
 * adhesion energy or fracture toughness: it can include elastic deformation,
 * viscoelastic dissipation, cohesive damage, interfacial separation, frictional
 * sliding and fixture compliance.
 *
 * Raw arrays are never modified. Every function returns a complete, documented
 * object (`LapShearResult`); problems are reported in `error` / `warnings`,
 * never thrown.
 */
import type { Cycle, LapShearDims, LapShearRunMeta, LapShearSettings } from '../types';
import { GF_TO_N } from '../types';
import { median } from './stats';

export const INTEGRATION_LABEL = {
  full: 'Full curve',
  toPeak: 'Start to peak',
  custom: 'Custom displacement range',
} as const;

export const FAILURE_MODE_LABEL = {
  unspecified: 'Not specified',
  adhesive: 'Adhesive',
  cohesive: 'Cohesive',
  mixed: 'Mixed',
} as const;

/** Columns a lap-shear run needs, as they appear in Mach-1 files. */
export const REQUIRED_COLUMNS = ['Time, s', 'Position (z), mm', 'Fz, gf'] as const;

/** One integrated piece of the loading envelope (displacement increasing beyond everything reached before). */
interface Segment {
  i: number; // start sample
  j: number; // end sample
  a: number; // start displacement (mm), may be clipped to the envelope
  b: number; // end displacement (mm)
  fa: number; // loading force at a (N)
  fb: number; // loading force at b (N)
}

export interface LapShearResult {
  /** False when the run cannot be analysed at all (see `error`). */
  ok: boolean;
  error: string | null;
  /** Required measurements that are absent from the file. */
  missing: string[];
  warnings: string[];
  nPoints: number;
  nValid: number;

  dims: LapShearDims;
  /** Bonded overlap area L × W (mm²); NaN when the dimensions are invalid. */
  areaMm2: number;

  /** +1: loading force recorded as positive; −1: recorded as negative (shown as positive magnitude). */
  loadingSign: 1 | -1;
  directionNote: string;
  baseline: { requested: boolean; applied: boolean; offsetGf: number | null; note: string };

  peak: { index: number; forceGf: number; forceN: number; dispMm: number; timeS: number } | null;
  strengthKPa: number;
  strengthMPa: number;

  work: {
    /** Loading work over the whole valid recorded curve (mJ). */
    fullMJ: number;
    /** From the start of loading to the peak (mJ). */
    toPeakMJ: number;
    /** After the peak (mJ). fullMJ = toPeakMJ + postPeakMJ. */
    postPeakMJ: number;
    /** Over the interval chosen in the settings (mJ). */
    selectedMJ: number;
    selectedFromMm: number;
    selectedToMm: number;
    /** Signed work including displacement reversals (Σ F̄ Δδ over all valid steps). */
    signedMJ: number;
    /** From the start to the failure displacement, when a failure point is known (mJ). */
    toFailureMJ: number | null;
    selectedPerAreaJm2: number;
    fullPerAreaJm2: number;
  };

  failure: { dispMm: number | null; index: number | null; source: 'auto' | 'manual' | 'none'; note: string };
  quality: { invalid: number; reversals: number; duplicates: number; gaps: number };

  /** Per-sample series for graphs and export (same length as the raw arrays; NaN where invalid). */
  series: {
    dispMm: Float64Array;
    /** Signed force after the optional baseline correction (gf). */
    forceGf: Float64Array;
    /** Loading force as a positive magnitude in the loading direction (gf). */
    loadGf: Float64Array;
    /** Cumulative loading work (mJ) at each sample. */
    cumWorkMJ: Float64Array;
  };
}

const EMPTY = new Float64Array(0);

/** Checks the overlap geometry; returns an error message or null. */
export function dimensionError(d: LapShearDims): string | null {
  const bad = (v: number) => !(typeof v === 'number' && Number.isFinite(v) && v > 0);
  if (bad(d.lengthMm)) return 'Overlap length must be a positive number of millimetres.';
  if (bad(d.widthMm)) return 'Overlap width must be a positive number of millimetres.';
  if (bad(d.thicknessMm)) return 'Gel thickness must be a positive number of millimetres.';
  return null;
}

/** τ (kPa) = F (N) / A (mm²) × 1000; τ (MPa) = F / A. */
export const strengthKPa = (forceN: number, areaMm2: number) => (forceN / areaMm2) * 1000;
/** W/A (J/m²) = W (mJ) × 1000 / A (mm²). */
export const workPerAreaJm2 = (workMJ: number, areaMm2: number) => (workMJ * 1000) / areaMm2;

function emptyResult(dims: LapShearDims, error: string, missing: string[] = [], nPoints = 0): LapShearResult {
  return {
    ok: false,
    error,
    missing,
    warnings: [],
    nPoints,
    nValid: 0,
    dims,
    areaMm2: dims.lengthMm * dims.widthMm,
    loadingSign: 1,
    directionNote: '',
    baseline: { requested: false, applied: false, offsetGf: null, note: '' },
    peak: null,
    strengthKPa: NaN,
    strengthMPa: NaN,
    work: { fullMJ: NaN, toPeakMJ: NaN, postPeakMJ: NaN, selectedMJ: NaN, selectedFromMm: NaN, selectedToMm: NaN, signedMJ: NaN, toFailureMJ: null, selectedPerAreaJm2: NaN, fullPerAreaJm2: NaN },
    failure: { dispMm: null, index: null, source: 'none', note: '' },
    quality: { invalid: 0, reversals: 0, duplicates: 0, gaps: 0 },
    series: { dispMm: EMPTY, forceGf: EMPTY, loadGf: EMPTY, cumWorkMJ: EMPTY },
  };
}

/** Work (mJ) of the envelope segments inside [lo, hi] mm, with the force interpolated at the exact limits. */
function workBetween(segs: Segment[], lo: number, hi: number): number {
  let w = 0;
  for (const s of segs) {
    const a = Math.max(lo, s.a);
    const b = Math.min(hi, s.b);
    if (!(b > a)) continue;
    const at = (x: number) => s.fa + ((s.fb - s.fa) * (x - s.a)) / (s.b - s.a);
    w += ((at(a) + at(b)) / 2) * (b - a);
  }
  return w;
}

export interface RunInput {
  time_s: ArrayLike<number>;
  z_mm: ArrayLike<number>;
  force_gf: ArrayLike<number>;
  /** Commanded amplitude (mm); its sign gives the pull direction when the data are ambiguous. */
  amplitudeMm?: number | null;
}

export function analyzeLapShear(run: RunInput, meta: LapShearRunMeta, s: LapShearSettings): LapShearResult {
  const dims: LapShearDims = { lengthMm: meta.lengthMm, widthMm: meta.widthMm, thicknessMm: meta.thicknessMm };
  const missing: string[] = [];
  if (!run.time_s.length) missing.push('Time, s');
  if (!run.z_mm.length) missing.push('Position (z), mm');
  if (!run.force_gf.length) missing.push('Fz, gf');
  if (missing.length) return emptyResult(dims, `Missing measurement(s): ${missing.join(', ')}. A lap-shear run needs time, position (z) and force.`, missing);
  const n = Math.min(run.time_s.length, run.z_mm.length, run.force_gf.length);
  const warnings: string[] = [];
  if (run.time_s.length !== run.z_mm.length || run.z_mm.length !== run.force_gf.length) warnings.push(`Columns have different lengths; only the first ${n} rows are used.`);

  const dimErr = dimensionError(dims);
  const area = dimErr ? NaN : dims.lengthMm * dims.widthMm;
  if (dimErr) warnings.push(dimErr);

  // ---- valid samples (finite time, position and force) --------------------------------
  const valid: number[] = [];
  for (let i = 0; i < n; i++) if (Number.isFinite(run.time_s[i]) && Number.isFinite(run.z_mm[i]) && Number.isFinite(run.force_gf[i])) valid.push(i);
  if (valid.length < 3) return { ...emptyResult(dims, 'Fewer than 3 valid measurements (time, position and force all finite).', [], n), nValid: valid.length };
  const invalid = n - valid.length;
  if (invalid) warnings.push(`${invalid} measurement(s) with missing or non-finite values were skipped.`);

  // ---- displacement relative to the start of the run, along the pull direction ----------
  const z0 = run.z_mm[valid[0]];
  const travel = run.z_mm[valid[valid.length - 1]] - z0;
  const dir = travel !== 0 ? Math.sign(travel) : Math.sign(run.amplitudeMm ?? 1) || 1;
  const disp = new Float64Array(n).fill(NaN);
  for (const i of valid) disp[i] = dir * (run.z_mm[i] - z0); // = |z − z₀| while the stage moves forward

  // ---- optional zero-force baseline -----------------------------------------------------
  const baseline = { requested: s.baseline.enabled, applied: false, offsetGf: null as number | null, note: 'Baseline correction off: raw force used.' };
  let offset = 0;
  if (s.baseline.enabled) {
    const m = Math.max(3, Math.round(s.baseline.points));
    const region = valid.slice(0, m).map((i) => run.force_gf[i]);
    const spread = Math.max(...region) - Math.min(...region);
    const med = median(region);
    let maxAbs = 0;
    for (const i of valid) maxAbs = Math.max(maxAbs, Math.abs(run.force_gf[i]));
    if (region.length < m) baseline.note = `Baseline not applied: fewer than ${m} valid points at the start.`;
    else if (spread > s.baseline.maxSpreadGf) baseline.note = `Baseline not applied: force in the first ${m} points varies by ${spread.toFixed(2)} gf (> ${s.baseline.maxSpreadGf} gf), so the region does not look unloaded.`;
    else if (maxAbs > 0 && Math.abs(med) > 0.2 * maxAbs) baseline.note = `Baseline not applied: the first ${m} points (median ${med.toFixed(2)} gf) are more than 20% of the largest force, so they may already be loaded.`;
    else {
      offset = med;
      baseline.applied = true;
      baseline.offsetGf = med;
      baseline.note = `Baseline applied: median of the first ${m} valid points = ${med.toFixed(3)} gf (spread ${spread.toFixed(2)} gf) subtracted from every force value.`;
    }
    if (!baseline.applied) warnings.push(baseline.note);
  }
  const forceGf = new Float64Array(n).fill(NaN);
  for (const i of valid) forceGf[i] = run.force_gf[i] - offset;

  // ---- loading direction ------------------------------------------------------------------
  let maxPos = 0;
  let maxNeg = 0;
  for (const i of valid) {
    maxPos = Math.max(maxPos, forceGf[i]);
    maxNeg = Math.max(maxNeg, -forceGf[i]);
  }
  const loadingSign: 1 | -1 = s.direction === 'negative' ? -1 : s.direction === 'positive' ? 1 : maxNeg > maxPos ? -1 : 1;
  const directionNote =
    s.direction === 'auto'
      ? loadingSign === -1
        ? `Loading force is recorded as negative (largest |F| = ${maxNeg.toFixed(2)} gf vs ${maxPos.toFixed(2)} gf positive); shown as a positive magnitude. Raw signed values are kept.`
        : `Loading force is recorded as positive (largest F = ${maxPos.toFixed(2)} gf vs ${maxNeg.toFixed(2)} gf negative).`
      : `Loading direction set manually: ${loadingSign === -1 ? 'negative' : 'positive'} recorded force = loading.`;
  const loadGf = new Float64Array(n).fill(NaN);
  for (const i of valid) loadGf[i] = loadingSign * forceGf[i];

  // ---- peak -------------------------------------------------------------------------------
  let ip = valid[0];
  for (const i of valid) if (loadGf[i] > loadGf[ip]) ip = i;
  const peakGf = loadGf[ip];
  if (!(peakGf > 0)) warnings.push('No loading force in the chosen direction was found; peak and strength are not meaningful.');
  const peak = { index: ip, forceGf: peakGf, forceN: peakGf * GF_TO_N, dispMm: disp[ip], timeS: run.time_s[ip] };

  // ---- integration over the loading envelope ----------------------------------------------
  const dts: number[] = [];
  for (let k = 1; k < valid.length; k++) {
    const dt = run.time_s[valid[k]] - run.time_s[valid[k - 1]];
    if (dt > 0) dts.push(dt);
  }
  const dtMed = dts.length ? median(dts) : NaN;
  const segs: Segment[] = [];
  const cum = new Float64Array(n).fill(NaN);
  let reach = disp[valid[0]];
  let signed = 0;
  let total = 0;
  let reversals = 0;
  let duplicates = 0;
  let gaps = 0;
  cum[valid[0]] = 0;
  for (let k = 1; k < valid.length; k++) {
    const i = valid[k - 1];
    const j = valid[k];
    const dt = run.time_s[j] - run.time_s[i];
    const gap = j - i > 1 || !(dt > 0) || (Number.isFinite(dtMed) && dt > s.gapFactor * dtMed);
    const dd = disp[j] - disp[i];
    if (gap) {
      gaps++;
      reach = Math.max(reach, disp[j]); // never integrate across a gap
    } else if (dd === 0) {
      duplicates++;
    } else {
      const fi = loadGf[i] * GF_TO_N;
      const fj = loadGf[j] * GF_TO_N;
      signed += ((fi + fj) / 2) * dd;
      if (dd < 0) reversals++;
      else if (disp[j] > reach) {
        // Only displacement beyond everything reached before counts, so retraction and re-loading are not counted twice.
        const a = Math.max(disp[i], reach);
        const fa = fi + ((fj - fi) * (a - disp[i])) / dd;
        segs.push({ i, j, a, b: disp[j], fa, fb: fj });
        total += ((fa + fj) / 2) * (disp[j] - a);
        reach = disp[j];
      }
    }
    cum[j] = total;
  }
  if (reversals) warnings.push(`${reversals} displacement reversal(s): backward steps are excluded from loading work (they are kept in the signed work).`);
  if (duplicates) warnings.push(`${duplicates} step(s) without displacement change contribute no work.`);
  if (gaps) warnings.push(`${gaps} measurement gap(s): not integrated across.`);

  const toPeak = segs.filter((g) => g.j <= ip).reduce((w, g) => w + ((g.fa + g.fb) / 2) * (g.b - g.a), 0);
  const post = segs.filter((g) => g.i >= ip).reduce((w, g) => w + ((g.fa + g.fb) / 2) * (g.b - g.a), 0);
  const maxReach = segs.length ? segs[segs.length - 1].b : 0;

  let selFrom = 0;
  let selTo = maxReach;
  let selected = total;
  if (s.integration.mode === 'toPeak') {
    selTo = disp[ip];
    selected = toPeak;
  } else if (s.integration.mode === 'custom') {
    selFrom = Math.min(s.integration.fromMm, s.integration.toMm);
    selTo = Math.max(s.integration.fromMm, s.integration.toMm);
    if (!(Number.isFinite(selFrom) && Number.isFinite(selTo)) || selFrom === selTo) {
      warnings.push('Custom integration range is empty or invalid.');
      selected = NaN;
    } else {
      if (selTo > maxReach || selFrom < 0) warnings.push(`Custom range ${selFrom}–${selTo} mm extends beyond the recorded displacement 0–${maxReach.toFixed(3)} mm; only the recorded part is integrated.`);
      selected = workBetween(segs, selFrom, selTo);
    }
  }

  // ---- failure endpoint ----------------------------------------------------------------------
  const failure: LapShearResult['failure'] = { dispMm: null, index: null, source: 'none', note: 'No failure point: automatic detection is off and none was picked.' };
  if (meta.manualFailureMm !== null && Number.isFinite(meta.manualFailureMm)) {
    failure.dispMm = meta.manualFailureMm;
    failure.source = 'manual';
    failure.note = `Failure displacement picked by hand: ${meta.manualFailureMm} mm.`;
  } else if (s.failure.auto && peakGf > 0) {
    const thr = s.failure.fraction * peakGf;
    const need = Math.max(1, Math.round(s.failure.consecutive));
    let runStart = -1;
    let count = 0;
    for (const i of valid) {
      if (i <= ip) continue;
      if (loadGf[i] < thr) {
        if (count === 0) runStart = i;
        if (++count >= need) break;
      } else count = 0;
    }
    if (count >= need) {
      failure.index = runStart;
      failure.dispMm = disp[runStart];
      failure.source = 'auto';
      failure.note = `Complete failure: loading force fell below ${(s.failure.fraction * 100).toFixed(1)}% of the peak (${thr.toFixed(2)} gf) and stayed there for ${need} consecutive valid points.`;
    } else {
      failure.note = `Complete failure could not be identified: the force never stayed below ${(s.failure.fraction * 100).toFixed(1)}% of the peak for ${need} consecutive points. Failure displacement left blank.`;
    }
  }
  const toFailure = failure.dispMm !== null ? workBetween(segs, 0, failure.dispMm) : null;

  return {
    ok: true,
    error: null,
    missing: [],
    warnings,
    nPoints: n,
    nValid: valid.length,
    dims,
    areaMm2: area,
    loadingSign,
    directionNote,
    baseline,
    peak,
    strengthKPa: strengthKPa(peak.forceN, area),
    strengthMPa: peak.forceN / area,
    work: {
      fullMJ: total,
      toPeakMJ: toPeak,
      postPeakMJ: post,
      selectedMJ: selected,
      selectedFromMm: selFrom,
      selectedToMm: selTo,
      signedMJ: signed,
      toFailureMJ: toFailure,
      selectedPerAreaJm2: workPerAreaJm2(selected, area),
      fullPerAreaJm2: workPerAreaJm2(total, area),
    },
    failure,
    quality: { invalid, reversals, duplicates, gaps },
    series: { dispMm: disp, forceGf, loadGf, cumWorkMJ: cum },
  };
}

/** Analyse a parsed Mach-1 movement. */
export function analyzeLapShearCycle(c: Cycle, meta: LapShearRunMeta, s: LapShearSettings): LapShearResult {
  try {
    return analyzeLapShear({ time_s: c.time_s, z_mm: c.z_mm, force_gf: c.force_gf, amplitudeMm: c.amplitudeMm }, meta, s);
  } catch (e) {
    // Defensive: the analysis is written not to throw, but a broken file must never take the page down.
    return emptyResult({ lengthMm: meta.lengthMm, widthMm: meta.widthMm, thicknessMm: meta.thicknessMm }, `This run could not be analysed: ${(e as Error).message}`);
  }
}

/** Mean, sample SD (n − 1) and n of the finite values. */
export function describe(values: number[]): { mean: number; sd: number; n: number } {
  const v = values.filter(Number.isFinite);
  const n = v.length;
  if (!n) return { mean: NaN, sd: NaN, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  return { mean, sd, n };
}

/** The per-run properties that are summarised (each computed per run with its own area before averaging). */
export const SUMMARY_PROPERTIES: { key: string; label: string; unit: string; get: (r: LapShearResult) => number }[] = [
  { key: 'peakGf', label: 'Peak force', unit: 'gf', get: (r) => r.peak?.forceGf ?? NaN },
  { key: 'peakN', label: 'Peak force', unit: 'N', get: (r) => r.peak?.forceN ?? NaN },
  { key: 'tauKPa', label: 'Apparent nominal lap-shear strength', unit: 'kPa', get: (r) => r.strengthKPa },
  { key: 'tauMPa', label: 'Apparent nominal lap-shear strength', unit: 'MPa', get: (r) => r.strengthMPa },
  { key: 'dispPeak', label: 'Displacement at peak', unit: 'mm', get: (r) => r.peak?.dispMm ?? NaN },
  { key: 'tPeak', label: 'Time at peak', unit: 's', get: (r) => r.peak?.timeS ?? NaN },
  { key: 'wFull', label: 'Full-curve work', unit: 'mJ', get: (r) => r.work.fullMJ },
  { key: 'wPre', label: 'Work to peak', unit: 'mJ', get: (r) => r.work.toPeakMJ },
  { key: 'wPost', label: 'Post-peak work', unit: 'mJ', get: (r) => r.work.postPeakMJ },
  { key: 'wSel', label: 'Selected integration work', unit: 'mJ', get: (r) => r.work.selectedMJ },
  { key: 'wSelA', label: 'Selected work per bonded area', unit: 'J/m²', get: (r) => r.work.selectedPerAreaJm2 },
  { key: 'wFullA', label: 'Full-curve work per bonded area', unit: 'J/m²', get: (r) => r.work.fullPerAreaJm2 },
  { key: 'dispFail', label: 'Failure displacement', unit: 'mm', get: (r) => r.failure.dispMm ?? NaN },
  { key: 'wFail', label: 'Work to failure', unit: 'mJ', get: (r) => r.work.toFailureMJ ?? NaN },
];
