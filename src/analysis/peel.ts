/**
 * 90° peel analysis of one Mach-1 run (a hydrogel strip peeled from a substrate
 * on a sliding stage, so the peel angle stays at 90°).
 *
 * Reported, following ASTM D6862 / ISO 8510-1 and common hydrogel practice:
 *   - peak force (and the initiation peak before the steady state),
 *   - average (plateau) peel force F̄ over a stated steady-state window, with its
 *     SD, CV, minimum and maximum,
 *   - peel strength F̄ / w (N/mm and N/m),
 *   - peel energy G = F̄ / w · (1 − cos θ) (J/m²; = F̄ / w at 90°), the energy release
 *     rate of a steady peel of an inextensible strip (Rivlin 1944; Kendall 1975 without
 *     the elastic term), shown before 1.10 as "apparent interfacial toughness Γ",
 *   - work (area under force–displacement), work to detachment and work per
 *     peeled area W / (w · peeled length), an energy-based check of Γ,
 *   - peeled length, peel rate, failure mode.
 *
 * The force–displacement processing (valid points, |z − z₀|, loading direction,
 * baseline, peak, envelope integration, end-of-peeling detection) is shared with
 * the lap-shear analysis. Raw data are never modified; nothing throws.
 */
import type { Cycle, LapShearSettings, PeelRunMeta, PeelSettings } from '../types';
import { GF_TO_N } from '../types';
import { analyzeLapShear, describe, type LapShearResult, type RunInput } from './lapShear';
import { median } from './stats';

export interface PeelResult {
  ok: boolean;
  error: string | null;
  missing: string[];
  warnings: string[];
  /** Shared force–displacement analysis (series, peak, work, baseline, quality). */
  curve: LapShearResult;
  dims: { lengthMm: number; widthMm: number; thicknessMm: number; angleDeg: number };
  peak: { forceGf: number; forceN: number; dispMm: number; timeS: number; perWidthNm: number } | null;
  /** Largest force before the steady-state window (crack initiation). */
  initiationPeak: { forceN: number; dispMm: number } | null;
  /** End of peeling (complete detachment). */
  detach: { dispMm: number | null; source: 'auto' | 'manual' | 'none'; note: string };
  /** Peeled length used for the automatic window and the work per peeled area. */
  peeledLengthMm: number;
  window: { fromMm: number; toMm: number; source: 'auto' | 'custom'; n: number; note: string };
  plateau: { meanGf: number; meanN: number; medianN: number; sdN: number; cv: number; minN: number; maxN: number };
  /** F̄ / w. */
  peelStrengthNmm: number;
  peelStrengthNm: number;
  /** Γ = F̄ / w · (1 − cos θ). */
  toughnessJm2: number;
  work: { fullMJ: number; toDetachMJ: number | null; selectedMJ: number; selectedFromMm: number; selectedToMm: number; perPeeledAreaJm2: number };
  peelRateMmS: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Settings for the shared curve analysis: detachment plays the role of lap-shear failure. */
function curveSettings(s: PeelSettings): LapShearSettings {
  return {
    integration: s.integration.mode === 'window' ? { ...s.integration, mode: 'full' } : s.integration,
    baseline: s.baseline,
    failure: s.detach,
    direction: s.direction,
    gapFactor: s.gapFactor,
    defaults: { lengthMm: s.defaults.lengthMm, widthMm: s.defaults.widthMm, thicknessMm: s.defaults.thicknessMm },
  };
}

export function analyzePeel(run: RunInput, meta: PeelRunMeta, s: PeelSettings): PeelResult {
  const curve = analyzeLapShear(
    run,
    { lengthMm: meta.lengthMm, widthMm: meta.widthMm, thicknessMm: meta.thicknessMm, failureMode: meta.failureMode, manualFailureMm: meta.manualDetachMm },
    curveSettings(s),
  );
  const dims = { lengthMm: meta.lengthMm, widthMm: meta.widthMm, thicknessMm: meta.thicknessMm, angleDeg: meta.angleDeg };
  const warnings = curve.warnings.map((w) => w.replace('Overlap length', 'Gel length').replace('Overlap width', 'Gel width'));
  const w = meta.widthMm > 0 && Number.isFinite(meta.widthMm) ? meta.widthMm : NaN;
  const angleOk = Number.isFinite(meta.angleDeg) && meta.angleDeg > 0 && meta.angleDeg <= 180;
  if (!angleOk) warnings.push('Peel angle must be between 0 and 180°.');
  const nan = { meanGf: NaN, meanN: NaN, medianN: NaN, sdN: NaN, cv: NaN, minN: NaN, maxN: NaN };
  const base: PeelResult = {
    ok: curve.ok,
    error: curve.error,
    missing: curve.missing,
    warnings,
    curve,
    dims,
    peak: null,
    initiationPeak: null,
    detach: { dispMm: null, source: 'none', note: '' },
    peeledLengthMm: NaN,
    window: { fromMm: NaN, toMm: NaN, source: s.plateau.mode, n: 0, note: '' },
    plateau: nan,
    peelStrengthNmm: NaN,
    peelStrengthNm: NaN,
    toughnessJm2: NaN,
    work: { fullMJ: NaN, toDetachMJ: null, selectedMJ: NaN, selectedFromMm: NaN, selectedToMm: NaN, perPeeledAreaJm2: NaN },
    peelRateMmS: NaN,
  };
  if (!curve.ok || !curve.peak) return base;

  const { dispMm, loadGf } = curve.series;
  const time = run.time_s;
  let maxDisp = 0;
  for (let i = 0; i < dispMm.length; i++) if (Number.isFinite(dispMm[i]) && Number.isFinite(loadGf[i])) maxDisp = Math.max(maxDisp, dispMm[i]);
  const detach = {
    dispMm: curve.failure.dispMm,
    source: curve.failure.source,
    note: curve.failure.note.replace('Complete failure', 'Detachment').replace('Failure displacement', 'Detachment').replace('failure point', 'detachment point'),
  };
  const peeled = detach.dispMm ?? maxDisp;

  // ---- steady-state window ---------------------------------------------------------------
  let from: number;
  let to: number;
  let note: string;
  if (s.plateau.mode === 'custom') {
    from = Math.min(s.plateau.fromMm, s.plateau.toMm);
    to = Math.max(s.plateau.fromMm, s.plateau.toMm);
    note = `Custom window ${from}–${to} mm.`;
  } else {
    from = s.plateau.startFrac * peeled;
    to = s.plateau.endFrac * peeled;
    note = `Automatic window: ${(s.plateau.startFrac * 100).toFixed(0)}–${(s.plateau.endFrac * 100).toFixed(0)}% of the peeled length (${peeled.toFixed(2)} mm${detach.dispMm === null ? ', end of recording because no detachment was found' : ''}), so the initiation and the final release are excluded.`;
  }
  const inWin: number[] = [];
  for (let i = 0; i < dispMm.length; i++) if (Number.isFinite(loadGf[i]) && dispMm[i] >= from && dispMm[i] <= to) inWin.push(loadGf[i] * GF_TO_N);
  if (inWin.length < 5) warnings.push(`Only ${inWin.length} point(s) in the steady-state window ${from.toFixed(2)}–${to.toFixed(2)} mm; the plateau force is not reliable.`);
  const d = describe(inWin);
  const plateau = inWin.length
    ? { meanGf: d.mean / GF_TO_N, meanN: d.mean, medianN: median(inWin), sdN: d.sd, cv: d.sd / Math.abs(d.mean), minN: Math.min(...inWin), maxN: Math.max(...inWin) }
    : nan;

  // ---- initiation peak (largest force before the window) ------------------------------------
  let init: PeelResult['initiationPeak'] = null;
  for (let i = 0; i < dispMm.length; i++) {
    if (!Number.isFinite(loadGf[i]) || !(dispMm[i] < from)) continue;
    const f = loadGf[i] * GF_TO_N;
    if (!init || f > init.forceN) init = { forceN: f, dispMm: dispMm[i] };
  }

  // ---- peel rate over the window (least-squares slope of δ vs t) -----------------------------
  let sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0;
  for (let i = 0; i < dispMm.length; i++) {
    if (!Number.isFinite(dispMm[i]) || !Number.isFinite(time[i]) || dispMm[i] < from || dispMm[i] > to) continue;
    sx += time[i]; sy += dispMm[i]; sxx += time[i] * time[i]; sxy += time[i] * dispMm[i]; n++;
  }
  const rate = n > 2 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : NaN;

  const factor = angleOk ? 1 - Math.cos(rad(meta.angleDeg)) : NaN;
  const strengthNmm = plateau.meanN / w;
  const toDetach = curve.work.toFailureMJ;
  // Work in the steady-state window: the same integration, limited to the window.
  const sel = s.integration.mode === 'window'
    ? analyzeLapShear(
        run,
        { lengthMm: meta.lengthMm, widthMm: meta.widthMm, thicknessMm: meta.thicknessMm, failureMode: meta.failureMode, manualFailureMm: meta.manualDetachMm },
        { ...curveSettings(s), integration: { mode: 'custom', fromMm: from, toMm: to } },
      ).work
    : curve.work;
  return {
    ...base,
    warnings,
    peak: { ...curve.peak, perWidthNm: (curve.peak.forceN / w) * 1000 },
    initiationPeak: init,
    detach,
    peeledLengthMm: peeled,
    window: { fromMm: from, toMm: to, source: s.plateau.mode, n: inWin.length, note },
    plateau,
    peelStrengthNmm: strengthNmm,
    peelStrengthNm: strengthNmm * 1000,
    toughnessJm2: strengthNmm * 1000 * factor,
    work: {
      fullMJ: curve.work.fullMJ,
      toDetachMJ: toDetach,
      selectedMJ: sel.selectedMJ,
      selectedFromMm: sel.selectedFromMm,
      selectedToMm: sel.selectedToMm,
      // W / (w × peeled length): mJ / mm² × 1000 = J/m²
      perPeeledAreaJm2: (((toDetach ?? curve.work.fullMJ) / (w * peeled)) * 1000),
    },
    peelRateMmS: rate,
  };
}

export function analyzePeelCycle(c: Cycle, meta: PeelRunMeta, s: PeelSettings): PeelResult {
  return analyzePeel({ time_s: c.time_s, z_mm: c.z_mm, force_gf: c.force_gf, amplitudeMm: c.amplitudeMm }, meta, s);
}

/** Results of a run, with the names shown in the app, in Excel and in Compare (keys are stored in projects and never change). */
export const PEEL_PROPERTIES: { key: string; label: string; unit: string; digits: number; get: (r: PeelResult) => number }[] = [
  { key: 'plateauN', label: 'Average peel force (steady state)', unit: 'N', digits: 4, get: (r) => r.plateau.meanN },
  { key: 'plateauGf', label: 'Average peel force (steady state)', unit: 'gf', digits: 2, get: (r) => r.plateau.meanGf },
  { key: 'strengthNm', label: 'Peel strength (avg. force / width)', unit: 'N/m', digits: 2, get: (r) => r.peelStrengthNm },
  { key: 'strengthNmm', label: 'Peel strength (avg. force / width)', unit: 'N/mm', digits: 4, get: (r) => r.peelStrengthNmm },
  { key: 'toughness', label: 'Peel energy G', unit: 'J/m²', digits: 2, get: (r) => r.toughnessJm2 },
  { key: 'cv', label: 'Steady-state force variation (CV)', unit: '%', digits: 1, get: (r) => r.plateau.cv * 100 },
  { key: 'peakN', label: 'Peak force (maximum)', unit: 'N', digits: 4, get: (r) => r.peak?.forceN ?? NaN },
  { key: 'peakGf', label: 'Peak force (maximum)', unit: 'gf', digits: 2, get: (r) => r.peak?.forceGf ?? NaN },
  { key: 'peakNm', label: 'Peak force per width', unit: 'N/m', digits: 2, get: (r) => r.peak?.perWidthNm ?? NaN },
  { key: 'initN', label: 'Initiation peak force', unit: 'N', digits: 4, get: (r) => r.initiationPeak?.forceN ?? NaN },
  { key: 'dispPeak', label: 'Displacement at peak', unit: 'mm', digits: 3, get: (r) => r.peak?.dispMm ?? NaN },
  { key: 'peeled', label: 'Peeled length', unit: 'mm', digits: 2, get: (r) => r.peeledLengthMm },
  { key: 'wFull', label: 'Area under the graph (work), full curve', unit: 'mJ', digits: 3, get: (r) => r.work.fullMJ },
  { key: 'wDetach', label: 'Area under the graph (work) to detachment', unit: 'mJ', digits: 3, get: (r) => r.work.toDetachMJ ?? NaN },
  { key: 'wSel', label: 'Area under the graph (work), chosen range', unit: 'mJ', digits: 3, get: (r) => r.work.selectedMJ },
  { key: 'wArea', label: 'Work per peeled area', unit: 'J/m²', digits: 2, get: (r) => r.work.perPeeledAreaJm2 },
  { key: 'rate', label: 'Peel rate', unit: 'mm/s', digits: 3, get: (r) => r.peelRateMmS },
];

/** Definitions of the peel results, shown under the Results table and in the Excel settings sheet. */
export const PEEL_DEFINITIONS: [term: string, definition: string][] = [
  ['Steady-state window', 'The part of the curve where the peel front moves at a steady force. By default 20–80% of the peeled length (start of the run to detachment), so the initiation peak at the start and the final release before detachment are left out. You can change it, or type a displacement range in mm.'],
  ['Average peel force F̄ (steady state)', 'Mean of all force points inside the steady-state window (N and gf). This is the main result of a peel test.'],
  ['Steady-state force SD, CV and range', 'Spread of the force points inside the window. SD = sample standard deviation; CV (coefficient of variation) = SD / F̄ × 100%; range = lowest to highest force. A low CV (roughly below 10%) means a smooth, steady peel; a high CV means stick–slip, uneven bonding, or a window that still includes part of the initiation or the release.'],
  ['Peel strength', 'F̄ / w, the average peel force per gel width w (N/m and N/mm).'],
  ['Peel energy G', 'G = F̄ / w · (1 − cos θ), in J/m² (1 N/m = 1 J/m²). At 90°, 1 − cos θ = 1, so G = F̄ / w. It is the energy needed to peel one unit area of interface, assuming the gel strip does not stretch.'],
  ['Peak force (maximum)', 'The highest force anywhere in the run (N and gf), with its displacement. In many gel strips this is the last rise just before detachment, not the start of peeling, so compare it with the initiation peak.'],
  ['Initiation peak force', 'The highest force between the start of the run and the start of the steady-state window: the force needed to start the peel front.'],
  ['Peeled length and detachment', 'Detachment = first point after the peak where the force stays below 5% of the peak for 20 points in a row (adjustable; a typed value overrides it). Peeled length = displacement at detachment, or the end of the recording if no detachment is found.'],
  ['Area under the graph (work)', 'W = ∫ F dδ by the trapezoidal rule, in mJ: over the full curve, up to detachment, and over a chosen range (Settings › Work: full curve, start to peak, the steady-state window, or a custom mm range).'],
  ['Work per peeled area', 'Work to detachment / (w × peeled length), in J/m². An energy-based check of the peel energy G; the two are close for a steady peel.'],
  ['Peel rate', 'Slope of displacement against time inside the steady-state window (mm/s).'],
];
