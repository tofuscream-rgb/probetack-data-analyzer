import { useMemo, useRef } from 'react';
import type { Data, Layout, PlotlyHTMLElement, Shape } from 'plotly.js';
import { useApp } from '../state/AppContext';
import { useExperiment } from '../state/experiment';
import { buildComparison, type Comparison, type DataSet } from '../analysis/compare';
import type { SummaryStats } from '../analysis/engine';
import { displayFactor, peakLabel } from '../analysis/cycleMetrics';
import { PlotlyChart, loadPlotly } from '../plotting/PlotlyChart';
import { PASTEL_COLORS } from '../plotting/colors';
import { EXPORT_SIZE, FIG_FONT_FAMILY } from '../plotting/figureStyle';
import type { CompareSelection } from '../types';
import { metricsOf } from '../state/tackMetrics';
import { mean, sampleSD } from '../analysis/stats';

type CompareMetric = NonNullable<CompareSelection['metric']>;
import { forceDigits, meanSd } from './common';

type ListKey = 'substrates' | 'gels' | 'chargeRatios' | 'concentrations' | 'holdTimes';

/** Bar-chart axes in the shared figure style (thick black frame, bold ticks). */
export const AXIS = { showline: true, mirror: true, linecolor: '#000', linewidth: 2, ticks: 'outside', ticklen: 7, tickwidth: 2, tickcolor: '#000', zeroline: false, automargin: true, tickfont: { size: 17, color: '#000', weight: 'bold' } } as const;

export function ChipGroup({ title, items, selected, onToggle, onAll, onNone }: {
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
  const diameter = project.settings.probe.diameterMm;
  const h0 = project.tackMetrics.h0;
  const plotEl = useRef<PlotlyHTMLElement | null>(null);

  const cmp: Comparison = useMemo(() => buildComparison(derived.ordered, sel, ex.substrate), [derived, sel, ex.substrate]);
  const set = (patch: Partial<CompareSelection>) => update((p) => ({ ...p, compare: { ...p.compare, ...patch } }));
  const toggle = (k: ListKey, v: string) => {
    const cur = cmp.selected[k];
    set({ [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } as Partial<CompareSelection>);
  };
  const all: Record<ListKey, string[]> = {
    substrates: cmp.substrates.map((s) => s.value),
    gels: cmp.gels.map((g) => g.value),
    chargeRatios: cmp.chargeRatios,
    concentrations: cmp.concentrations,
    holdTimes: cmp.holdTimes,
  };

  const visible = cmp.sets.filter((s) => !s.hidden);
  const holds = cmp.selected.holdTimes;
  // The compared quantity: peak adhesion force (as in Data analysis) or the tensile work W_adh of each run.
  const metric: CompareMetric = sel.metric === 'wJm2' && !(diameter > 0) ? 'peak' : sel.metric ?? 'peak';
  const workOf = (id: string): number => {
    const r = derived.results.get(id);
    if (!r) return NaN;
    const m = metricsOf(r.cycle, diameter, h0[r.file.fileId] ?? null, true);
    return metric === 'workMJ' ? m.workMJ : m.wJm2;
  };
  /** Mean ± sample SD (n) of one data set and dwell time, in display units. */
  const st = (s: DataSet, h: string): { mean: number; sd: number; n: number } | null => {
    const g = cmp.stats(s, h);
    if (!g) return null;
    if (metric === 'peak') {
      const v: SummaryStats = g[sel.which];
      return { mean: v.mean * f, sd: v.sd * fa, n: v.n };
    }
    // Work: all valid runs, or the runs included after review.
    const values = (sel.which === 'raw' ? g.cycleIds : g.includedCycleIds).map(workOf).filter(Number.isFinite);
    return { mean: mean(values), sd: sampleSD(values), n: values.length };
  };
  const manyConc = new Set(visible.map((s) => s.concentration)).size > 1;
  const conc = (s: DataSet) => `${s.concentration} M${s.concentrationDefault ? '*' : ''}`;
  const manyGels = new Set(visible.map((s) => s.gel)).size > 1;
  /** A gel is named in the folders (otherwise the Gel filter and column are left out). */
  const hasGels = cmp.gels.some((g) => g.value !== '—');
  const byCr = sel.panelBy === 'chargeRatio' && manyGels;
  const tickMain = (s: DataSet) => (byCr ? s.gelLabel : s.chargeRatio);
  const tick = (s: DataSet) => (manyConc ? `${tickMain(s)}<br>${conc(s)}` : tickMain(s));
  const panelOf = (s: DataSet) => (byCr ? `${s.substrateLabel} · CR ${s.chargeRatio}` : manyGels ? `${s.substrateLabel} · ${s.gelLabel}` : s.substrateLabel);
  const setName = (s: DataSet) => [s.substrateLabel, manyGels || s.gel !== '—' ? s.gelLabel : null, `CR ${s.chargeRatio}`, conc(s)].filter(Boolean).join(' · ');
  const metricLabel = metric === 'peak' ? peakLabel(project.settings) : metric === 'workMJ' ? 'W_adh' : 'W_adh / A';
  const yTitle = metric === 'peak' ? `${peakLabel(project.settings)} (${u})` : metric === 'workMJ' ? 'W<sub>adh</sub> (mJ)' : 'W<sub>adh</sub> (J/m²)';
  const unitText = metric === 'peak' ? u : metric === 'workMJ' ? 'mJ' : 'J/m²';
  const digits = metric === 'peak' ? d : 3;
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
        y: vals.map((v) => (v && v.n > 0 ? v.mean : null)),
        error_y: { type: 'data', array: vals.map((v) => (v && v.n > 1 ? v.sd : 0)), visible: true, color: '#18263A', thickness: 1.2, width: 4 },
        customdata: visible.map((s, i) => [setName(s), vals[i]?.n ?? 0]),
        marker: { color: PASTEL_COLORS[k % PASTEL_COLORS.length], line: { color: '#18263A', width: 1 } },
        hovertemplate: `%{customdata[0]}<br>${h} s dwell: %{y:.3f} ± %{error_y.array:.3f} ${unitText} (SD), n = %{customdata[1]}<extra></extra>`,
      } as unknown as Data;
    });
    // Headroom above the highest bar (mean + SD) for the substrate labels and the legend.
    let top = 0;
    let bottom = 0;
    for (const h of holds) for (const s of visible) {
      const v = st(s, h);
      if (!v || v.n === 0) continue;
      top = Math.max(top, v.mean + (v.n > 1 ? v.sd : 0));
      bottom = Math.min(bottom, v.mean - (v.n > 1 ? v.sd : 0));
    }
    const range = bottom >= 0 && top > 0 ? [0, top * 1.22] : undefined;
    // Dashed separators and labels for each substrate panel.
    const panels: { label: string; from: number; to: number }[] = [];
    visible.forEach((s, i) => {
      const last = panels[panels.length - 1];
      if (last && last.label === panelOf(s)) last.to = i;
      else panels.push({ label: panelOf(s), from: i, to: i });
    });
    const shapes: Partial<Shape>[] = panels.slice(1).map((p) => ({
      type: 'line', xref: 'x', yref: 'paper', x0: p.from - 0.5, x1: p.from - 0.5, y0: 0, y1: 1, line: { color: '#4A5A70', width: 1.2, dash: 'dash' },
    }));
    const layout: Partial<Layout> = {
      margin: { l: 90, r: 16, t: 16, b: manyConc ? 96 : 78 },
      font: { family: FIG_FONT_FAMILY, size: 15, color: '#000' },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      barmode: 'group',
      bargap: 0.22,
      bargroupgap: 0.04,
      xaxis: { ...AXIS, type: 'category', tickvals: x, ticktext: visible.map(tick), title: { text: byCr ? '<b>Gel</b>' : '<b>Gel charge ratio</b>', font: { size: 20 } } },
      yaxis: { ...AXIS, rangemode: 'tozero', ...(range ? { range } : {}), gridcolor: 'rgba(0,0,0,0)', title: { text: `<b>${yTitle}</b>`, font: { size: 20 } } },
      legend: { x: 0.995, y: 0.99, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.9)', bordercolor: '#000', borderwidth: 1.5, font: { size: 16 } },
      shapes,
      annotations: panels.map((p) => ({ x: (p.from + p.to) / 2, xref: 'x', y: 0.95, yref: 'paper', text: `<b>${p.label}</b>`, showarrow: false, font: { size: 18, color: '#6B7684' } })),
      hovermode: 'closest',
    };
    return { data, layout };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmp, sel.which, f, yTitle, manyConc, byCr, manyGels, metric, diameter, h0]);

  // Line chart: one line per data set across holding times.
  const lines = useMemo(() => {
    const data: Data[] = visible.map((s, k) => {
      const color = PASTEL_COLORS[k % PASTEL_COLORS.length];
      const pts = holds.map((h) => ({ h, v: st(s, h) })).filter((p) => p.v && p.v.n > 0 && Number.isFinite(Number(p.h)));
      const name = setName(s);
      return {
        type: 'scatter',
        mode: 'lines+markers',
        name,
        x: pts.map((p) => Number(p.h)),
        y: pts.map((p) => p.v!.mean),
        error_y: { type: 'data', array: pts.map((p) => (p.v!.n > 1 ? p.v!.sd : 0)), visible: true, color: '#18263A', thickness: 1, width: 3 },
        text: pts.map((p) => `n = ${p.v!.n}`),
        line: { color, width: 2.4 },
        marker: { color, size: 9, line: { color: '#18263A', width: 1 } },
        hovertemplate: `${name}<br>%{x} s dwell<br>%{y:.3f} ± %{error_y.array:.3f} ${unitText} (SD)<br>%{text}<extra></extra>`,
      } as unknown as Data;
    });
    const layout: Partial<Layout> = {
      margin: { l: 90, r: 16, t: 16, b: 78 },
      font: { family: FIG_FONT_FAMILY, size: 15, color: '#000' },
      xaxis: { ...AXIS, title: { text: '<b>Dwell time (s)</b>', font: { size: 20 } } },
      yaxis: { ...AXIS, rangemode: 'tozero', title: { text: `<b>${yTitle}</b>`, font: { size: 20 } } },
      legend: { orientation: 'h', y: -0.28, font: { size: 15 } },
      hovermode: 'closest',
    };
    return { data, layout };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmp, sel.which, f, yTitle, metric, diameter, h0]);

  const save = async (format: 'png' | 'svg') => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.downloadImage(plotEl.current, { format, filename: 'tack_comparison', ...EXPORT_SIZE, scale: format === 'png' ? 4 : 1 } as never);
  };

  if (!derived.ordered.length) return <p className="note">Open your experiment folder in step 1 on the left to compare charge ratios.</p>;

  return (
    <div className="compare-tab">
      <div className="compare-picker">
        <ChipGroup title="Substrate" items={cmp.substrates} selected={cmp.selected.substrates} onToggle={(v) => toggle('substrates', v)} onAll={() => set({ substrates: all.substrates })} onNone={() => set({ substrates: [] })} />
        {hasGels && <ChipGroup title="Gel" items={cmp.gels} selected={cmp.selected.gels} onToggle={(v) => toggle('gels', v)} onAll={() => set({ gels: null })} onNone={() => set({ gels: [] })} />}
        <ChipGroup title="Charge ratio" items={cmp.chargeRatios.map((v) => ({ value: v, label: v }))} selected={cmp.selected.chargeRatios} onToggle={(v) => toggle('chargeRatios', v)} onAll={() => set({ chargeRatios: null })} onNone={() => set({ chargeRatios: [] })} />
        <ChipGroup title="Concentration" items={cmp.concentrations.map((v) => ({ value: v, label: v === '—' ? 'unknown' : `${v} M` }))} selected={cmp.selected.concentrations} onToggle={(v) => toggle('concentrations', v)} onAll={() => set({ concentrations: null })} onNone={() => set({ concentrations: [] })} />
        <ChipGroup title="Dwell time" items={cmp.holdTimes.map((v) => ({ value: v, label: v === '—' ? 'unknown' : `${v} s` }))} selected={cmp.selected.holdTimes} onToggle={(v) => toggle('holdTimes', v)} onAll={() => set({ holdTimes: null })} onNone={() => set({ holdTimes: [] })} />
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
              {setName(s)}
            </label>
          ))}
        </div>
      </details>

      <div className="table-actions compare-controls">
        <label className="field inline">
          <span>Compare</span>
          <select value={metric} onChange={(e) => set({ metric: e.target.value as CompareMetric })} aria-label="Quantity to compare">
            <option value="peak">{peakLabel(project.settings)} ({u})</option>
            <option value="wJm2" disabled={!(diameter > 0)}>W_adh per probe area (J/m²){diameter > 0 ? '' : ' — enter the probe diameter in Settings'}</option>
            <option value="workMJ">W_adh (mJ)</option>
          </select>
        </label>
        <div className="segmented small" role="group" aria-label="Which runs">
          <button className={sel.which === 'processed' ? 'on' : ''} onClick={() => set({ which: 'processed' })}>Included runs after review</button>
          <button className={sel.which === 'raw' ? 'on' : ''} onClick={() => set({ which: 'raw' })}>All valid runs</button>
        </div>
        {cmp.gels.length > 1 && (
          <div className="segmented small" role="group" aria-label="Bar groups">
            <button className={!byCr ? 'on' : ''} onClick={() => set({ panelBy: 'gel' })}>Charge ratios within each gel</button>
            <button className={byCr ? 'on' : ''} onClick={() => set({ panelBy: 'chargeRatio' })}>Gels side by side</button>
          </div>
        )}
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
        Each data set is one substrate, gel, charge ratio and concentration; bars show mean ± sample SD of the {metric === 'peak' ? peakLabel(project.settings).toLowerCase() : metric === 'workMJ' ? 'tensile work Wadh (mJ)' : 'tensile work per probe area Wadh/A (J/m²)'}, one value per run, for each dwell time.{metric !== 'peak' ? ' Wadh is integrated from the tensile onset to detachment, or to the end of the recording when no detachment was detected (Methods in Data analysis). ' : ' '}
        Concentrations and gels are never averaged together. A missing bar or “—” means no runs for that combination. Runs on the same specimen are not independent replicates.
        {anyDefault ? ' * No concentration in the folder name, so 2.1 M is assumed.' : ''}
      </p>

      {visible.length === 0 || holds.length === 0 ? (
        <p className="note">Nothing to compare: {cmp.sets.length === 0 ? 'no runs match the ticked substrate, gel, charge ratio and concentration' : visible.length === 0 ? 'every data set is unticked in the list above' : 'no dwell time is ticked'}. Tick at least one value in each group.</p>
      ) : (
        <>
          <PlotlyChart data={bars.data} layout={bars.layout} className="plot compare-bars" onReady={(el) => (plotEl.current = el)} config={{ toImageButtonOptions: { format: 'png', filename: 'tack_comparison', scale: 4 } }} />
          <div className="table-scroll">
            <table className="grid compare-table">
              <thead>
                <tr>
                  <th>Substrate</th>{hasGels && <th>Gel</th>}<th>Charge ratio</th><th>Concentration</th>
                  {holds.map((h) => <th key={h} className="num">{h === '—' ? 'Dwell unknown' : `${h} s dwell`} ({unitText})</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.key}>
                    <td>{s.substrateLabel}</td>
                    {hasGels && <td>{s.gelLabel}</td>}
                    <td className="strong">{s.chargeRatio}</td>
                    <td>{conc(s)}</td>
                    {holds.map((h) => {
                      const v = st(s, h);
                      return <td key={h} className="num">{v && v.n > 0 ? meanSd(v.mean, v.sd, v.n, digits) : '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section>
            <h3>{metric === 'peak' ? 'Peak force' : metricLabel} vs dwell time</h3>
            <PlotlyChart data={lines.data} layout={lines.layout} className="plot summary" />
          </section>
        </>
      )}
    </div>
  );
}
