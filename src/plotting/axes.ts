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
  const opts: AxisOption[] = [
    { id: 'force', label: `Force Fz (${u})`, description: `Recorded force in ${u} (1 gf = ${GF_TO_N} N).` },
    { id: 'force_gf', label: 'Force Fz (gf)', description: 'Recorded force in gram-force.' },
    { id: 'force_N', label: 'Force Fz (N)', description: `Recorded force × ${GF_TO_N}.` },
    {
      id: 'force_corr',
      label: `Baseline-corrected force (${u})`,
      description: 'Force minus the baseline chosen in Analysis settings (unavailable when baseline correction is off).',
    },
    { id: 'time_s', label: 'Time (s)', description: 'Time since the start of the movement, as recorded.' },
    { id: 'z_mm', label: 'Absolute Z position (mm)', description: 'Position (z) column, as recorded.' },
    {
      id: 'disp_mm',
      label: 'Relative Z displacement (mm)',
      description: `Displacement = ${DISPLACEMENT_LABEL[settings.displacementMode]}, where z₀ is the first recorded z of the movement.`,
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
  const f = settings.forceUnit === 'N' ? GF_TO_N : 1;
  switch (id) {
    case 'force':
      return f === 1 ? c.force_gf : c.force_gf.map((v) => v * f);
    case 'force_gf':
      return c.force_gf;
    case 'force_N':
      return c.force_gf.map((v) => v * GF_TO_N);
    case 'force_corr':
      return r.baseline === null ? null : c.force_gf.map((v) => (v - r.baseline!) * f);
    case 'time_s':
      return c.time_s;
    case 'z_mm':
      return c.z_mm.length ? c.z_mm : null;
    case 'disp_mm':
      return c.z_mm.length ? displacement(c.z_mm, settings.displacementMode) : null;
    default:
      if (id.startsWith('extra:')) return c.extra[id.slice(6)] ?? null;
      return null;
  }
}

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
