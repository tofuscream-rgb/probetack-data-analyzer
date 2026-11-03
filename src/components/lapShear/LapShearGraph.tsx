import { useMemo, useRef } from 'react';
import type { Data, Layout, PlotlyHTMLElement } from 'plotly.js';
import { useLapShear, type LapShearRun } from '../../state/lapShear';
import { INTEGRATION_LABEL } from '../../analysis/lapShear';
import { PlotlyChart, loadPlotly } from '../../plotting/PlotlyChart';
import { lttbIndices } from '../../plotting/downsample';
import { CURVE_COLORS } from '../../plotting/colors';
import { GF_TO_N, type IntegrationMode } from '../../types';
import { NumberField } from './NumberField';
import { RunGraphControls, runStyle } from '../RunGraphControls';

const DISPLAY_LIMIT = 4000;

function hexToRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Sample indices to draw: downsampled for speed, always including the peak and failure points. */
function displayIndices(r: LapShearRun, xs: Float64Array): number[] {
  const { loadGf } = r.result.series;
  const keep = new Set<number>();
  const valid: number[] = [];
  for (let i = 0; i < xs.length; i++) if (Number.isFinite(xs[i]) && Number.isFinite(loadGf[i])) valid.push(i);
  if (valid.length <= DISPLAY_LIMIT) return valid;
  const vx = Float64Array.from(valid, (i) => xs[i]);
  const vy = Float64Array.from(valid, (i) => loadGf[i]);
  for (const k of lttbIndices(vx, vy, DISPLAY_LIMIT)) keep.add(valid[k]);
  if (r.result.peak) keep.add(r.result.peak.index);
  if (r.result.failure.index !== null) keep.add(r.result.failure.index);
  return [...keep].sort((a, b) => a - b);
}

export function LapShearGraph() {
  const { ls, selected, set, setSettings } = useLapShear();
  const v = ls.view;
  const s = ls.settings;
  const plotEl = useRef<PlotlyHTMLElement | null>(null);
  const f = v.unit === 'N' ? GF_TO_N : 1;
  const xTitle = v.x === 'disp' ? 'Displacement δ = |z − z₀| (mm)' : 'Time (s)';
  const yTitle = `Loading force (${v.unit})`;
  const runs = selected.filter((r) => r.result.ok);

  const { data, layout } = useMemo(() => {
    const traces: Data[] = [];
    const annotations: Partial<Layout>['annotations'] = [];
    const ids = runs.map((r) => r.id);
    runs.forEach((r, k) => {
      const color = CURVE_COLORS[k % CURVE_COLORS.length];
      const st = runStyle(v, r.id, ids);
      const res = r.result;
      const xs = v.x === 'disp' ? res.series.dispMm : (Float64Array.from(r.cycle.time_s) as Float64Array);
      const idx = displayIndices(r, xs);
      const y = (i: number) => res.series.loadGf[i] * f;
      const name = r.label;

      // Shaded integration interval (the one used for "Selected integration work").
      if (st.shade && Number.isFinite(res.work.selectedMJ)) {
        const lo = res.work.selectedFromMm;
        const hi = res.work.selectedToMm;
        const inside = idx.filter((i) => res.series.dispMm[i] >= lo && res.series.dispMm[i] <= hi);
        if (inside.length > 1) {
          traces.push({
            type: 'scatter',
            mode: 'lines',
            x: inside.map((i) => xs[i]),
            y: inside.map(y),
            fill: 'tozeroy',
            fillcolor: hexToRgba(color, 0.18),
            line: { width: 0 },
            hoverinfo: 'skip',
            showlegend: false,
            legendgroup: r.id,
          } as unknown as Data);
        }
      }
      if (v.showRaw && res.baseline.applied) {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          name: `${name} (raw, uncorrected)`,
          x: idx.map((i) => xs[i]),
          y: idx.map((i) => res.loadingSign * r.cycle.force_gf[i] * f),
          line: { color, width: 1, dash: 'dot' },
          legendgroup: r.id,
          hovertemplate: `${name} raw<br>x = %{x:.4f}<br>F = %{y:.4f} ${v.unit}<extra></extra>`,
        } as unknown as Data);
      }
      traces.push({
        type: 'scatter',
        mode: 'lines',
        name,
        meta: r.id,
        x: idx.map((i) => xs[i]),
        y: idx.map(y),
        line: { color, width: st.width },
        opacity: st.opacity,
        legendgroup: r.id,
        hovertemplate: `${name}<br>${v.x === 'disp' ? 'δ' : 't'} = %{x:.4f}<br>F = %{y:.4f} ${v.unit}<extra></extra>`,
      } as unknown as Data);
      if (res.peak) {
        const px = xs[res.peak.index];
        const py = res.peak.forceGf * f;
        traces.push({
          type: 'scatter',
          mode: 'markers',
          x: [px],
          y: [py],
          marker: { symbol: 'triangle-up', size: 12, color, line: { color: '#18263A', width: 1 } },
          opacity: st.opacity,
          meta: r.id,
          legendgroup: r.id,
          showlegend: false,
          hovertemplate: `${name}<br>Peak ${py.toFixed(v.unit === 'N' ? 4 : 2)} ${v.unit} at δ = ${res.peak.dispMm.toFixed(3)} mm, t = ${res.peak.timeS.toFixed(2)} s<extra></extra>`,
        } as unknown as Data);
        if (v.peakLabels && st.labels) {
          annotations.push({ x: px, y: py, text: `${py.toFixed(v.unit === 'N' ? 3 : 1)} ${v.unit}`, showarrow: true, arrowhead: 0, ax: 0, ay: -22, font: { size: 11, color }, bgcolor: 'rgba(255,255,255,0.8)' });
        }
      }
      if (res.failure.dispMm !== null) {
        // Failure point: the first sample at or beyond the failure displacement.
        let fi = res.failure.index ?? -1;
        if (fi < 0) for (let i = 0; i < res.series.dispMm.length; i++) if (res.series.dispMm[i] >= res.failure.dispMm) { fi = i; break; }
        if (fi >= 0) {
          traces.push({
            type: 'scatter',
            mode: 'markers',
            x: [xs[fi]],
            y: [y(fi)],
            marker: { symbol: 'x-thin', size: 12, color: '#18263A', line: { color, width: 2.5 } },
            opacity: st.opacity,
            legendgroup: r.id,
            showlegend: false,
            hovertemplate: `${name}<br>Failure (${res.failure.source}) at δ = ${res.failure.dispMm.toFixed(3)} mm<extra></extra>`,
          } as unknown as Data);
        }
      }
    });
    const lay: Partial<Layout> = {
      margin: { l: 70, r: 10, t: 16, b: 52 },
      font: { family: 'IBM Plex Sans, system-ui, sans-serif', size: 12, color: '#18263A' },
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      xaxis: { title: { text: xTitle }, zeroline: true, zerolinecolor: '#C9D2DD', gridcolor: '#EEF2F6', linecolor: '#9AA6B5', mirror: true },
      yaxis: { title: { text: yTitle }, zeroline: true, zerolinecolor: '#C9D2DD', gridcolor: '#EEF2F6', linecolor: '#9AA6B5', mirror: true },
      legend: { orientation: 'v', x: 1.01, y: 1, font: { size: 10 } },
      annotations,
      dragmode: 'zoom',
      hovermode: 'closest',
      uirevision: `${v.x}|${v.unit}`,
    };
    return { data: traces, layout: lay };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, v, f]);

  const save = async (format: 'png' | 'svg') => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.downloadImage(plotEl.current, { format, filename: 'lap_shear', width: 1200, height: 750, scale: format === 'png' ? 4 : 1 } as never);
  };
  const resetZoom = async () => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.relayout(plotEl.current, { 'xaxis.autorange': true, 'yaxis.autorange': true });
  };
  const anyBaseline = runs.some((r) => r.result.baseline.applied);

  return (
    <section className="graph-panel" aria-label="Lap-shear graph">
      <div className="graph-toolbar">
        <div className="segmented small" role="group" aria-label="X axis">
          <button className={v.x === 'disp' ? 'on' : ''} onClick={() => set({ view: { ...v, x: 'disp' } })}>Force vs displacement</button>
          <button className={v.x === 'time' ? 'on' : ''} onClick={() => set({ view: { ...v, x: 'time' } })}>Force vs time</button>
        </div>
        <div className="segmented small" role="group" aria-label="Force unit">
          <button className={v.unit === 'gf' ? 'on' : ''} onClick={() => set({ view: { ...v, unit: 'gf' } })}>gf</button>
          <button className={v.unit === 'N' ? 'on' : ''} onClick={() => set({ view: { ...v, unit: 'N' } })}>N</button>
        </div>
        <label className="check"><input type="checkbox" checked={v.peakLabels} onChange={(e) => set({ view: { ...v, peakLabels: e.target.checked } })} /> Peak labels</label>
        <RunGraphControls view={v} set={(view) => set({ view })} runs={runs} shadeLabel="Shades the interval used for the selected integration work" />
        {anyBaseline && <label className="check"><input type="checkbox" checked={v.showRaw} onChange={(e) => set({ view: { ...v, showRaw: e.target.checked } })} /> Raw curve</label>}
        <button className="link" onClick={resetZoom}>Reset zoom</button>
        <div className="export-group">
          <span>Save graph</span>
          <button className="small" onClick={() => save('png')}>PNG</button>
          <button className="small" onClick={() => save('svg')}>SVG</button>
        </div>
      </div>
      <div className="graph-toolbar integration-bar">
        <label>
          Integration
          <select value={s.integration.mode} onChange={(e) => setSettings({ integration: { ...s.integration, mode: e.target.value as IntegrationMode } })}>
            {(Object.keys(INTEGRATION_LABEL) as IntegrationMode[]).map((k) => <option key={k} value={k}>{INTEGRATION_LABEL[k]}</option>)}
          </select>
        </label>
        {s.integration.mode === 'custom' && (
          <>
            <NumberField label="from (mm)" value={s.integration.fromMm} min={0} onCommit={(x) => x !== null && setSettings({ integration: { ...s.integration, fromMm: x } })} />
            <NumberField label="to (mm)" value={s.integration.toMm} min={0} onCommit={(x) => x !== null && setSettings({ integration: { ...s.integration, toMm: x } })} />
          </>
        )}
        <span className="view-help">
          Click a curve to highlight it · baseline correction {s.baseline.enabled ? 'ON' : 'off'} · loading force shown positive · ▲ peak · × complete failure
        </span>
      </div>
      {runs.length === 0 ? (
        <div className="empty-plot">
          <p>No runs selected.</p>
          <p>Open your lap-shear TXT files on the left and tick the runs to compare.</p>
        </div>
      ) : (
        <PlotlyChart data={data} layout={layout} onClick={(e) => { const m = e.points[0]?.data.meta; if (typeof m === 'string') set({ view: { ...v, highlight: v.highlight === m ? null : m } }); }} onReady={(el) => (plotEl.current = el)} config={{ toImageButtonOptions: { format: 'png', filename: 'lap_shear', scale: 3 } }} />
      )}
    </section>
  );
}
