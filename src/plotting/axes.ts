/** Axis variables available for plotting and export, with transparent definitions. */
import type { AnalysisSettings } from '../types';
import { GF_TO_N } from '../types';
import type { CycleResult } from '../analysis/engine';
import { DISPLACEMENT_LABEL, displacement } from '../analysis/cycleMetrics';

export interface AxisOption {
  id: string;
  label: string;
  description: string;
}

export function axisOptions(settings: AnalysisSettings, extraColumns: string[] = []): AxisOption[] {
  const u = settings.forceUnit;
  const pos = settings.forceSign === 'positive';
  const name = pos ? 'Adhesion force' : 'Force Fz';
  const signNote = pos ? ' Sign inverted, so adhesion (pulling) is positive.' : '';
  const opts: AxisOption[] = [
    { id: 'force', label: `${name} (${u})`, description: `Recorded force in ${u} (1 gf = ${GF_TO_N} N).${signNote}` },
    { id: 'force_gf', label: `${name} (gf)`, description: `Recorded force in gram-force.${signNote}` },
    { id: 'force_N', label: `${name} (N)`, description: `Recorded force × ${GF_TO_N}.${signNote}` },
    {
      id: 'force_corr',
      label: `Baseline-corrected ${pos ? 'adhesion ' : ''}force (${u})`,
      description: 'Force minus the baseline chosen in Analysis settings (unavailable when baseline correction is off).',
    },
    { id: 'time_s', label: 'Time (s)', description: 'Time since the start of the movement, as recorded.' },
    { id: 'z_mm', label: 'Absolute Z position (mm)', description: 'Position (z) column, as recorded.' },
    {
      id: 'stress_kPa',
      label: 'Nominal stress σN (kPa)',
      description: `σN = F / Amax, with Amax = π (d/2)² of the flat probe (diameter d under Settings).${signNote} Creton & Ciccotti, Rep. Prog. Phys. 79, 046601 (2016), eq. 9.`,
    },
    {
      id: 'stress_MPa',
      label: 'Nominal stress σN (MPa)',
      description: 'σN = F / Amax in MPa (N/mm²).',
    },
    {
      id: 'strain',
      label: 'Nominal strain ε',
      description: 'ε = (h − h₀) / h₀: the displacement of each run divided by the initial gel thickness h₀ under Settings. Creton & Ciccotti, Rep. Prog. Phys. 79, 046601 (2016), eq. 9.',
    },
    {
      id: 'disp_mm',
      label: settings.displacementMode === 'distance' ? 'Displacement from start (mm)' : 'Relative Z displacement (mm)',
      description: `Displacement = ${DISPLACEMENT_LABEL[settings.displacementMode]}, where z₀ is the first recorded z of each run, so every run starts at 0.`,
    },
  ];
  for (const c of extraColumns) opts.push({ id: `extra:${c}`, label: c, description: `Recorded column "${c}".` });
  return opts;
}

export function axisLabel(id: string, settings: AnalysisSettings): string {
  return axisOptions(settings).find((o) => o.id === id)?.label ?? id.replace(/^extra:/, '');
}

/** Values for one axis variable. Returns null when the variable is unavailable for this cycle. */
export function axisValues(r: CycleResult, id: string, settings: AnalysisSettings): Float64Array | null {
  const c = r.cycle;
  const sign = settings.forceSign === 'positive' ? -1 : 1;
  const f = (settings.forceUnit === 'N' ? GF_TO_N : 1) * sign;
  switch (id) {
    case 'force':
      return f === 1 ? c.force_gf : c.force_gf.map((v) => v * f);
    case 'force_gf':
      return sign === 1 ? c.force_gf : c.force_gf.map((v) => -v);
    case 'force_N':
      return c.force_gf.map((v) => v * GF_TO_N * sign);
    case 'force_corr':
      return r.baseline === null ? null : c.force_gf.map((v) => (v - r.baseline!) * f);
    case 'time_s':
      return c.time_s;
    case 'z_mm':
      return c.z_mm.length ? c.z_mm : null;
    case 'disp_mm':
      return c.z_mm.length ? displacement(c.z_mm, settings.displacementMode) : null;
    case 'stress_kPa':
    case 'stress_MPa': {
      const a = probeAreaMm2(settings);
      if (!a) return null;
      const k = (GF_TO_N / a) * sign * (id === 'stress_kPa' ? 1000 : 1); // N/mm² = MPa
      return c.force_gf.map((v) => v * k);
    }
    case 'strain': {
      const h0 = settings.probe?.thicknessMm;
      if (!c.z_mm.length || !(h0 > 0)) return null;
      return displacement(c.z_mm, settings.displacementMode).map((d) => d / h0);
    }
    default:
      if (id.startsWith('extra:')) return c.extra[id.slice(6)] ?? null;
      return null;
  }
}

/** Contact area of the flat probe, π (d/2)² in mm², or null when no diameter is entered. */
export function probeAreaMm2(settings: Pick<AnalysisSettings, 'probe'>): number | null {
  const d = settings.probe?.diameterMm;
  return d > 0 && Number.isFinite(d) ? Math.PI * (d / 2) ** 2 : null;
}

/** Axes that need the probe diameter or gel thickness. */
export const needsProbe = (id: string) => id.startsWith('stress_') || id === 'strain';

export function isForceAxis(id: string): boolean {
  return id.startsWith('force');
}

/** Legend text identifying conditions, file, repeat and run. */
export function curveLabel(r: CycleResult): string {
  const m = r.meta;
  const parts = [
    m.chargeRatio.value !== null ? `CR ${m.chargeRatio.value}` : null,
    m.concentrationM.value !== null ? `${m.concentrationM.value} M` : null,
    m.substrate.value,
    r.holdTimeS !== null ? `${r.holdTimeS} s hold` : null,
  ].filter(Boolean);
  return `${parts.join(', ')} | ${r.file.name} – Repeat ${m.repeat.value}, Run ${r.cycle.cycleNumber}`;
}
