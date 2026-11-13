import { useMemo, useRef } from 'react';
import { download } from '../../state/AppContext';
import type { Data, Layout, PlotlyHTMLElement } from 'plotly.js';
import { usePeel, type PeelRun } from '../../state/peel';
import { buildPlotWorkbook } from '../../export/plotWorkbook';
import { PlotlyChart, loadPlotly } from '../../plotting/PlotlyChart';
import { lttbIndices } from '../../plotting/downsample';
import { EXPORT_SIZE, figAxis, figLayout, peakLabelFont } from '../../plotting/figureStyle';
import { CURVE_COLORS } from '../../plotting/colors';
import { AreaTool, areaFillTrace, areaShapes } from '../AreaTool';
import { areaFromRelayout, areaLimits, integrateRange } from '../../analysis/customArea';
import { GF_TO_N } from '../../types';
import { NumberField } from '../lapShear/NumberField';
import { GraphLabelControls, RunGraphControls, Y_OPTIONS, commonTitle, endLabelAnnotations, shortLabels, type LabelSeries, runStyle, unitText, yDigits, yFactor, type YUnit } from '../RunGraphControls';

const DISPLAY_LIMIT = 4000;
const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

function displayIndices(r: PeelRun, xs: ArrayLike<number>): number[] {
  const { loadGf } = r.result.curve.series;
  const valid: number[] = [];
  for (let i = 0; i < xs.length; i++) if (Number.isFinite(xs[i]) && Number.isFinite(loadGf[i])) valid.push(i);
  if (valid.length <= DISPLAY_LIMIT) return valid;
  const keep = new Set(lttbIndices(Float64Array.from(valid, (i) => xs[i]), Float64Array.from(valid, (i) => loadGf[i]), DISPLAY_LIMIT).map((k) => valid[k]));
  if (r.result.curve.peak) keep.add(r.result.curve.peak.index);
  return [...keep].sort((a, b) => a - b);
}

export function usePeelPlot() {
  const { ps, selected, set, setSettings } = usePeel();
  const v = ps.view;
  const s = ps.settings;
  const unit = v.unit;
  const dg = yDigits(unit);
  const autoY = unit === 'kPa' || unit === 'MPa' ? `Nominal stress F/A (${unit})` : unit === 'N/m' ? 'Peel energy (J/m²)' : `Peel force (${unit})`;
  const yTitle = v.yTitle.trim() || autoY;
  const autoX = 'Peel displacement δ = |z − z₀| (mm)';
  const xTitle = v.xTitle.trim() || autoX;
  const ut = unitText(unit);
  const runs = selected.filter((r) => r.result.ok);
  const areaRange = useMemo<[number, number] | null>(() => {
    let a = Infinity, b = -Infinity;
    for (const r of runs) { const sr = r.result.curve.series; for (const x of sr.dispMm) if (Number.isFinite(x)) { if (x < a) a = x; if (x > b) b = x; } }
    return Number.isFinite(a) && b > a ? [a, b] : null;
  }, [runs]);

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
      const series = res.curve.series;
      // Each run with its own gel area / width; peel energy G = F/w · (1 − cos θ) with its own peel angle (= F/w at 90°).
      const f = yFactor(unit, r.meta.lengthMm * r.meta.widthMm, r.meta.widthMm) * (unit === 'N/m' ? 1 - Math.cos((r.meta.angleDeg * Math.PI) / 180) : 1);
      if (!Number.isFinite(f)) return;
      const xs = series.dispMm;
      const idx = displayIndices(r, xs);
      const y = (i: number) => series.loadGf[i] * f;
      const name = v.names[r.id]?.trim() || short[k];
      labelSeries.push({ id: r.id, name, color, x: idx.map((i) => xs[i]), y: idx.map(y) });
      // Custom area (additional tool): shaded under this curve between the dashed boundaries.
      const areaFill = areaFillTrace(idx.map((i) => xs[i]), idx.map(y), v.area, rgba(color, 0.22), r.id);
      if (areaFill) traces.push(areaFill);
      if (st.shade && res.window.n > 1) {
        const inside = idx.filter((i) => series.dispMm[i] >= res.window.fromMm && series.dispMm[i] <= res.window.toMm);
        traces.push({ type: 'scatter', mode: 'lines', x: inside.map((i) => xs[i]), y: inside.map(y), fill: 'tozeroy', fillcolor: rgba(color, 0.18), line: { width: 0 }, hoverinfo: 'skip', showlegend: false, legendgroup: r.id } as unknown as Data);
        const x0 = xs[inside[0]];
        const x1 = xs[inside[inside.length - 1]];
        const mean = res.plateau.meanGf * f;
        traces.push({
          type: 'scatter', mode: 'lines', x: [x0, x1], y: [mean, mean], line: { color, width: 2, dash: 'dash' }, showlegend: false, legendgroup: r.id,
          hovertemplate: `${name}<br>Steady-state average ${mean.toFixed(dg)} ${ut} (window ${res.window.fromMm.toFixed(1)}–${res.window.toMm.toFixed(1)} mm)<extra></extra>`,
        } as unknown as Data);
      }
      if (v.showRaw && res.curve.baseline.applied) {
        traces.push({ type: 'scatter', mode: 'lines', name: `${name} (raw)`, x: idx.map((i) => xs[i]), y: idx.map((i) => res.curve.loadingSign * r.cycle.force_gf[i] * f), line: { color, width: 1, dash: 'dot' }, legendgroup: r.id } as unknown as Data);
      }
      traces.push({
        type: 'scatter', mode: 'lines', name, meta: r.id, x: idx.map((i) => xs[i]), y: idx.map(y), line: { color, width: st.width }, opacity: st.opacity, legendgroup: r.id,
        hovertemplate: `${name}<br>δ = %{x:.3f} mm<br>%{y:.${dg}f} ${ut}<extra></extra>`,
      } as unknown as Data);
      const pk = res.curve.peak;
      if (pk) {
        avoid.push(xs[pk.index]);
        traces.push({
          type: 'scatter', mode: 'markers', x: [xs[pk.index]], y: [pk.forceGf * f], marker: { symbol: 'triangle-up', size: 12, color, line: { color: '#18263A', width: 1 } }, opacity: st.opacity, meta: r.id, showlegend: false, legendgroup: r.id,
          hovertemplate: `${name}<br>Peak ${(pk.forceGf * f).toFixed(dg)} ${ut} at δ = ${pk.dispMm.toFixed(2)} mm<extra></extra>`,
        } as unknown as Data);
        if (v.peakLabels && st.labels) annotations.push({ x: xs[pk.index], y: pk.forceGf * f, text: `${(pk.forceGf * f).toFixed(Math.max(1, dg - 1))} ${ut}`, showarrow: true, arrowhead: 0, ax: 0, ay: -22, font: peakLabelFont(color), bgcolor: 'rgba(255,255,255,0.8)' });
      }
      if (res.detach.dispMm !== null) {
        let di = -1;
        for (let i = 0; i < series.dispMm.length; i++) if (series.dispMm[i] >= res.detach.dispMm) { di = i; break; }
        if (di >= 0) traces.push({ type: 'scatter', mode: 'markers', x: [xs[di]], y: [y(di)], marker: { symbol: 'x-thin', size: 12, line: { color, width: 2.5 } }, opacity: st.opacity, showlegend: false, legendgroup: r.id, hovertemplate: `${name}<br>Detachment (${res.detach.source}) at δ = ${res.detach.dispMm.toFixed(2)} mm<extra></extra>` } as unknown as Data);
      }
    });
    const ends = endLabelAnnotations(labelSeries);
    const lay: Partial<Layout> = {
      ...figLayout(),
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      xaxis: figAxis(xTitle),
      yaxis: figAxis(yTitle),
      legend: { orientation: 'v', x: 1.01, y: 1, font: { size: 15, color: '#000' } },
      showlegend: v.labels === 'legend' || (v.labels === 'curve' && ends.tooMany),
      annotations: v.labels === 'curve' ? [...annotations, ...ends.annotations] : annotations,
      margin: { l: 90, r: v.labels === 'curve' && !ends.tooMany ? ends.marginRight : 16, t: v.title.trim() ? 64 : 20, b: 78 },
      ...(v.title.trim() ? { title: { text: `<b>${v.title.trim()}</b>`, font: { size: 22, color: '#000' }, x: 0.5, xanchor: 'center' } } : {}),
      // Keep labels the user dragged while the graph updates.
      editrevision: 'labels',
      dragmode: 'zoom',
      hovermode: 'closest',
      uirevision: unit,
      shapes: areaShapes(v.area),
    };
    return { data: traces, layout: lay };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, v, unit, xTitle, yTitle]);
  return { v, s, unit, runs, autoX, autoY, areaRange, data, layout, set, setSettings };
}

export function PeelGraph() {
  const plotEl = useRef<PlotlyHTMLElement | null>(null);
  const { v, s, unit, runs, autoX, autoY, areaRange, data, layout, set, setSettings } = usePeelPlot();

  const save = async (format: 'png' | 'svg') => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.downloadImage(plotEl.current, { format, filename: 'peel_90', ...EXPORT_SIZE, scale: format === 'png' ? 4 : 1 } as never);
  };
  const resetZoom = async () => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.relayout(plotEl.current, { 'xaxis.autorange': true, 'yaxis.autorange': true });
  };
  const pl = s.plateau;
  return (
    <section className="graph-panel" aria-label="90° peel graph">
      <div className="graph-toolbar">
        <label title="Stress uses each run's own gel area (length × width); peel energy G = F/w · (1 − cos θ) uses its gel width and peel angle (Kendall 1975; Creton & Ciccotti 2016)">
          Y axis
          <select className="y-select" value={unit} onChange={(e) => set({ view: { ...v, unit: e.target.value as YUnit, yTitle: '' } })}>
            {Y_OPTIONS.peel.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="vs">vs displacement</span>
        </label>
        <label className="check"><input type="checkbox" checked={v.peakLabels} onChange={(e) => set({ view: { ...v, peakLabels: e.target.checked } })} /> Peak labels</label>
        <RunGraphControls view={v} set={(view) => set({ view })} runs={runs} shadeLabel="Shades the steady-state window and draws its average peel force (dashed)" />
        {runs.some((r) => r.result.curve.baseline.applied) && <label className="check"><input type="checkbox" checked={v.showRaw} onChange={(e) => set({ view: { ...v, showRaw: e.target.checked } })} /> Raw curve</label>}
        <button className="link" onClick={resetZoom}>Reset zoom</button>
        <div className="export-group">
          <span>Save graph</span>
          <button className="small" onClick={() => save('png')}>PNG</button>
          <button className="small" onClick={() => save('svg')}>SVG</button>
          <button className="small" disabled={!data.length} onClick={() => download(buildPlotWorkbook('90° Peel', data, layout), '90_peel_graph.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}>XLSX</button>
        </div>
      </div>
      <GraphLabelControls view={v} set={(view) => set({ view })} runs={runs} suggestion={commonTitle(runs.map((r) => r.cond))} autoX={autoX} autoY={autoY} />
      <div className="graph-toolbar integration-bar">
        <label>
          Steady-state window
          <select value={pl.mode} onChange={(e) => setSettings({ plateau: { ...pl, mode: e.target.value as 'auto' | 'custom' } })}>
            <option value="auto">Fraction of peeled length</option>
            <option value="custom">Custom displacement range</option>
          </select>
        </label>
        {pl.mode === 'auto' ? (
          <>
            <NumberField label="from (%)" value={+(pl.startFrac * 100).toFixed(4)} min={0} onCommit={(x) => x !== null && setSettings({ plateau: { ...pl, startFrac: Math.min(x, 100) / 100 } })} />
            <NumberField label="to (%)" value={+(pl.endFrac * 100).toFixed(4)} min={0} onCommit={(x) => x !== null && setSettings({ plateau: { ...pl, endFrac: Math.min(x, 100) / 100 } })} />
          </>
        ) : (
          <>
            <NumberField label="from (mm)" value={pl.fromMm} min={0} onCommit={(x) => x !== null && setSettings({ plateau: { ...pl, fromMm: x } })} />
            <NumberField label="to (mm)" value={pl.toMm} min={0} onCommit={(x) => x !== null && setSettings({ plateau: { ...pl, toMm: x } })} />
          </>
        )}
        <span className="view-help">Click a curve to highlight it · shading = steady-state window with its average force (dashed) · ▲ peak · × detachment</span>
      </div>
      {runs.length === 0 ? (
        <div className="empty-plot">
          <p>No runs selected.</p>
          <p>Open your 90° peel TXT files on the left and tick the runs to compare.</p>
        </div>
      ) : (
        <>
          <PlotlyChart data={data} layout={layout} onRelayout={(e) => { const a = areaFromRelayout(e, v.area); if (a && a.fromMm !== null && a.toMm !== null) set({ view: { ...v, area: { fromMm: +a.fromMm.toFixed(4), toMm: +a.toMm.toFixed(4) } } }); }} onClick={(e) => { const m = e.points[0]?.data.meta; if (typeof m === 'string') set({ view: { ...v, highlight: v.highlight === m ? null : m } }); }} onLegendClick={(m) => { if (typeof m !== 'string') return true; set({ view: { ...v, highlight: v.highlight === m ? null : m } }); return false; }} onReady={(el) => (plotEl.current = el)} config={{ editable: true, edits: { annotationPosition: true, annotationTail: true, annotationText: false, axisTitleText: false, titleText: false, legendText: false, legendPosition: true, colorbarTitleText: false, colorbarPosition: false, shapePosition: true }, toImageButtonOptions: { format: 'png', filename: 'peel_90', scale: 3 } }} />
          <AreaTool area={v.area} setArea={(area) => set({ view: { ...v, area } })} xRangeMm={areaRange} rows={runs.filter((r) => r.result.ok).map((r) => { const lim = areaLimits(v.area); const sr = r.result.curve.series; const res = lim ? integrateRange(sr.dispMm, Array.from(sr.loadGf, (g) => g * GF_TO_N), lim[0], lim[1]) : { workMJ: NaN, covered: true }; return { id: r.id, label: v.names[r.id]?.trim() || r.label, workMJ: res.workMJ, covered: res.covered }; })}  note="Raw selected work only; it is not the peel energy G_peel." />
        </>
      )}
    </section>
  );
}
