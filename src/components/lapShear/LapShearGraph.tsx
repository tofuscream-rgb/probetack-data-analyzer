import { useMemo, useRef } from 'react';
import type { Data, Layout, PlotlyHTMLElement } from 'plotly.js';
import { useLapShear, type LapShearRun } from '../../state/lapShear';
import { INTEGRATION_LABEL, LAP_INTEGRATION_MODES } from '../../analysis/lapShear';
import { PlotlyChart, loadPlotly } from '../../plotting/PlotlyChart';
import { lttbIndices } from '../../plotting/downsample';
import { EXPORT_SIZE, figAxis, figLayout, peakLabelFont } from '../../plotting/figureStyle';
import { CURVE_COLORS } from '../../plotting/colors';
import type { IntegrationMode } from '../../types';
import { NumberField } from './NumberField';
import { GraphLabelControls, RunGraphControls, Y_OPTIONS, commonTitle, curveLabelAnnotations, shortLabels, type LabelSeries, runStyle, yDigits, yFactor, type YUnit } from '../RunGraphControls';

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
  const unit = v.unit === 'N/m' ? 'gf' : v.unit; // N/m is a peel-only choice
  const stress = unit === 'kPa' || unit === 'MPa';
  const dg = yDigits(unit);
  const autoX = 'Displacement δ = |z − z₀| (mm)';
  const xTitle = v.xTitle.trim() || autoX;
  const autoY = stress ? `Shear strength (${unit})` : `Loading force (${unit})`;
  const yTitle = v.yTitle.trim() || autoY;
  const runs = selected.filter((r) => r.result.ok);

  const { data, layout } = useMemo(() => {
    const traces: Data[] = [];
    const annotations: Partial<Layout>['annotations'] = [];
    const labelSeries: LabelSeries[] = [];
    const ids = runs.map((r) => r.id);
    const short = v.labels === 'curve' ? shortLabels(runs.map((r) => ({ label: r.label, cycleNumber: r.cycle.cycleNumber, cond: r.cond }))) : runs.map((r) => r.label);
    const avoid: number[] = [];
    runs.forEach((r, k) => {
      const color = CURVE_COLORS[k % CURVE_COLORS.length];
      const st = runStyle(v, r.id, ids);
      const res = r.result;
      const f = yFactor(unit, res.areaMm2, res.dims.widthMm); // each run with its own bonded area
      if (!Number.isFinite(f)) return;
      const xs = res.series.dispMm;
      const idx = displayIndices(r, xs);
      const y = (i: number) => res.series.loadGf[i] * f;
      const name = v.names[r.id]?.trim() || short[k];
      labelSeries.push({ id: r.id, name, color, x: idx.map((i) => xs[i]), y: idx.map(y) });

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
          hovertemplate: `${name} raw<br>δ = %{x:.4f} mm<br>%{y:.${dg}f} ${unit}<extra></extra>`,
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
        hovertemplate: `${name}<br>δ = %{x:.4f} mm<br>${stress ? 'τ' : 'F'} = %{y:.${dg}f} ${unit}${stress ? ` (A = ${res.areaMm2} mm²)` : ''}<extra></extra>`,
      } as unknown as Data);
      if (res.peak) {
        const px = xs[res.peak.index];
        avoid.push(px);
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
          hovertemplate: `${name}<br>Peak ${py.toFixed(dg)} ${unit} at δ = ${res.peak.dispMm.toFixed(3)} mm<extra></extra>`,
        } as unknown as Data);
        if (v.peakLabels && st.labels) {
          annotations.push({ x: px, y: py, text: `${py.toFixed(Math.max(1, dg - 1))} ${unit}`, showarrow: true, arrowhead: 0, ax: 0, ay: -22, font: peakLabelFont(color), bgcolor: 'rgba(255,255,255,0.8)' });
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
      ...figLayout(),
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      xaxis: figAxis(xTitle),
      yaxis: figAxis(yTitle),
      legend: { orientation: 'v', x: 1.01, y: 1, font: { size: 15, color: '#000' } },
      showlegend: v.labels === 'legend',
      annotations: v.labels === 'curve' ? [...annotations, ...curveLabelAnnotations(labelSeries, v.peakLabels ? avoid : [])] : annotations,
      ...(v.title.trim() ? { title: { text: `<b>${v.title.trim()}</b>`, font: { size: 22, color: '#000' }, x: 0.5, xanchor: 'center' }, margin: { l: 90, r: 16, t: 64, b: 78 } } : {}),
      // Keep labels the user dragged while the graph updates.
      editrevision: 'labels',
      dragmode: 'zoom',
      hovermode: 'closest',
      uirevision: unit,
    };
    return { data: traces, layout: lay };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, v, unit, xTitle, yTitle]);

  const save = async (format: 'png' | 'svg') => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.downloadImage(plotEl.current, { format, filename: 'lap_shear', ...EXPORT_SIZE, scale: format === 'png' ? 4 : 1 } as never);
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
        <label title="Stress uses each run's own bonded area A = overlap length × width; τ = F/A, apparent shear strength of a single-lap joint (ASTM D1002)">
          Y axis
          <select className="y-select" value={unit} onChange={(e) => set({ view: { ...v, unit: e.target.value as YUnit, yTitle: '' } })}>
            {Y_OPTIONS.lapShear.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="vs">vs displacement</span>
        </label>
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
      <GraphLabelControls view={v} set={(view) => set({ view })} runs={runs} suggestion={commonTitle(runs.map((r) => r.cond))} autoX={autoX} autoY={autoY} />
      <div className="graph-toolbar integration-bar">
        <label>
          Integration
          <select value={s.integration.mode} onChange={(e) => setSettings({ integration: { ...s.integration, mode: e.target.value as IntegrationMode } })}>
            {LAP_INTEGRATION_MODES.map((k) => <option key={k} value={k}>{INTEGRATION_LABEL[k]}</option>)}
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
        <PlotlyChart data={data} layout={layout} onClick={(e) => { const m = e.points[0]?.data.meta; if (typeof m === 'string') set({ view: { ...v, highlight: v.highlight === m ? null : m } }); }} onReady={(el) => (plotEl.current = el)} config={{ editable: true, edits: { annotationPosition: true, annotationTail: true, annotationText: false, axisTitleText: false, titleText: false, legendText: false, legendPosition: true, colorbarTitleText: false, colorbarPosition: false, shapePosition: false }, toImageButtonOptions: { format: 'png', filename: 'lap_shear', scale: 3 } }} />
      )}
    </section>
  );
}
