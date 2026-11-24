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
import { sourceText } from './references';

export interface PeelResult {
  ok: boolean;
  error: string | null;
  missing: string[];
  warnings: string[];
  /** Shared force–displacement analysis (series, peak, work, baseline, quality). */
  curve: LapShearResult;
  dims: { lengthMm: number; widthMm: number; thicknessMm: number; angleDeg: number };
  peak: { forceGf: number; forceN: number; dispMm: number; timeS: number; perWidthNm: number } | null;
  /** F_pre,max: largest loading force for 0 ≤ travel < start of the steady-state window, and its travel. */
  initiationPeak: { forceN: number; dispMm: number } | null;
  /**
   * Initiation metrics from F_pre,max: apparent peak energy G_pre = F_pre,max / w × (1 − cos θ) (J/m²)
   * and the peak/steady ratio F_pre,max / F̄_ss (–). NaN when there is no point before the window.
   */
  initiation: { gPreJm2: number; ratio: number };
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
  /** Post-detachment tare check of the uncorrected trace (null when the check is switched off). */
  tare: TareResult | null;
}

export interface TareResult {
  /** 'flagged' = possible tare offset; 'ok' = back to zero; 'cannotCheck' = no valid residual. */
  status: 'ok' | 'flagged' | 'cannotCheck';
  /** Why the run could not be checked (or '' ). */
  reason: string;
  /** Mean tensile force in the residual window (gf, tensile sign). */
  residualGf: number;
  /** Residual normalised like G_peel: residual × (gf→N) / w × (1 − cos θ), J/m². */
  residualJm2: number;
  /** Residual as % of the uncorrected steady-state plateau force. */
  residualPctPlateau: number;
  /** Mean of the second half of the window minus mean of the first half (gf). */
  driftGf: number;
  windowFromMm: number;
  windowToMm: number;
  nWindow: number;
  /** Where the window starts from: the detected (or typed) detachment, or where the force settles at the end. */
  detachFrom: 'detected' | 'settled' | 'none';
  detachMm: number | null;
  /** Mean Fz of the stationary block before <Zero Load> (as recorded), and the residual it predicts (tensile sign). */
  preTareGf: number | null;
  expectedGf: number | null;
  /** |expected − measured| > threshold. */
  mismatch: boolean;
  /** The residual can be subtracted (status ok or flagged). */
  valid: boolean;
  /** The correction is applied to this result. */
  applied: boolean;
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

/**
 * Peel analysis with the post-detachment tare check. The check always looks at the uncorrected
 * trace; when the run's tare correction is on and the residual is valid, the residual is subtracted
 * from the whole tensile-force trace and every result (plateau, G_peel, CV, work, …) is recomputed.
 */
export function analyzePeel(run: RunInput & { preTareGf?: number | null }, meta: PeelRunMeta, s: PeelSettings): PeelResult {
  const raw = analyzePeelCore(run, meta, s);
  const tc = s.tareCheck;
  if (!tc?.enabled || !raw.ok) return raw;
  const tare = checkTare(raw, run.preTareGf ?? null, tc);
  if (!(meta.tareCorrection?.applied && tare.valid)) return { ...raw, tare };
  // F_tensile' = F_tensile − r, and F_tensile = sign × Fz, so Fz' = Fz − sign × r.
  const sign = raw.curve.loadingSign;
  const force = Float64Array.from(run.force_gf, (v) => v - sign * tare.residualGf);
  const corrected = analyzePeelCore({ ...run, force_gf: force }, meta, { ...s, direction: sign < 0 ? 'negative' : 'positive' });
  return {
    ...corrected,
    warnings: [...corrected.warnings, `Tare corrected: ${tare.residualGf.toFixed(2)} gf subtracted from the whole tensile force trace.`],
    tare: { ...tare, applied: true },
  };
}

/**
 * Residual force after detachment. Window: from detachment + offset to the end of stage travel.
 * Detachment is the detected (or typed) one; when none was found — a constant offset can keep the
 * force above the detection threshold — it is where the force settles for good at the end.
 */
export function checkTare(r: PeelResult, preTareGf: number | null, tc: PeelSettings['tareCheck']): TareResult {
  const { dispMm, loadGf } = r.curve.series;
  const ip = r.curve.peak?.index ?? -1;
  const valid: number[] = [];
  for (let i = Math.max(0, ip); i < dispMm.length; i++) if (Number.isFinite(dispMm[i]) && Number.isFinite(loadGf[i])) valid.push(i);
  let maxDisp = -Infinity;
  for (const i of valid) maxDisp = Math.max(maxDisp, dispMm[i]);
  const w = r.dims.widthMm;
  const factor = 1 - Math.cos(rad(r.dims.angleDeg));
  const expectedGf = preTareGf !== null ? -r.curve.loadingSign * preTareGf : null;
  const base: TareResult = {
    status: 'cannotCheck', reason: '', residualGf: NaN, residualJm2: NaN, residualPctPlateau: NaN, driftGf: NaN,
    windowFromMm: NaN, windowToMm: NaN, nWindow: 0, detachFrom: 'none', detachMm: null, preTareGf, expectedGf, mismatch: false, valid: false, applied: false,
  };
  if (ip < 0 || valid.length < 3) return { ...base, reason: 'Cannot check: no peak or too few points.' };

  let detachMm: number | null = r.detach.dispMm;
  let detachFrom: TareResult['detachFrom'] = detachMm !== null ? 'detected' : 'none';
  if (detachMm === null) {
    // Settled level: median over the last minimum-window length of travel; detachment = start of the
    // final stretch within ±band of it (band: twice the threshold, or 5% of the peak height).
    const tail = valid.filter((i) => dispMm[i] >= maxDisp - Math.max(tc.minWindowMm, 0.5)).map((i) => loadGf[i]);
    const level = median(tail);
    const band = Math.max(2 * tc.thresholdGf, 0.05 * Math.abs(r.curve.peak!.forceGf - level));
    let k = valid.length - 1;
    while (k > 0 && Math.abs(loadGf[valid[k - 1]] - level) <= band) k--;
    if (valid[k] > ip) { detachMm = dispMm[valid[k]]; detachFrom = 'settled'; }
  }
  if (detachMm === null) return { ...base, reason: 'Cannot check: no detachment found.' };
  const from = detachMm + tc.windowOffsetMm;
  const to = maxDisp;
  const win = valid.filter((i) => dispMm[i] >= from && dispMm[i] <= to);
  const placed = { ...base, windowFromMm: from, windowToMm: to, nWindow: win.length, detachFrom, detachMm };
  if (!(to - from >= tc.minWindowMm) || win.length < 4) return { ...placed, reason: 'Cannot check: stage stopped at detachment.' };

  const vals = win.map((i) => loadGf[i]);
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const residualGf = mean(vals);
  const half = Math.floor(vals.length / 2);
  const driftGf = mean(vals.slice(half)) - mean(vals.slice(0, half));
  const measured = {
    ...placed,
    residualGf,
    driftGf,
    residualJm2: ((residualGf * GF_TO_N) / w) * 1000 * factor,
    residualPctPlateau: (residualGf / r.plateau.meanGf) * 100,
    mismatch: expectedGf !== null && Math.abs(expectedGf - residualGf) > tc.thresholdGf,
  };
  if (Math.abs(driftGf) > tc.maxDriftGf) return { ...measured, reason: 'Cannot check: force still drifting.' };
  // Without a detected detachment, a level close to the peel force means the strip may still be
  // attached at the end: not a tare offset, and subtracting it would remove the peel force itself.
  if (detachFrom === 'settled' && Math.abs(measured.residualPctPlateau) > 50) {
    return { ...measured, reason: 'Cannot check: no clear detachment (the force at the end is more than half the peel force).' };
  }
  const flagged = Math.abs(residualGf) > tc.thresholdGf;
  return { ...measured, status: flagged ? 'flagged' : 'ok', reason: flagged ? 'Possible tare offset' : '', valid: true };
}

function analyzePeelCore(run: RunInput, meta: PeelRunMeta, s: PeelSettings): PeelResult {
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
    initiation: { gPreJm2: NaN, ratio: NaN },
    detach: { dispMm: null, source: 'none', note: '' },
    peeledLengthMm: NaN,
    window: { fromMm: NaN, toMm: NaN, source: s.plateau.mode, n: 0, note: '' },
    plateau: nan,
    peelStrengthNmm: NaN,
    peelStrengthNm: NaN,
    toughnessJm2: NaN,
    tare: null,
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

  // ---- initiation: F_pre,max, the largest loading force for 0 ≤ travel < window start --------------
  // The window start is the one used for the steady-state mean (custom fromMm or the fraction-based start).
  let init: PeelResult['initiationPeak'] = null;
  for (let i = 0; i < dispMm.length; i++) {
    if (!Number.isFinite(loadGf[i]) || !(dispMm[i] >= 0 && dispMm[i] < from)) continue;
    const f = loadGf[i] * GF_TO_N;
    if (!init || f > init.forceN) init = { forceN: f, dispMm: dispMm[i] }; // ties keep the first travel
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
    initiation: {
      gPreJm2: init ? (init.forceN / w) * 1000 * factor : NaN, // N/mm × 1000 = N/m = J/m²
      ratio: init && plateau.meanN > 0 ? init.forceN / plateau.meanN : NaN,
    },
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
  return analyzePeel({ time_s: c.time_s, z_mm: c.z_mm, force_gf: c.force_gf, amplitudeMm: c.amplitudeMm, preTareGf: c.preTareGf ?? null }, meta, s);
}

/** Results of a run, with the names shown in the app, in Excel and in Compare (keys are stored in projects and never change). */
export const PEEL_PROPERTIES: { key: string; label: string; unit: string; digits: number; get: (r: PeelResult) => number }[] = [
  { key: 'plateauN', label: 'Average peel force (steady state)', unit: 'N', digits: 4, get: (r) => r.plateau.meanN },
  { key: 'toughness', label: 'Peel energy G_peel', unit: 'J/m²', digits: 2, get: (r) => r.toughnessJm2 },
  { key: 'cv', label: 'Steady-state force variation (CV)', unit: '%', digits: 1, get: (r) => r.plateau.cv * 100 },
  { key: 'preSS', label: 'Pre-peak force F_pre,max', unit: 'N', digits: 4, get: (r) => r.initiationPeak?.forceN ?? NaN },
  { key: 'preTravel', label: 'Travel at F_pre,max', unit: 'mm', digits: 2, get: (r) => r.initiationPeak?.dispMm ?? NaN },
  { key: 'gPre', label: 'Peak energy G_pre', unit: 'J/m²', digits: 2, get: (r) => r.initiation.gPreJm2 },
  { key: 'preRatio', label: 'Peak/steady ratio F_pre,max/F̄_ss', unit: '–', digits: 3, get: (r) => r.initiation.ratio },
  { key: 'rate', label: 'Peel rate', unit: 'mm/s', digits: 3, get: (r) => r.peelRateMmS },
];

/** Definitions of the peel results, shown under the Results table and in the Excel settings sheet. */
/** Equations of the peel results with their sources (refs empty = defined by this analyzer or not adhesion-specific). */
export const PEEL_EQUATIONS: { title: string; tex?: string; text: string; refs: string[]; note: string }[] = [
  {
    title: 'Average peel force F̄ (steady state)',
    tex: String.raw`\bar{F}_{ss} = \frac{1}{n}\sum_{i \in \text{window}} F_i`,
    text: 'Mean force inside the selected steady-state window, in N. Default window 20–80% of the peeled length; a custom displacement window can be entered and is preferred when the steady region is known.',
    refs: ['astmD6862', 'bartlett2023'],
    note: 'average peel force over the steady part of the peel, leaving out initiation and release (ASTM D6862; Bartlett et al. 2023). The 20–80% default window is defined by this analyzer.',
  },
  {
    title: 'Peel energy G_peel',
    tex: String.raw`G_{\text{peel}} = \frac{\bar{F}_{ss}}{w}\left(1 - \cos\theta\right),\qquad \theta = 90^{\circ}:\; G_{\text{peel}} = \frac{\bar{F}_{ss}}{w}`,
    text: 'w = gel width, θ = peel angle; in J/m² (N/m). Reported as measured peel energy, not automatically as intrinsic interfacial toughness.',
    refs: ['kendall1975', 'creton2016', 'bartlett2023'],
    note: 'energy balance of a steadily peeled strip with the elastic (stretching) term neglected (Kendall 1975; Creton & Ciccotti 2016; Bartlett et al. 2023).',
  },
  {
    title: 'Steady-state CV',
    tex: String.raw`\mathrm{CV} = \frac{s_F}{\bar{F}_{ss}}\times 100\%`,
    text: 's_F = sample SD of the force in the window. It describes force variation but does not by itself prove stick–slip.',
    refs: [],
    note: 'standard coefficient of variation; not adhesion-specific.',
  },
  {
    title: 'Post-detachment tare check and correction',
    tex: String.raw`F_{\text{res}} = \frac{1}{n}\sum_{i \in [\delta_{\text{det}} + \Delta,\ \delta_{\text{end}}]} F_i,\qquad G_{\text{corrected}} = G_{\text{raw}} - \frac{F_{\text{res}}\,(\text{gf}\rightarrow\text{N})}{w}\,(1-\cos\theta)`,
    text: 'The clamp is tightened before the test and presses on the single-axis load cell; Zero load tares this force out of the reading, but it is still there. Once peeling starts it is replaced by the strip tension, and after detachment it is released, so the reading settles at about minus the tared value instead of 0. F_res = mean tensile force from the detachment point + Δ (default 1.5 mm) to the end of stage travel (in gf; the window must be at least 2 mm long, and the force must not drift by more than 2 gf between its two halves). |F_res| > 2 gf flags a possible tare offset. When a stationary block (e.g. a Wait) precedes Zero load, the expected residual is minus its mean Fz (tensile sign) and is shown for comparison. If detachment was not detected, the start of the final settled stretch is used, and a level above half the peel force is not treated as an offset. The correction (only by choice, run by run) subtracts F_res from the whole tensile-force trace before every calculation, so at 90° G_peel falls by F_res × 0.00980665 / w; the residual and whether a run is corrected are listed in every table and export.',
    refs: [],
    note: 'instrument check defined by this analyzer (no literature source); 1 gf = 0.00980665 N.',
  },
  {
    title: 'Initiation: pre-peak force, its travel, peak energy and peak/steady ratio',
    tex: String.raw`F_{\text{pre,max}} = \max_{0 \le \delta < \delta_{\text{start}}} F(\delta),\quad \delta_{\text{pre}} = \arg\max_{0 \le \delta < \delta_{\text{start}}} F(\delta),\quad G_{\text{pre}} = \frac{F_{\text{pre,max}}}{w}\,(1-\cos\theta),\quad R = \frac{F_{\text{pre,max}}}{\bar{F}_{ss}}`,
    text: 'F = loading (tensile) force in N, δ = travel in mm, δ_start = start of the steady-state window used for F̄_ss (the custom start, or the fraction of the peeled length). δ_pre = travel at F_pre,max (the first point where it is reached, when several recorded points share the maximum because of the force resolution). G_pre in J/m² with the run’s own width w (m) and peel angle θ; at 90° it equals F_pre,max / w. R (dimensionless) compares the force before the window with the steady-state mean; R ≈ 1 means no overshoot. G_pre is an apparent initiation energy, not a steady-state fracture energy. F_pre,max is not automatically interpreted as the true crack-initiation force.',
    refs: ['kendall1975'],
    note: 'the energy form F/w × (1 − cos θ) is the peel energy of Kendall (1975), applied here to the pre-window maximum as an apparent quantity; the pre-window search, R and the use of the window start are defined by this analyzer.',
  },
  {
    title: 'Detachment and peeled length',
    tex: String.raw`F < f\,F_{\max}\ \text{for}\ N\ \text{consecutive points}\;\Rightarrow\;\text{detachment}`,
    text: 'Detachment = first point after the peak where the force stays below f = 5% of the peak for N = 20 points (both adjustable; a typed value overrides it). Peeled length = displacement at detachment (end of data if none); it sets the automatic window.',
    refs: [],
    note: 'defined by this analyzer.',
  },
  {
    title: 'Custom area under the curve (additional tool)',
    tex: String.raw`W_{\text{selected}} = \int_{\delta_1}^{\delta_2} F\,\mathrm{d}\delta`,
    text: 'Boundaries δ₁, δ₂ set on the Graph tab (draggable or typed); trapezoidal rule with the force interpolated at the exact boundaries; raw work in mJ only. It is not the peel energy G_peel and does not change any automatic result.',
    refs: [],
    note: 'numerical integration (trapezoidal rule), defined by this analyzer; the limits are chosen by you.',
  },
  {
    title: 'Peel rate',
    tex: String.raw`v_{\text{peel}} = \frac{\mathrm{d}\delta}{\mathrm{d}t}\ \text{(least-squares slope in the window)}`,
    text: 'Least-squares slope of displacement versus time inside the steady-state window (mm/s).',
    refs: [],
    note: 'defined by this analyzer.',
  },
];

/** Plain-text definitions with sources (Excel settings sheet), from PEEL_EQUATIONS. */
export const PEEL_DEFINITIONS: [term: string, definition: string, source: string][] = PEEL_EQUATIONS.map((e) => [
  e.title,
  e.text,
  e.refs.length ? `${e.note} ${sourceText(e.refs)}` : e.note.charAt(0).toUpperCase() + e.note.slice(1),
]);