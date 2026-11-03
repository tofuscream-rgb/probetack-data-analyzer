import type { RunGraphView } from '../types';

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
    width: hl === id ? 3 : dim ? 1.2 : 1.8,
    opacity: dim ? 0.25 : 1,
    shade: view.shade === 'all' ? !dim : view.shade === 'highlight' ? hl === id : false,
    labels: !dim,
  };
}
