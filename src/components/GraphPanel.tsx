import { useMemo, useRef, useState } from 'react';
import type { Data, Layout, PlotlyHTMLElement } from 'plotly.js';
import { useApp, useGraphActions, download } from '../state/AppContext';
import { PlotlyChart, loadPlotly } from '../plotting/PlotlyChart';
import { axisLabel, axisOptions, axisValues, curveLabel } from '../plotting/axes';
import { lttbIndices } from '../plotting/downsample';
import { CURVE_COLORS } from '../plotting/colors';
import { STATUS_LABEL, isIncluded } from '../analysis/engine';
import { buildGraphWorkbook } from '../export/workbook';
import { useOpenRun } from './common';

const DISPLAY_LIMIT = 4000;
const EXCLUDED_COLOR = '#9AA6B5';

export function GraphPanel() {
  const { project, update, derived, ui, setUi } = useApp();
  const { active, removeFromActive } = useGraphActions();
  const openRun = useOpenRun();
  const s = project.settings;
  const plotEl = useRef<PlotlyHTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);

  const extraCols = useMemo(() => {
    const set = new Set<string>();
    for (const id of active.cycleIds) {
      const r = derived.results.get(id);
      if (r) Object.keys(r.cycle.extra).forEach((k) => set.add(k));
    }
    return [...set];
  }, [active.cycleIds, derived]);
  const options = axisOptions(s, extraCols);

  const curves = useMemo(
    () => active.cycleIds.map((id) => derived.results.get(id)).filter((r): r is NonNullable<typeof r> => !!r),
    [active.cycleIds, derived],
  );
  const missing = active.cycleIds.length - curves.length;
  const nExcluded = curves.filter((r) => !isIncluded(r)).length;
  const isDrawn = (r: (typeof curves)[number]) => !active.hidden.includes(r.cycle.cycleId) && (isIncluded(r) || active.showExcluded);

  const { data, layout } = useMemo(() => {
    const traces: Data[] = [];
    curves.forEach((r, k) => {
      if (!isDrawn(r)) return;
      const excluded = !isIncluded(r);
      const color = excluded ? EXCLUDED_COLOR : CURVE_COLORS[k % CURVE_COLORS.length];
      const xs = axisValues(r, active.x, s);
      const ys = axisValues(r, active.y, s);
      if (!xs || !ys) return;
      const name = curveLabel(r) + (excluded ? ' (excluded)' : '');
      const idx = xs.length > DISPLAY_LIMIT ? lttbIndices(xs, ys, DISPLAY_LIMIT) : Array.from(xs, (_, i) => i);
      const meta = r.cycle.cycleId;
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: idx.map((i) => xs[i]),
        // Points removed by the (advanced) point rule or by hand stay gaps; with the default rule this is the raw curve.
        y: idx.map((i) => (r.include[i] ? ys[i] : null)),
        customdata: idx,
        meta,
        legendgroup: meta,
        connectgaps: false,
        name,
        line: excluded ? { color, width: 1, dash: 'dash' } : { color, width: 1.8 },
        hovertemplate: `${name}<br>x = %{x:.4f}<br>y = %{y:.4f}<br>point %{customdata}<extra></extra>`,
      } as unknown as Data);
      if (active.showMarkers) {
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
            legendgroup: meta,
            showlegend: false,
            marker: { symbol: 'triangle-down', size: excluded ? 8 : 11, color, line: { color: '#18263A', width: 1 } },
            hovertemplate: `${name}<br>Minimum force: y = %{y:.4f}, x = %{x:.4f}<br>point %{customdata}<extra></extra>`,
          } as unknown as Data);
        }
      }
    });
    const lay: Partial<Layout> = {
      margin: { l: 64, r: curves.length <= 12 ? 8 : 16, t: 36, b: 52 },
      title: { text: active.title, font: { size: 14, family: 'IBM Plex Sans, sans-serif' }, x: 0.01, xanchor: 'left' },
      font: { family: 'IBM Plex Sans, system-ui, sans-serif', size: 12, color: '#18263A' },
      paper_bgcolor: '#ffffff',
      plot_bgcolor: '#ffffff',
      xaxis: { title: { text: axisLabel(active.x, s) }, zeroline: true, zerolinecolor: '#C9D2DD', gridcolor: '#EEF2F6', linecolor: '#9AA6B5', mirror: true },
      yaxis: { title: { text: axisLabel(active.y, s) }, zeroline: true, zerolinecolor: '#C9D2DD', gridcolor: '#EEF2F6', linecolor: '#9AA6B5', mirror: true },
      showlegend: curves.length <= 12,
      legend: { orientation: 'v', x: 1.01, y: 1, font: { size: 10 }, bgcolor: 'rgba(255,255,255,0.85)' },
      dragmode: 'zoom',
      hovermode: 'closest',
      uirevision: `${active.id}|${active.x}|${active.y}`,
    };
    return { data: traces, layout: lay };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curves, active, s]);

  const onClick = (e: { points: { data: { meta?: unknown } }[] }) => {
    const meta = e.points[0]?.data.meta;
    if (typeof meta === 'string') setUi({ focusId: meta });
  };

  const resetZoom = async () => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.relayout(plotEl.current, { 'xaxis.autorange': true, 'yaxis.autorange': true });
  };

  const setGraph = (patch: Partial<typeof active>) =>
    update((p) => ({ ...p, graphs: p.graphs.map((g) => (g.id === active.id ? { ...g, ...patch } : g)) }));

  const exportImage = async (format: 'png' | 'svg', scale: number) => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.downloadImage(plotEl.current, {
      format,
      filename: active.title.replace(/[^\w.-]+/g, '_'),
      width: 1200,
      height: 750,
      scale,
    } as never);
  };

  const exportGraphData = () => {
    // Export what is drawn: hidden curves (and excluded runs when they are not shown) are left out.
    const drawn = { ...active, hidden: curves.filter((r) => !isDrawn(r)).map((r) => r.cycle.cycleId) };
    const bytes = buildGraphWorkbook(derived, project, drawn, true);
    download(bytes, `${active.title.replace(/[^\w.-]+/g, '_')}_data.xlsx`);
  };

  return (
    <section className="graph-panel" aria-label="Graphs">
      <div className="graph-tabs" role="tablist">
        {project.graphs.map((g) => (
          <button
            key={g.id}
            role="tab"
            aria-selected={g.id === active.id}
            className={g.id === active.id ? 'tab active' : 'tab'}
            onClick={() => update((p) => ({ ...p, activeGraphId: g.id }))}
            onDoubleClick={() => setRenaming(true)}
          >
            {g.title} <span className="count">{g.cycleIds.length}</span>
          </button>
        ))}
        <button
          className="tab add"
          title="New empty graph"
          onClick={() =>
            update((p) => {
              const g = { ...p.graphs[0], id: `g${Date.now().toString(36)}`, title: `Graph ${p.graphs.length + 1}`, cycleIds: [], hidden: [] };
              return { ...p, graphs: [...p.graphs, g], activeGraphId: g.id };
            })
          }
        >
          + New graph
        </button>
      </div>

      <div className="graph-toolbar">
        {renaming ? (
          <input
            className="title-input"
            autoFocus
            defaultValue={active.title}
            onBlur={(e) => {
              setGraph({ title: e.target.value || active.title });
              setRenaming(false);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button className="link" onClick={() => setRenaming(true)} title="Rename graph">
            Rename
          </button>
        )}
        <label>
          Y
          <select value={active.y} onChange={(e) => setGraph({ y: e.target.value })}>
            {options.map((o) => (
              <option key={o.id} value={o.id} title={o.description}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          X
          <select value={active.x} onChange={(e) => setGraph({ x: e.target.value })}>
            {options.map((o) => (
              <option key={o.id} value={o.id} title={o.description}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button className="link" onClick={() => setGraph({ x: active.y, y: active.x })} title="Swap X and Y">
          Swap axes
        </button>
        <label className="check" title="Mark each run's minimum force (▼)">
          <input type="checkbox" checked={active.showMarkers} onChange={(e) => setGraph({ showMarkers: e.target.checked })} /> Min marker
        </label>
        <label className="check" title="Draw excluded runs as thin grey dashed lines">
          <input type="checkbox" checked={active.showExcluded} onChange={(e) => setGraph({ showExcluded: e.target.checked })} /> Show excluded runs
        </label>
        <button className="link" onClick={resetZoom} title="Drag on the graph to zoom, scroll to zoom; double-click also resets">
          Reset zoom
        </button>
        <div className="export-group" role="group" aria-label="Export graph">
          <span>Export</span>
          <button className="small" onClick={() => exportImage('png', 4)} title="High-resolution PNG (4×)">PNG</button>
          <button className="small" onClick={() => exportImage('svg', 1)} title="Vector graphic for papers">SVG</button>
          <button className="small" onClick={exportGraphData} title="Plotted data with an editable Excel chart">XLSX</button>
        </div>
      </div>
      <p className="view-help">
        Drag to zoom. {nExcluded > 0 ? `${nExcluded} of ${curves.length} run(s) are excluded from processed statistics${active.showExcluded ? ' (grey dashed)' : ' and hidden'}.` : ''}
        {missing > 0 ? ` ${missing} curve(s) in this graph belong to files that are not loaded.` : ''}
      </p>

      {curves.length === 0 ? (
        <div className="empty-plot">
          <p>This graph has no curves yet.</p>
          <p>Tick runs in the navigator on the left, then choose “Add to graph”.</p>
        </div>
      ) : (
        <PlotlyChart
          data={data}
          layout={layout}
          onClick={onClick}
          onReady={(el) => (plotEl.current = el)}
          config={{ toImageButtonOptions: { format: 'png', filename: active.title, scale: 3 } }}
        />
      )}

      {curves.length > 0 && (
        <div className="curve-list" aria-label="Curves in this graph">
          {curves.map((r, k) => {
            const hidden = active.hidden.includes(r.cycle.cycleId);
            return (
              <div key={r.cycle.cycleId} className={`curve ${hidden ? 'off' : ''} ${isIncluded(r) ? '' : 'excluded'} ${ui.focusId === r.cycle.cycleId ? 'focus' : ''}`}>
                <input
                  type="checkbox"
                  checked={!hidden}
                  aria-label="Show curve"
                  onChange={() =>
                    setGraph({ hidden: hidden ? active.hidden.filter((x) => x !== r.cycle.cycleId) : [...active.hidden, r.cycle.cycleId] })
                  }
                />
                <span className={`swatch ${isIncluded(r) ? '' : 'dashed'}`} style={isIncluded(r) ? { background: CURVE_COLORS[k % CURVE_COLORS.length] } : undefined} />
                <button className="link curve-name" onClick={() => openRun(r.cycle.cycleId)} title="Open in Data analysis">
                  {curveLabel(r)}
                </button>
                <span className={`qc-dot ${r.qc}`} title={`Flag: ${r.qc}. ${STATUS_LABEL[r.status]}`} />
                <button className="icon" title="Remove from this graph" onClick={() => removeFromActive([r.cycle.cycleId])}>
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
