import { useMemo, useRef, useState } from 'react';
import type { Data, Layout, PlotlyHTMLElement, PlotSelectionEvent } from 'plotly.js';
import { useApp, useGraphActions, download } from '../state/AppContext';
import { PlotlyChart, loadPlotly } from '../plotting/PlotlyChart';
import { axisLabel, axisOptions, axisValues, curveLabel } from '../plotting/axes';
import { lttbIndices } from '../plotting/downsample';
import { QC_LABEL, QC_ORDER } from '../analysis/pointOutliers';
import { CURVE_COLORS, QC_COLORS } from '../plotting/colors';
import { buildGraphWorkbook } from '../export/workbook';
import type { ViewMode } from '../types';

const DISPLAY_LIMIT = 4000;

const VIEW_HELP: Record<ViewMode, string> = {
  raw: 'Original measurements, unmodified.',
  flagged: 'Original curve with Level A point flags (yellow, orange, red).',
  processed: 'Points removed by the current exclusion rule or by hand are left as gaps (never joined).',
  compare: 'Raw curve (grey, dotted) under the processed curve.',
};

export function GraphPanel() {
  const { project, update, derived, ui, setUi, notify } = useApp();
  const { active, removeFromActive } = useGraphActions();
  const s = project.settings;
  const view = project.view;
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

  const { data, layout } = useMemo(() => {
    const traces: Data[] = [];
    curves.forEach((r, k) => {
      if (active.hidden.includes(r.cycle.cycleId)) return;
      const color = CURVE_COLORS[k % CURVE_COLORS.length];
      const xs = axisValues(r, active.x, s);
      const ys = axisValues(r, active.y, s);
      if (!xs || !ys) return;
      const name = curveLabel(r);
      const idx = xs.length > DISPLAY_LIMIT ? lttbIndices(xs, ys, DISPLAY_LIMIT) : Array.from(xs, (_, i) => i);
      const X = idx.map((i) => xs[i]);
      const Yraw = idx.map((i) => ys[i]);
      const Yproc = idx.map((i) => (r.include[i] ? ys[i] : null));
      const meta = r.cycle.cycleId;
      const hover = `${name}<br>x = %{x:.4f}<br>y = %{y:.4f}<br>point %{customdata}<extra></extra>`;
      const common = { type: 'scatter' as const, mode: 'lines' as const, x: X, customdata: idx, meta, hovertemplate: hover, legendgroup: meta };
      if (view === 'compare') {
        traces.push({ ...common, y: Yraw, name: `${name} (raw)`, line: { color: '#9AA6B5', width: 1, dash: 'dot' }, showlegend: false } as unknown as Data);
      }
      traces.push({
        ...common,
        y: view === 'processed' || view === 'compare' ? Yproc : Yraw,
        connectgaps: false,
        name,
        line: { color, width: 1.8 },
      } as unknown as Data);
      if (view === 'flagged') {
        for (let c = 1; c <= 3; c++) {
          const pts = idx.filter((i) => r.points.cls[i] === c);
          if (!pts.length) continue;
          traces.push({
            type: 'scatter',
            mode: 'markers',
            x: pts.map((i) => xs[i]),
            y: pts.map((i) => ys[i]),
            customdata: pts,
            meta,
            legendgroup: meta,
            showlegend: false,
            marker: { color: QC_COLORS[QC_ORDER[c]], size: 7 + c * 2, line: { color: '#fff', width: 1 } },
            text: pts.map((i) => `${QC_LABEL[QC_ORDER[c]]}<br>score ${r.points.score[i].toFixed(2)}, robust z ${r.points.z[i].toFixed(1)}`),
            hovertemplate: `${name}<br>point %{customdata}<br>%{text}<extra></extra>`,
            name: QC_LABEL[QC_ORDER[c]],
          } as unknown as Data);
        }
      }
      if (active.showMarkers) {
        const use = view === 'processed' || view === 'compare' ? r.include : null;
        let iMin = -1;
        let iMax = -1;
        for (let i = 0; i < r.cycle.force_gf.length; i++) {
          if (use && !use[i]) continue;
          const f = r.cycle.force_gf[i];
          if (iMin < 0 || f < r.cycle.force_gf[iMin]) iMin = i;
          if (iMax < 0 || f > r.cycle.force_gf[iMax]) iMax = i;
        }
        if (iMin >= 0) {
          traces.push({
            type: 'scatter',
            mode: 'markers',
            x: [xs[iMin], xs[iMax]],
            y: [ys[iMin], ys[iMax]],
            customdata: [iMin, iMax],
            meta,
            legendgroup: meta,
            showlegend: false,
            marker: { symbol: ['triangle-down', 'triangle-up'], size: 11, color, line: { color: '#18263A', width: 1 } },
            text: ['Minimum force', 'Maximum force'],
            hovertemplate: `${name}<br>%{text}: y = %{y:.4f}, x = %{x:.4f}<br>point %{customdata}<extra></extra>`,
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
      dragmode: ui.plotTool === 'zoom' ? 'zoom' : 'select',
      selectdirection: ui.plotTool === 'baseline' ? 'h' : 'any',
      hovermode: 'closest',
      uirevision: `${active.id}|${active.x}|${active.y}`,
    };
    return { data: traces, layout: lay };
  }, [curves, active, s, view, ui.plotTool]);

  const onSelected = (e: PlotSelectionEvent) => {
    if (ui.plotTool === 'excludePoints') {
      const now = new Date().toISOString();
      const add: Record<string, number[]> = {};
      for (const p of e.points) {
        const meta = (p.data as { meta?: string }).meta;
        const idx = (p as unknown as { customdata?: number }).customdata;
        if (typeof meta === 'string' && typeof idx === 'number') (add[meta] ??= []).push(idx);
      }
      const n = Object.values(add).reduce((a, b) => a + new Set(b).size, 0);
      if (!n) return;
      update((pr) => {
        const ep = { ...pr.excludedPoints };
        for (const [cid, list] of Object.entries(add)) {
          const cur = { ...(ep[cid] ?? {}) };
          for (const i of list) cur[String(i)] = { reason: 'Selected on graph', at: now };
          ep[cid] = cur;
        }
        return { ...pr, excludedPoints: ep, view: pr.view === 'raw' || pr.view === 'flagged' ? 'compare' : pr.view };
      });
      notify('info', `${n} point(s) manually excluded. Undo in the Run panel or with Restore original data.`);
    } else if (ui.plotTool === 'baseline') {
      if (active.x !== 'time_s') {
        notify('warning', 'To pick a baseline interval, set the X axis to Time (s) first.');
        return;
      }
      const range = (e as unknown as { range?: { x?: [number, number] } }).range?.x;
      if (!range) return;
      const iv: [number, number] = [Math.max(0, +range[0].toFixed(3)), +range[1].toFixed(3)];
      update((pr) => ({ ...pr, settings: { ...pr.settings, baselineMode: 'moveInterval', baselineInterval: iv } }));
      notify('success', `Baseline set to the mean force between ${iv[0]} s and ${iv[1]} s of each movement. Raw values are unchanged.`);
    }
  };

  const onClick = (e: { points: { data: { meta?: unknown } }[] }) => {
    const meta = e.points[0]?.data.meta;
    if (typeof meta === 'string') setUi({ focusId: meta, rightTab: 'cycle' });
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
    const bytes = buildGraphWorkbook(derived, project, active, view === 'processed' || view === 'compare');
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
        <div className="segmented" role="group" aria-label="Data view">
          {(['raw', 'flagged', 'processed', 'compare'] as ViewMode[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} title={VIEW_HELP[v]} onClick={() => update((p) => ({ ...p, view: v }))}>
              {v === 'compare' ? 'Compare' : v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        <label className="check" title="Mark minimum and maximum force">
          <input type="checkbox" checked={active.showMarkers} onChange={(e) => setGraph({ showMarkers: e.target.checked })} /> Min/max
        </label>
        <div className="segmented small" role="group" aria-label="Mouse tool">
          <button className={ui.plotTool === 'zoom' ? 'on' : ''} onClick={() => setUi({ plotTool: 'zoom' })} title="Drag to zoom, scroll to zoom, double-click to reset">
            Zoom
          </button>
          <button className={ui.plotTool === 'excludePoints' ? 'on' : ''} onClick={() => setUi({ plotTool: 'excludePoints' })} title="Drag a box around points to exclude them (reversible)">
            Exclude
          </button>
          <button className={ui.plotTool === 'baseline' ? 'on' : ''} onClick={() => setUi({ plotTool: 'baseline' })} title="With Time on the X axis, drag across the baseline interval">
            Baseline
          </button>
        </div>
        <div className="export-group" role="group" aria-label="Export graph">
          <span>Export</span>
          <button className="small" onClick={() => exportImage('png', 4)} title="High-resolution PNG (4×)">PNG</button>
          <button className="small" onClick={() => exportImage('svg', 1)} title="Vector graphic for papers">SVG</button>
          <button className="small" onClick={exportGraphData} title="Plotted data with an editable Excel chart">XLSX</button>
        </div>
      </div>
      <p className="view-help">
        {VIEW_HELP[view]}
        {view !== 'raw' && s.exclusionRule === 'keepAll' && view !== 'flagged' ? ' Current rule keeps all points; change it under Settings.' : ''}
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
          onSelected={onSelected}
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
              <div key={r.cycle.cycleId} className={`curve ${hidden ? 'off' : ''} ${ui.focusId === r.cycle.cycleId ? 'focus' : ''}`}>
                <input
                  type="checkbox"
                  checked={!hidden}
                  aria-label="Show curve"
                  onChange={() =>
                    setGraph({ hidden: hidden ? active.hidden.filter((x) => x !== r.cycle.cycleId) : [...active.hidden, r.cycle.cycleId] })
                  }
                />
                <span className="swatch" style={{ background: CURVE_COLORS[k % CURVE_COLORS.length] }} />
                <button className="link curve-name" onClick={() => setUi({ focusId: r.cycle.cycleId, rightTab: 'cycle' })}>
                  {curveLabel(r)}
                </button>
                <span className={`qc-dot ${r.qc}`} title={`Run QC: ${r.qc}`} />
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
