import { useMemo, useRef } from 'react';
import type { Data, Layout, PlotlyHTMLElement, Shape } from 'plotly.js';
import { useApp } from '../state/AppContext';
import { useExperiment } from '../state/experiment';
import { buildComparison, type Comparison, type DataSet } from '../analysis/compare';
import type { SummaryStats } from '../analysis/engine';
import { displayFactor, peakLabel } from '../analysis/cycleMetrics';
import { PlotlyChart, loadPlotly } from '../plotting/PlotlyChart';
import { PASTEL_COLORS } from '../plotting/colors';
import type { CompareSelection } from '../types';
import { forceDigits, meanSd } from './common';

type ListKey = 'substrates' | 'chargeRatios' | 'concentrations' | 'holdTimes';

const AXIS = { showline: true, mirror: true, linecolor: '#18263A', linewidth: 1.2, ticks: 'outside', tickcolor: '#18263A', zeroline: false } as const;

function ChipGroup({ title, items, selected, onToggle, onAll, onNone }: {
  title: string;
  items: { value: string; label: string }[];
  selected: string[];
  onToggle: (v: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <div className="pick-group">
      <div className="pick-head">
        <strong>{title}</strong>
        <button className="link small" onClick={onAll}>All</button>
        <button className="link small" onClick={onNone}>None</button>
      </div>
      <div className="chips">
        {items.map((it) => (
          <label key={it.value} className={`chip check-chip ${selected.includes(it.value) ? 'on' : ''}`}>
            <input type="checkbox" checked={selected.includes(it.value)} onChange={() => onToggle(it.value)} />
            {it.label}
          </label>
        ))}
        {items.length === 0 && <small>none available</small>}
      </div>
    </div>
  );
}

export function CompareChargeRatios() {
  const { derived, project, update } = useApp();
  const ex = useExperiment();
  const sel = project.compare;
  const u = project.settings.forceUnit;
  const f = displayFactor(project.settings);
  const fa = Math.abs(f); // SD is never negative
  const d = forceDigits(u);
  const plotEl = useRef<PlotlyHTMLElement | null>(null);

  const cmp: Comparison = useMemo(() => buildComparison(derived.ordered, sel, ex.substrate), [derived, sel, ex.substrate]);
  const set = (patch: Partial<CompareSelection>) => update((p) => ({ ...p, compare: { ...p.compare, ...patch } }));
  const toggle = (k: ListKey, v: string) => {
    const cur = cmp.selected[k];
    set({ [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } as Partial<CompareSelection>);
  };
  const all: Record<ListKey, string[]> = {
    substrates: cmp.substrates.map((s) => s.value),
    chargeRatios: cmp.chargeRatios,
    concentrations: cmp.concentrations,
    holdTimes: cmp.holdTimes,
  };

  const visible = cmp.sets.filter((s) => !s.hidden);
  const holds = cmp.selected.holdTimes;
  const st = (s: DataSet, h: string): SummaryStats | null => cmp.stats(s, h)?.[sel.which] ?? null;
  const manyConc = new Set(visible.map((s) => s.concentration)).size > 1;
  const conc = (s: DataSet) => `${s.concentration} M${s.concentrationDefault ? '*' : ''}`;
  const tick = (s: DataSet) => (manyConc ? `${s.chargeRatio}<br>${conc(s)}` : s.chargeRatio);
  const yTitle = `${peakLabel(project.settings)} (${u})`;
  const anyDefault = visible.some((s) => s.concentrationDefault);

  // Bar chart in the style of published tack plots: substrate panels, one bar per holding time.
  const bars = useMemo(() => {
    const x = visible.map((s) => s.key);
    const data: Data[] = holds.map((h, k) => {
      const vals = visible.map((s) => st(s, h));
      return {
        type: 'bar',
        name: `${h} s`,
        x,
        y: vals.map((v) => (v && v.n > 0 ? v.mean * f : null)),
        error_y: { type: 'data', array: vals.map((v) => (v && v.n > 1 ? v.sd * fa : 0)), visible: true, color: '#18263A', thickness: 1.2, width: 4 },
        customdata: visible.map((s, i) => [s.substrateLabel, s.chargeRatio, conc(s), vals[i]?.n ?? 0]),
        marker: { color: PASTEL_COLORS[k % PASTEL_COLORS.length], line: { color: '#18263A', width: 1 } },
        hovertemplate: `%{customdata[0]}, charge ratio %{customdata[1]}, %{customdata[2]}<br>${h} s hold: %{y:.3f} ± %{error_y.array:.3f} (SD), n = %{customdata[3]}<extra></extra>`,
      } as unknown as Data;
    });
    // Headroom above the highest bar (mean + SD) for the substrate labels and the legend.
    let top = 0;
    let bottom = 0;
    for (const h of holds) for (const s of visible) {
      const v = st(s, h);
      if (!v || v.n === 0) continue;
      top = Math.max(top, v.mean * f + (v.n > 1 ? v.sd * fa : 0));
      bottom = Math.min(bottom, v.mean * f - (v.n > 1 ? v.sd * fa : 0));
    }
    const range = bottom >= 0 && top > 0 ? [0, top * 1.22] : undefined;
    // Dashed separators and labels for each substrate panel.
    const panels: { label: string; from: number; to: number }[] = [];
    visible.forEach((s, i) => {
      const last = panels[panels.length - 1];
      if (last && last.label === s.substrateLabel) last.to = i;
      else panels.push({ label: s.substrateLabel, from: i, to: i });
    });
    const shapes: Partial<Shape>[] = panels.slice(1).map((p) => ({
      type: 'line', xref: 'x', yref: 'paper', x0: p.from - 0.5, x1: p.from - 0.5, y0: 0, y1: 1, line: { color: '#4A5A70', width: 1.2, dash: 'dash' },
    }));
    const layout: Partial<Layout> = {
      margin: { l: 70, r: 14, t: 14, b: manyConc ? 78 : 62 },
      font: { family: 'IBM Plex Sans, Arial, sans-serif', size: 13, color: '#18263A' },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      barmode: 'group',
      bargap: 0.22,
      bargroupgap: 0.04,
      xaxis: { ...AXIS, type: 'category', tickvals: x, ticktext: visible.map(tick), tickfont: { size: 13 }, title: { text: 'Gel charge ratio', font: { size: 16 } } },
      yaxis: { ...AXIS, rangemode: 'tozero', ...(range ? { range } : {}), gridcolor: 'rgba(0,0,0,0)', title: { text: yTitle, font: { size: 16 } } },
      legend: { x: 0.995, y: 0.99, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.9)', bordercolor: '#18263A', borderwidth: 1 },
      shapes,
      annotations: panels.map((p) => ({ x: (p.from + p.to) / 2, xref: 'x', y: 0.95, yref: 'paper', text: `<b>${p.label}</b>`, showarrow: false, font: { size: 15, color: '#7B8899' } })),
      hovermode: 'closest',
    };
    return { data, layout };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmp, sel.which, f, yTitle, manyConc]);

  // Line chart: one line per data set across holding times.
  const lines = useMemo(() => {
    const data: Data[] = visible.map((s, k) => {
      const color = PASTEL_COLORS[k % PASTEL_COLORS.length];
      const pts = holds.map((h) => ({ h, v: st(s, h) })).filter((p) => p.v && p.v.n > 0 && Number.isFinite(Number(p.h)));
      const name = `${s.substrateLabel} · ${s.chargeRatio} · ${conc(s)}`;
      return {
        type: 'scatter',
        mode: 'lines+markers',
        name,
        x: pts.map((p) => Number(p.h)),
        y: pts.map((p) => p.v!.mean * f),
        error_y: { type: 'data', array: pts.map((p) => (p.v!.n > 1 ? p.v!.sd * fa : 0)), visible: true, color: '#18263A', thickness: 1, width: 3 },
        text: pts.map((p) => `n = ${p.v!.n}`),
        line: { color, width: 2.4 },
        marker: { color, size: 9, line: { color: '#18263A', width: 1 } },
        hovertemplate: `${name}<br>%{x} s hold<br>%{y:.3f} ± %{error_y.array:.3f} (SD)<br>%{text}<extra></extra>`,
      } as unknown as Data;
    });
    const layout: Partial<Layout> = {
      margin: { l: 70, r: 14, t: 14, b: 56 },
      font: { family: 'IBM Plex Sans, Arial, sans-serif', size: 12, color: '#18263A' },
      xaxis: { ...AXIS, title: { text: 'Holding time (s)' } },
      yaxis: { ...AXIS, rangemode: 'tozero', title: { text: yTitle } },
      legend: { orientation: 'h', y: -0.22 },
      hovermode: 'closest',
    };
    return { data, layout };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmp, sel.which, f, yTitle]);

  const save = async (format: 'png' | 'svg') => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.downloadImage(plotEl.current, { format, filename: 'tack_comparison', width: 1200, height: 760, scale: format === 'png' ? 4 : 1 } as never);
  };

  if (!derived.ordered.length) return <p className="note">Open your experiment folder in step 1 on the left to compare charge ratios.</p>;

  return (
    <div className="compare-tab">
      <div className="compare-picker">
        <ChipGroup title="Substrate" items={cmp.substrates} selected={cmp.selected.substrates} onToggle={(v) => toggle('substrates', v)} onAll={() => set({ substrates: all.substrates })} onNone={() => set({ substrates: [] })} />
        <ChipGroup title="Charge ratio" items={cmp.chargeRatios.map((v) => ({ value: v, label: v }))} selected={cmp.selected.chargeRatios} onToggle={(v) => toggle('chargeRatios', v)} onAll={() => set({ chargeRatios: null })} onNone={() => set({ chargeRatios: [] })} />
        <ChipGroup title="Concentration" items={cmp.concentrations.map((v) => ({ value: v, label: `${v} M` }))} selected={cmp.selected.concentrations} onToggle={(v) => toggle('concentrations', v)} onAll={() => set({ concentrations: null })} onNone={() => set({ concentrations: [] })} />
        <ChipGroup title="Holding time" items={cmp.holdTimes.map((v) => ({ value: v, label: `${v} s` }))} selected={cmp.selected.holdTimes} onToggle={(v) => toggle('holdTimes', v)} onAll={() => set({ holdTimes: null })} onNone={() => set({ holdTimes: [] })} />
      </div>

      <details className="section sets-list" open={cmp.sets.length <= 16}>
        <summary>
          {visible.length} of {cmp.sets.length} data set(s) compared <small>(untick one to leave it out)</small>
        </summary>
        <div className="chips">
          {cmp.sets.map((s) => (
            <label key={s.key} className={`chip check-chip ${s.hidden ? '' : 'on'}`}>
              <input
                type="checkbox"
                checked={!s.hidden}
                onChange={() => set({ hiddenSets: s.hidden ? sel.hiddenSets.filter((k) => k !== s.key) : [...sel.hiddenSets, s.key] })}
              />
              {s.substrateLabel} · {s.chargeRatio} · {conc(s)}
            </label>
          ))}
        </div>
      </details>

      <div className="table-actions compare-controls">
        <div className="segmented small" role="group" aria-label="Which runs">
          <button className={sel.which === 'processed' ? 'on' : ''} onClick={() => set({ which: 'processed' })}>Without outliers</button>
          <button className={sel.which === 'raw' ? 'on' : ''} onClick={() => set({ which: 'raw' })}>All runs</button>
        </div>
        <div className="segmented small" role="group" aria-label="Order of charge ratios">
          <button className={sel.order === 'desc' ? 'on' : ''} onClick={() => set({ order: 'desc' })}>Charge ratio high → low</button>
          <button className={sel.order === 'asc' ? 'on' : ''} onClick={() => set({ order: 'asc' })}>low → high</button>
        </div>
        <div className="export-group">
          <span>Save chart</span>
          <button className="small" onClick={() => save('png')}>PNG</button>
          <button className="small" onClick={() => save('svg')}>SVG</button>
        </div>
      </div>
      <p className="note">
        Each data set is one substrate, charge ratio and concentration; bars show mean ± SD of the {peakLabel(project.settings).toLowerCase()}, one value per run.
        Concentrations are never averaged together. Runs on the same specimen are not independent replicates.
        {anyDefault ? ' * No concentration in the folder name, so 2.1 M is assumed.' : ''}
      </p>

      {visible.length === 0 || holds.length === 0 ? (
        <p className="note">Tick at least one substrate, charge ratio, concentration and holding time with data.</p>
      ) : (
        <>
          <PlotlyChart data={bars.data} layout={bars.layout} className="plot compare-bars" onReady={(el) => (plotEl.current = el)} config={{ toImageButtonOptions: { format: 'png', filename: 'tack_comparison', scale: 4 } }} />
          <div className="table-scroll">
            <table className="grid compare-table">
              <thead>
                <tr>
                  <th>Substrate</th><th>Charge ratio</th><th>Concentration</th>
                  {holds.map((h) => <th key={h} className="num">{h} s hold</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.key}>
                    <td>{s.substrateLabel}</td>
                    <td className="strong">{s.chargeRatio}</td>
                    <td>{conc(s)}</td>
                    {holds.map((h) => {
                      const v = st(s, h);
                      return <td key={h} className="num">{v && v.n > 0 ? meanSd(v.mean * f, v.sd * fa, v.n, d) : '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section>
            <h3>Peak force vs holding time</h3>
            <PlotlyChart data={lines.data} layout={lines.layout} className="plot summary" />
          </section>
        </>
      )}
    </div>
  );
}
