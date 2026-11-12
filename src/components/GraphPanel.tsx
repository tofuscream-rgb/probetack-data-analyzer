import { useMemo, useRef } from 'react';
import type { Data, Layout, PlotlyHTMLElement } from 'plotly.js';
import { useApp, useGraphActions, download } from '../state/AppContext';
import { useExperiment } from '../state/experiment';
import { PlotlyChart, loadPlotly } from '../plotting/PlotlyChart';
import { axisLabel, axisOptions, axisValues, needsProbe } from '../plotting/axes';
import { ProbeFields } from './ProbeFields';
import { lttbIndices } from '../plotting/downsample';
import { EXPORT_SIZE, LINE, figAxis, figLayout } from '../plotting/figureStyle';
import { CURVE_COLORS } from '../plotting/colors';
import { STATUS_LABEL, isIncluded, type CycleResult } from '../analysis/engine';
import { QC_LABEL } from '../analysis/pointOutliers';
import { buildPlotWorkbook } from '../export/plotWorkbook';
import type { GraphConfig } from '../types';
import { useOpenRun } from './common';

const DISPLAY_LIMIT = 4000;
const EXCLUDED_COLOR = '#9AA6B5';

/** The graph as currently shown: runs of the chosen file(s), with its axes and options. */
export function useCurrentGraph(): GraphConfig {
  const { active } = useGraphActions();
  const ex = useExperiment();
  const names = ex.graphFiles.map((e) => e.file.name);
  return {
    ...active,
    title: ex.main ? `${ex.title} – ${names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ')}` : active.title,
    cycleIds: ex.graphRuns.map((r) => r.cycle.cycleId),
  };
}

export function useTackPlot() {
  const { project } = useApp();
  const ex = useExperiment();
  const graph = useCurrentGraph();
  const s = project.settings;
  const pos = s.forceSign === 'positive';
  const multi = ex.graphFiles.length > 1;
  const probeAxes = needsProbe(graph.x) || needsProbe(graph.y);
  const probeMissing = (graph.x === 'strain' || graph.y === 'strain' ? !(s.probe.thicknessMm > 0) : false) || ([graph.x, graph.y].some((a) => a.startsWith('stress_')) ? !(s.probe.diameterMm > 0) : false);

  const extraCols = useMemo(() => [...new Set(ex.graphRuns.flatMap((r) => Object.keys(r.cycle.extra)))], [ex.graphRuns]);
  const options = axisOptions(s, extraCols);
  const curves = ex.graphRuns;
  const nExcluded = curves.filter((r) => !isIncluded(r)).length;
  const isDrawn = (r: CycleResult) => !graph.hidden.includes(r.cycle.cycleId) && (isIncluded(r) || graph.showExcluded);
  // One file: a colour per run. Several files: a colour per file, so files are easy to tell apart.
  const colorOf = (r: CycleResult) => {
    const k = multi ? ex.graphFiles.findIndex((e) => e.file.fileId === r.file.fileId) : curves.indexOf(r);
    return CURVE_COLORS[Math.max(0, k) % CURVE_COLORS.length];
  };
  const nameOf = (r: CycleResult) => `${r.file.name} – Run ${r.cycle.cycleNumber}`;

  const { data, layout } = useMemo(() => {
    const traces: Data[] = [];
    for (const r of curves) {
      if (!isDrawn(r)) continue;
      const excluded = !isIncluded(r);
      const color = excluded ? EXCLUDED_COLOR : colorOf(r);
      const xs = axisValues(r, graph.x, s);
      const ys = axisValues(r, graph.y, s);
      if (!xs || !ys) continue;
      const name = nameOf(r) + (excluded ? ' (outlier, left out)' : '');
      const idx = xs.length > DISPLAY_LIMIT ? lttbIndices(xs, ys, DISPLAY_LIMIT) : Array.from(xs, (_, i) => i);
      const meta = r.cycle.cycleId;
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: idx.map((i) => xs[i]),
        // Points removed by the (advanced) point rule or by hand stay gaps; by default this is the raw curve.
        y: idx.map((i) => (r.include[i] ? ys[i] : null)),
        customdata: idx,
        meta,
        legendgroup: multi ? r.file.fileId : meta,
        connectgaps: false,
        name,
        line: excluded ? { color, width: LINE.faded, dash: 'dash' } : { color, width: LINE.normal },
        hovertemplate: `${name}<br>x = %{x:.4f}<br>y = %{y:.4f}<br>point %{customdata}<extra></extra>`,
      } as unknown as Data);
      if (graph.showMarkers) {
        let iMin = -1;
        for (let i = 0; i < r.cycle.force_gf.length; i++) {
          if (!r.include[i]) continue;
          if (iMin < 0 || r.cycle.force_gf[i] < r.cycle.force_gf[iMin]) iMin = i;
        }
        if (iMin >= 0) {
          traces.push({
            type: 'scatter',
            mode: 'markers',
            x: [xs[iMin]],
            y: [ys[iMin]],
            customdata: [iMin],
            meta,
            legendgroup: multi ? r.file.fileId : meta,
            showlegend: false,
            marker: { symbol: pos ? 'triangle-up' : 'triangle-down', size: excluded ? 8 : 11, color, line: { color: '#18263A', width: 1 } },
            hovertemplate: `${name}<br>${pos ? 'Peak adhesion force' : 'Minimum force'}: y = %{y:.4f}, x = %{x:.4f}<br>point %{customdata}<extra></extra>`,
          } as unknown as Data);
        }
      }
    }
    const lay: Partial<Layout> = {
      ...figLayout({ margin: { l: 90, r: 16, t: 46, b: 78 } }),
      title: { text: `<b>${graph.title}</b>`, font: { size: 18, color: '#000' }, x: 0.01, xanchor: 'left' },
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      xaxis: figAxis(axisLabel(graph.x, s)),
      yaxis: figAxis(axisLabel(graph.y, s)),
      showlegend: curves.length <= 15,
      legend: { orientation: 'v', x: 1.01, y: 1, font: { size: 14, color: '#000' }, bgcolor: 'rgba(255,255,255,0.85)' },
      dragmode: 'zoom',
      hovermode: 'closest',
      uirevision: `${graph.x}|${graph.y}|${ex.main?.file.fileId}`,
    };
    return { data: traces, layout: lay };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curves, graph.hidden, graph.showExcluded, graph.showMarkers, graph.x, graph.y, graph.title, s, multi]);
  return { ex, graph, s, pos, multi, probeAxes, probeMissing, options, curves, nExcluded, isDrawn, colorOf, nameOf, data, layout };
}

export function GraphPanel() {
  const { update, ui, setUi } = useApp();
  const openRun = useOpenRun();
  const plotEl = useRef<PlotlyHTMLElement | null>(null);
  const { ex, graph, s, pos, multi, probeAxes, probeMissing, options, curves, nExcluded, colorOf, nameOf, data, layout } = useTackPlot();

  const setGraph = (patch: Partial<GraphConfig>) =>
    update((p) => ({ ...p, graphs: p.graphs.map((g) => (g.id === graph.id ? { ...g, ...patch } : g)) }));
  const setHidden = (ids: string[], hide: boolean) =>
    setGraph({ hidden: hide ? [...new Set([...graph.hidden, ...ids])] : graph.hidden.filter((x) => !ids.includes(x)) });

  const fileName = graph.title.replace(/[^\w.-]+/g, '_').slice(0, 80);
  const exportImage = async (format: 'png' | 'svg', scale: number) => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.downloadImage(plotEl.current, { format, filename: fileName, ...EXPORT_SIZE, scale } as never);
  };
  const resetZoom = async () => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.relayout(plotEl.current, { 'xaxis.autorange': true, 'yaxis.autorange': true });
  };
  const exportGraphData = () => {
    download(buildPlotWorkbook(graph.title, data, layout), 'probe_tack_graph.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  if (!ex.main) {
    return (
      <div className="empty-plot">
        <p>No experiment to show yet.</p>
        <p>Open your experiment folder in step 1 on the left, then choose the experiment and TXT file in step 2.</p>
      </div>
    );
  }

  return (
    <section className="graph-panel" aria-label="Graph">
      <div className="graph-toolbar">
        <label>
          Y
          <select value={graph.y} onChange={(e) => setGraph({ y: e.target.value })}>
            {options.map((o) => <option key={o.id} value={o.id} title={o.description}>{o.label}</option>)}
          </select>
        </label>
        <label>
          X
          <select value={graph.x} onChange={(e) => setGraph({ x: e.target.value })}>
            {options.map((o) => <option key={o.id} value={o.id} title={o.description}>{o.label}</option>)}
          </select>
        </label>
        <button className="link" onClick={() => setGraph({ x: graph.y, y: graph.x })} title="Swap X and Y">Swap axes</button>
        <button
          className={`small ${graph.x === 'strain' && graph.y.startsWith('stress_') ? 'on' : ''}`}
          onClick={() => setGraph({ x: 'strain', y: 'stress_kPa' })}
          title="Nominal stress σN = F / Amax vs nominal strain ε = Δh / h₀ (Creton & Ciccotti 2016)"
        >
          Stress–strain
        </button>
        <button className="small" onClick={() => setGraph({ x: 'disp_mm', y: 'force' })} title="Force vs displacement">Force–displacement</button>
        <label className="check" title={pos ? "Mark each run's peak adhesion force (▲)" : "Mark each run's minimum force (▼)"}>
          <input type="checkbox" checked={graph.showMarkers} onChange={(e) => setGraph({ showMarkers: e.target.checked })} /> {pos ? 'Peak marker' : 'Min marker'}
        </label>
        <label className="check" title="Draw runs that are left out of the averages as thin grey dashed lines">
          <input type="checkbox" checked={graph.showExcluded} onChange={(e) => setGraph({ showExcluded: e.target.checked })} /> Show outlier runs
        </label>
        <button className="link" onClick={resetZoom} title="Drag on the graph to zoom, scroll to zoom; double-click also resets">Reset zoom</button>
        <div className="export-group" role="group" aria-label="Export graph">
          <span>Save graph</span>
          <button className="small" onClick={() => exportImage('png', 4)} title="High-resolution PNG (4×)">PNG</button>
          <button className="small" onClick={() => exportImage('svg', 1)} title="Vector graphic for papers">SVG</button>
          <button className="small" onClick={exportGraphData} title="Plotted data with an editable Excel chart">XLSX</button>
        </div>
      </div>
      {probeAxes && (
        <div className="graph-toolbar integration-bar probe-bar">
          <ProbeFields />
          <span className="view-help">
            σN = F / Amax, Amax = π (d/2)² of the flat probe · ε = Δh / h₀, Δh = displacement of each run from its start (Creton &amp; Ciccotti 2016, eq. 9).
            {probeMissing ? ' Enter the probe diameter and gel thickness to draw the curve.' : ''}
          </span>
        </div>
      )}
      <p className="view-help">
        Drag to zoom.{' '}
        {nExcluded > 0 ? `${nExcluded} of ${curves.length} run(s) are outliers left out of the averages${graph.showExcluded ? ' (grey dashed)' : ' and hidden'}.` : ''}
        {!multi && ex.files.length > 1 ? ' Tick “Overlay additional TXT files” on the left to compare files.' : ''}
      </p>

      <PlotlyChart
        data={data}
        layout={layout}
        onClick={(e) => { const m = e.points[0]?.data.meta; if (typeof m === 'string') setUi({ focusId: m }); }}
        onReady={(el) => (plotEl.current = el)}
        config={{ toImageButtonOptions: { format: 'png', filename: fileName, scale: 3 } }}
      />

      <div className="curve-list" aria-label="Runs on this graph">
        {ex.graphFiles.map((e) => {
          const ids = e.runs.map((r) => r.cycle.cycleId);
          const shown = ids.filter((id) => !graph.hidden.includes(id)).length;
          return (
            <div key={e.file.fileId} className="curve-file">
              <label className="check-row cf-head">
                <input
                  type="checkbox"
                  checked={shown === ids.length}
                  ref={(el) => { if (el) el.indeterminate = shown > 0 && shown < ids.length; }}
                  onChange={() => setHidden(ids, shown === ids.length)}
                />
                {multi && <span className="swatch" style={{ background: colorOf(e.runs[0]) }} />}
                <strong>{e.file.name}</strong>
              </label>
              {e.runs.map((r) => {
                const hidden = graph.hidden.includes(r.cycle.cycleId);
                return (
                  <span key={r.cycle.cycleId} className={`curve ${hidden ? 'off' : ''} ${isIncluded(r) ? '' : 'excluded'} ${ui.focusId === r.cycle.cycleId ? 'focus' : ''}`}>
                    <input type="checkbox" checked={!hidden} aria-label={`Show ${nameOf(r)}`} onChange={() => setHidden([r.cycle.cycleId], !hidden)} />
                    {!multi && <span className={`swatch ${isIncluded(r) ? '' : 'dashed'}`} style={isIncluded(r) ? { background: colorOf(r) } : undefined} />}
                    <button className="link curve-name" onClick={() => openRun(r.cycle.cycleId)} title={`Open in Data analysis. ${QC_LABEL[r.qc]}. ${STATUS_LABEL[r.status]}.`}>
                      Run {r.cycle.cycleNumber}
                    </button>
                    <span className={`qc-dot ${r.qc}`} />
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}
