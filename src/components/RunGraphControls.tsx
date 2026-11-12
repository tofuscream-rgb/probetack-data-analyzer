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

/** y-axis choices: force, shear strength / stress = force / area (kPa, MPa), and (peel) peel energy G = F/w·(1 − cos θ). */
export const Y_OPTIONS: Record<'lapShear' | 'peel', { value: YUnit; label: string }[]> = {
  lapShear: [
    { value: 'gf', label: 'Force (gf)' },
    { value: 'N', label: 'Force (N)' },
    { value: 'kPa', label: 'Shear strength τ = F/A (kPa)' },
    { value: 'MPa', label: 'Shear strength τ = F/A (MPa)' },
  ],
  peel: [
    { value: 'gf', label: 'Force (gf)' },
    { value: 'N', label: 'Force (N)' },
    { value: 'kPa', label: 'Nominal stress F/A (kPa)' },
    { value: 'MPa', label: 'Nominal stress F/A (MPa)' },
    { value: 'N/m', label: 'Peel energy G = F/w·(1 − cos θ) (J/m²)' },
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

export interface LabelSeries {
  id: string;
  name: string;
  color: string;
  x: number[];
  y: number[];
}

/** y of a curve at x (linear interpolation; x mostly increasing), or NaN outside the curve. */
function yAt(s: LabelSeries, x: number): number {
  let best = NaN;
  for (let i = 1; i < s.x.length; i++) {
    const a = s.x[i - 1];
    const b = s.x[i];
    if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(s.y[i - 1]) && Number.isFinite(s.y[i]))) continue;
    if ((a <= x && x <= b) || (b <= x && x <= a)) {
      best = a === b ? s.y[i] : s.y[i - 1] + ((s.y[i] - s.y[i - 1]) * (x - a)) / (b - a);
      if (a <= x) break;
    }
  }
  return best;
}

/**
 * Labels written next to the curves instead of a legend box: placed where the curves
 * are furthest apart, nudged apart when they would overlap (with a thin connector).
 */
export function curveLabelAnnotations(series: LabelSeries[], avoidX: number[] = []): Partial<import('plotly.js').Annotations>[] {
  const ss = series.filter((s) => s.x.length > 1);
  if (!ss.length) return [];
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const s of ss) for (let i = 0; i < s.x.length; i++) {
    if (Number.isFinite(s.x[i])) { xmin = Math.min(xmin, s.x[i]); xmax = Math.max(xmax, s.x[i]); }
    if (Number.isFinite(s.y[i])) { ymin = Math.min(ymin, s.y[i]); ymax = Math.max(ymax, s.y[i]); }
  }
  // The plotted y range includes zero, so label spacing follows what is seen on the graph.
  const span = Math.max(ymax, 0) - Math.min(ymin, 0) || 1;
  let bestX = xmin + 0.75 * (xmax - xmin);
  let bestScore = -Infinity;
  const near = (x: number) => avoidX.some((a) => Math.abs(a - x) < 0.08 * (xmax - xmin)); // keep clear of peak labels
  for (let k = 0; k <= 30; k++) {
    const x = xmin + (0.25 + (0.67 * k) / 30) * (xmax - xmin);
    if (near(x)) continue;
    const ys = ss.map((s) => yAt(s, x));
    if (ys.some((v) => !Number.isFinite(v))) continue;
    let score = Infinity;
    for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++) score = Math.min(score, Math.abs(ys[i] - ys[j]));
    if (ss.length === 1) score = ys[0]; // one curve: label it where it is high
    if (score >= bestScore) { bestScore = score; bestX = x; }
  }
  const pts = ss.map((s) => ({ s, y: yAt(s, bestX) })).filter((p) => Number.isFinite(p.y)).sort((a, b) => a.y - b.y);
  const gap = 0.075 * span;
  const placed: number[] = [];
  pts.forEach((p, k) => placed.push(k === 0 ? p.y : Math.max(p.y, placed[k - 1] + gap)));
  return pts.map((p, k) => {
    const moved = placed[k] - p.y > 0.01 * span;
    return {
      x: bestX,
      y: p.y,
      xref: 'x',
      yref: 'y',
      text: `<b>${p.s.name}</b>`,
      font: { size: 18, color: p.s.color },
      bgcolor: 'rgba(255,255,255,0.75)',
      ...(moved
        ? { showarrow: true, ax: bestX, ay: placed[k] + 0.04 * span, axref: 'x', ayref: 'y', arrowhead: 0, arrowwidth: 1.2, arrowcolor: p.s.color }
        : { showarrow: false, yshift: 16 }),
    } as Partial<import('plotly.js').Annotations>;
  });
}

/** What all runs share ("0.25 · 2.5 M"), as a suggested graph title. */
export function commonTitle(conds: { chargeRatio: string; concentration: string; concentrationDefault: boolean; substrate: string }[]): string {
  if (!conds.length) return '';
  const same = (f: (c: (typeof conds)[number]) => string) => (conds.every((c) => f(c) === f(conds[0])) ? f(conds[0]) : '—');
  const cr = same((c) => c.chargeRatio);
  const conc = same((c) => (c.concentrationDefault ? '—' : c.concentration));
  const sub = same((c) => c.substrate.trim().toLowerCase()) !== '—' ? conds[0].substrate : '—';
  return [cr !== '—' ? cr : null, conc !== '—' ? `${conc} M` : null, sub !== '—' ? sub : null].filter(Boolean).join(' · ');
}

/** Curve labels (legend / on curves / none), graph title and curve names. */
export function GraphLabelControls({ view, set, runs, suggestion, autoX, autoY }: {
  view: RunGraphView;
  set: (v: RunGraphView) => void;
  runs: { id: string; label: string }[];
  suggestion: string;
  /** Automatic axis titles, shown as placeholders. */
  autoX: string;
  autoY: string;
}) {
  const edited = [view.title && 'title', (view.xTitle || view.yTitle) && 'axis titles', Object.keys(view.names).length && 'curve names', view.labels !== 'legend' && 'curve labels'].filter(Boolean);
  return (
    <details className="graph-format">
      <summary>Labels and titles{edited.length ? ` (edited: ${edited.join(', ')})` : ''}</summary>
    <div className="graph-toolbar label-bar">
      <label title="How curves are identified">
        Curve labels
        <select value={view.labels} onChange={(e) => set({ ...view, labels: e.target.value as RunGraphView['labels'] })}>
          <option value="legend">Legend box</option>
          <option value="curve">Label on curves</option>
          <option value="none">None</option>
        </select>
      </label>
      <label className="title-field">
        Graph title
        <input value={view.title} placeholder={suggestion ? `e.g. ${suggestion}` : 'none'} onChange={(e) => set({ ...view, title: e.target.value })} aria-label="Graph title" />
      </label>
      {suggestion && !view.title && <button className="link small" onClick={() => set({ ...view, title: suggestion })}>Use “{suggestion}”</button>}
      <details className="rename-curves axis-titles">
        <summary>Axis titles{view.xTitle || view.yTitle ? ' (edited)' : ''}</summary>
        <div className="rename-list">
          <label>
            <span>Y axis</span>
            <input value={view.yTitle} placeholder={autoY} onChange={(e) => set({ ...view, yTitle: e.target.value })} aria-label="Y axis title" />
          </label>
          <label>
            <span>X axis</span>
            <input value={view.xTitle} placeholder={autoX} onChange={(e) => set({ ...view, xTitle: e.target.value })} aria-label="X axis title" />
          </label>
          {(view.xTitle || view.yTitle) && <button className="link small" onClick={() => set({ ...view, xTitle: '', yTitle: '' })}>Back to automatic titles</button>}
          <p className="hint">Leave empty for the automatic title. Write m&lt;sup&gt;2&lt;/sup&gt; for a superscript. The Y title goes back to automatic when you change the Y quantity.</p>
        </div>
      </details>
      <details className="rename-curves">
        <summary>Rename curves</summary>
        <div className="rename-list">
          {runs.map((r) => (
            <label key={r.id}>
              <span title={r.label}>{r.label}</span>
              <input
                value={view.names[r.id] ?? ''}
                placeholder="automatic"
                onChange={(e) => {
                  const names = { ...view.names };
                  if (e.target.value.trim()) names[r.id] = e.target.value;
                  else delete names[r.id];
                  set({ ...view, names });
                }}
                aria-label={`Name for ${r.label}`}
              />
            </label>
          ))}
          <p className="hint">Names are used in the legend and the on-curve labels (and in saved graphs). Drag a label on the graph to move it.</p>
        </div>
      </details>
    </div>
    </details>
  );
}

/**
 * Short names for on-curve labels: the parts of each run's conditions that differ
 * between the curves ("2.5 M" instead of "0.25 · 2.5 M · ss – Run 1" when all curves
 * share charge ratio, substrate and run number). Falls back to the full label when
 * the short names would not be unique.
 */
export function shortLabels(runs: { label: string; cycleNumber: number; cond: { chargeRatio: string; concentration: string; concentrationDefault: boolean; substrate: string } }[]): string[] {
  const parts = runs.map((r) => [
    r.cond.chargeRatio !== '—' ? r.cond.chargeRatio : '',
    r.cond.concentration !== '—' && !r.cond.concentrationDefault ? `${r.cond.concentration} M` : '',
    r.cond.substrate !== '—' ? r.cond.substrate : '',
    `Run ${r.cycleNumber}`,
  ]);
  const keep = [0, 1, 2, 3].filter((k) => new Set(parts.map((p) => p[k].toLowerCase())).size > 1);
  const out = parts.map((p, i) => keep.map((k) => p[k]).filter(Boolean).join(' · ') || runs[i].label);
  return new Set(out).size === out.length ? out : runs.map((r) => r.label);
}

/** Unit as written on the graph: peel energy is stored as 'N/m' (1 N/m = 1 J/m²). */
export const unitText = (unit: YUnit) => (unit === 'N/m' ? 'J/m²' : unit);
