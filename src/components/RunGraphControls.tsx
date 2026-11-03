import { GF_TO_N, type RunGraphView } from '../types';
import { LINE } from '../plotting/figureStyle';

/** Shading and highlighting controls shared by the Lap Shear and 90° Peel graphs. */
export function RunGraphControls({ view, set, runs, shadeLabel }: { view: RunGraphView; set: (v: RunGraphView) => void; runs: { id: string; label: string }[]; shadeLabel: string }) {
  const hl = view.highlight && runs.some((r) => r.id === view.highlight) ? view.highlight : '';
  return (
    <>
      <label title={shadeLabel}>
        Shade area under curve
        <select value={view.shade} onChange={(e) => set({ ...view, shade: e.target.value as RunGraphView['shade'] })}>
          <option value="none">Off</option>
          <option value="highlight">Highlighted run only</option>
          <option value="all">All runs</option>
        </select>
      </label>
      <label title="The highlighted run is drawn bold and the others fade. You can also click a curve.">
        Highlight
        <select value={hl} onChange={(e) => set({ ...view, highlight: e.target.value || null })}>
          <option value="">None (all equal)</option>
          {runs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
    </>
  );
}

/** Line, opacity and shading for one run under the current highlight. */
export function runStyle(view: RunGraphView, id: string, runIds: string[]) {
  const hl = view.highlight && runIds.includes(view.highlight) ? view.highlight : null;
  const dim = hl !== null && hl !== id;
  return {
    dim,
    width: hl === id ? LINE.bold : dim ? LINE.faded : LINE.normal,
    opacity: dim ? 0.25 : 1,
    shade: view.shade === 'all' ? !dim : view.shade === 'highlight' ? hl === id : false,
    labels: !dim,
  };
}

export type YUnit = RunGraphView['unit'];

/** y-axis choices: force, stress = force / area (kPa, MPa), and (peel) force per width. */
export const Y_OPTIONS: Record<'lapShear' | 'peel', { value: YUnit; label: string }[]> = {
  lapShear: [
    { value: 'gf', label: 'Force (gf)' },
    { value: 'N', label: 'Force (N)' },
    { value: 'kPa', label: 'Apparent shear stress τ = F/A (kPa)' },
    { value: 'MPa', label: 'Apparent shear stress τ = F/A (MPa)' },
  ],
  peel: [
    { value: 'gf', label: 'Force (gf)' },
    { value: 'N', label: 'Force (N)' },
    { value: 'kPa', label: 'Nominal stress F/A (kPa)' },
    { value: 'MPa', label: 'Nominal stress F/A (MPa)' },
    { value: 'N/m', label: 'Force per width F/w (N/m)' },
  ],
};

/** Factor from recorded gf to the chosen y quantity for one run (NaN when its area or width is invalid). */
export function yFactor(unit: YUnit, areaMm2: number, widthMm: number): number {
  const ok = (v: number) => Number.isFinite(v) && v > 0;
  switch (unit) {
    case 'gf': return 1;
    case 'N': return GF_TO_N;
    case 'kPa': return ok(areaMm2) ? (GF_TO_N / areaMm2) * 1000 : NaN; // N/mm² = MPa
    case 'MPa': return ok(areaMm2) ? GF_TO_N / areaMm2 : NaN;
    case 'N/m': return ok(widthMm) ? (GF_TO_N / widthMm) * 1000 : NaN;
  }
}

export const yDigits = (unit: YUnit) => ({ gf: 2, N: 4, kPa: 3, MPa: 6, 'N/m': 1 })[unit];
