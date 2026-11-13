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
    initiation: { gPreJm2: NaN, ratio: NaN },
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
  return analyzePeel({ time_s: c.time_s, z_mm: c.z_mm, force_gf: c.force_gf, amplitudeMm: c.amplitudeMm }, meta, s);
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