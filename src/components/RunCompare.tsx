import { useMemo, useRef } from 'react';
import type { Data, Layout, PlotlyHTMLElement, Shape } from 'plotly.js';
import { buildRunComparison, type CompareItem, type RunDataSet } from '../analysis/runCompare';
import { PlotlyChart, loadPlotly } from '../plotting/PlotlyChart';
import { PASTEL_COLORS } from '../plotting/colors';
import { EXPORT_SIZE, FIG_FONT_FAMILY } from '../plotting/figureStyle';
import type { RunCompareSelection } from '../types';
import { AXIS, ChipGroup } from './CompareChargeRatios';
import { fmt } from './common';

export interface CompareMetric {
  key: string;
  label: string;
  unit: string;
  digits: number;
}

type ListKey = 'substrates' | 'gels' | 'chargeRatios' | 'concentrations' | 'holdTimes';

/** Compare charge ratios tab of Lap Shear and 90° Peel. */
export function RunCompare({ items, metrics, sel, setSel, fileName, note }: {
  items: CompareItem[];
  metrics: CompareMetric[];
  sel: RunCompareSelection;
  setSel: (patch: Partial<RunCompareSelection>) => void;
  fileName: string;
  note: string;
}) {
  const plotEl = useRef<PlotlyHTMLElement | null>(null);
  const cmp = useMemo(() => buildRunComparison(items, sel), [items, sel]);
  const metric = metrics.find((m) => m.key === sel.metric) ?? metrics[0];
  const toggle = (k: ListKey, v: string) => {
    const cur = cmp.selected[k];
    setSel({ [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] } as Partial<RunCompareSelection>);
  };
  const visible = cmp.sets.filter((s) => !s.hidden);
  const holds = cmp.selected.holdTimes;
  const noHold = holds.length === 1 && holds[0] === '—';
  const holdName = (h: string) => (h === '—' ? (noHold ? 'All runs' : 'dwell unknown') : `${h} s`);
  const manyConc = new Set(visible.map((s) => s.concentration)).size > 1;
  const conc = (s: RunDataSet) => `${s.concentration} M${s.concentrationDefault ? '*' : ''}`;
  const manyGels = new Set(visible.map((s) => s.gel)).size > 1;
  /** A gel is named in the folders (otherwise the Gel filter and column are left out). */
  const hasGels = cmp.gels.some((g) => g.value !== '—');
  const byCr = sel.panelBy === 'chargeRatio' && manyGels;
  const tickMain = (s: RunDataSet) => (byCr ? s.gelLabel : s.chargeRatio);
  const tick = (s: RunDataSet) => (manyConc ? `${tickMain(s)}<br>${conc(s)}` : tickMain(s));
  const panelOf = (s: RunDataSet) => (byCr ? `${s.substrateLabel} · CR ${s.chargeRatio}` : manyGels ? `${s.substrateLabel} · ${s.gelLabel}` : s.substrateLabel);
  const setName = (s: RunDataSet) => [s.substrateLabel, manyGels || s.gel !== '—' ? s.gelLabel : null, `CR ${s.chargeRatio}`, conc(s)].filter(Boolean).join(' · ');
  const yTitle = `${metric.label} (${metric.unit})`;

  const bars = useMemo(() => {
    const x = visible.map((s) => s.key);
    let top = 0;
    let bottom = 0;
    const data: Data[] = holds.map((h, k) => {
      const vals = visible.map((s) => cmp.stat(s, h, metric.key));
      for (const v of vals) if (v.n) { top = Math.max(top, v.mean + (v.n > 1 ? v.sd : 0)); bottom = Math.min(bottom, v.mean - (v.n > 1 ? v.sd : 0)); }
      return {
        type: 'bar',
        name: holdName(h),
        x,
        y: vals.map((v) => (v.n ? v.mean : null)),
        error_y: { type: 'data', array: vals.map((v) => (v.n > 1 ? v.sd : null)), visible: true, color: '#18263A', thickness: 1.2, width: 4 }, // no bar when n = 1
        customdata: visible.map((s, i) => [setName(s), vals[i].n]),
        marker: { color: PASTEL_COLORS[k % PASTEL_COLORS.length], line: { color: '#18263A', width: 1 } },
        hovertemplate: `%{customdata[0]}<br>${holdName(h)}: %{y:.${metric.digits}f} ± %{error_y.array:.${metric.digits}f} ${metric.unit} (SD), n = %{customdata[1]}<extra></extra>`,
      } as unknown as Data;
    });
    const panels: { label: string; from: number; to: number }[] = [];
    visible.forEach((s, i) => {
      const last = panels[panels.length - 1];
      if (last && last.label === panelOf(s)) last.to = i;
      else panels.push({ label: panelOf(s), from: i, to: i });
    });
    const shapes: Partial<Shape>[] = panels.slice(1).map((p) => ({ type: 'line', xref: 'x', yref: 'paper', x0: p.from - 0.5, x1: p.from - 0.5, y0: 0, y1: 1, line: { color: '#4A5A70', width: 1.2, dash: 'dash' } }));
    const layout: Partial<Layout> = {
      margin: { l: 90, r: 16, t: 16, b: manyConc ? 96 : 78 },
      font: { family: FIG_FONT_FAMILY, size: 15, color: '#000' },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      barmode: 'group',
      bargap: 0.22,
      bargroupgap: 0.04,
      showlegend: !noHold,
      xaxis: { ...AXIS, type: 'category', tickvals: x, ticktext: visible.map(tick), title: { text: byCr ? '<b>Gel</b>' : '<b>Gel charge ratio</b>', font: { size: 20 } } },
      yaxis: { ...AXIS, rangemode: 'tozero', ...(bottom >= 0 && top > 0 ? { range: [0, top * 1.22] } : {}), title: { text: `<b>${yTitle}</b>`, font: { size: 20 } } },
      legend: { x: 0.995, y: 0.99, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.9)', bordercolor: '#000', borderwidth: 1.5, font: { size: 16 } },
      shapes,
      annotations: panels.map((p) => ({ x: (p.from + p.to) / 2, xref: 'x', y: 0.95, yref: 'paper', text: `<b>${p.label}</b>`, showarrow: false, font: { size: 18, color: '#6B7684' } })),
      hovermode: 'closest',
    };
    return { data, layout };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmp, metric.key, manyConc, noHold, byCr, manyGels]);

  // Line chart, as in Probe Tack: one line per data set across dwell times (when they vary).
  const numericHolds = holds.filter((h) => Number.isFinite(Number(h)));
  const lines = useMemo(() => {
    const data: Data[] = visible.map((s, k) => {
      const color = PASTEL_COLORS[k % PASTEL_COLORS.length];
      const pts = numericHolds.map((h) => ({ h, v: cmp.stat(s, h, metric.key) })).filter((p) => p.v.n > 0);
      const name = setName(s);
      return {
        type: 'scatter', mode: 'lines+markers', name,
        x: pts.map((p) => Number(p.h)), y: pts.map((p) => p.v.mean),
        error_y: { type: 'data', array: pts.map((p) => (p.v.n > 1 ? p.v.sd : 0)), visible: true, color: '#18263A', thickness: 1, width: 3 },
        text: pts.map((p) => `n = ${p.v.n}`),
        line: { color, width: 2.4 }, marker: { color, size: 9, line: { color: '#18263A', width: 1 } },
        hovertemplate: `${name}<br>%{x} s dwell<br>%{y:.${metric.digits}f} ± %{error_y.array:.${metric.digits}f} ${metric.unit} (SD)<br>%{text}<extra></extra>`,
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
  }, [cmp, metric.key, numericHolds.join('|')]);

  const save = async (format: 'png' | 'svg') => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.downloadImage(plotEl.current, { format, filename: fileName, ...EXPORT_SIZE, scale: format === 'png' ? 4 : 1 } as never);
  };

  if (!items.length) return <p className="note pad">No runs to compare yet. Open files in step 1 on the left; their folder names give the substrate, gel, charge ratio and concentration.</p>;

  return (
    <div className="compare-tab">
      <div className="compare-picker">
        <ChipGroup title="Substrate" items={cmp.substrates} selected={cmp.selected.substrates} onToggle={(v) => toggle('substrates', v)} onAll={() => setSel({ substrates: null })} onNone={() => setSel({ substrates: [] })} />
        {hasGels && <ChipGroup title="Gel" items={cmp.gels} selected={cmp.selected.gels} onToggle={(v) => toggle('gels', v)} onAll={() => setSel({ gels: null })} onNone={() => setSel({ gels: [] })} />}
        <ChipGroup title="Charge ratio" items={cmp.chargeRatios.map((v) => ({ value: v, label: v === '—' ? 'unknown' : v }))} selected={cmp.selected.chargeRatios} onToggle={(v) => toggle('chargeRatios', v)} onAll={() => setSel({ chargeRatios: null })} onNone={() => setSel({ chargeRatios: [] })} />
        <ChipGroup title="Concentration" items={cmp.concentrations.map((v) => ({ value: v, label: v === '—' ? 'unknown' : `${v} M` }))} selected={cmp.selected.concentrations} onToggle={(v) => toggle('concentrations', v)} onAll={() => setSel({ concentrations: null })} onNone={() => setSel({ concentrations: [] })} />
        {!noHold && <ChipGroup title="Dwell time" items={cmp.holdTimes.map((v) => ({ value: v, label: holdName(v) }))} selected={cmp.selected.holdTimes} onToggle={(v) => toggle('holdTimes', v)} onAll={() => setSel({ holdTimes: null })} onNone={() => setSel({ holdTimes: [] })} />}
      </div>

      <details className="section sets-list" open={cmp.sets.length <= 16}>
        <summary>{visible.length} of {cmp.sets.length} data set(s) compared <small>(untick one to leave it out)</small></summary>
        <div className="chips">
          {cmp.sets.map((s) => (
            <label key={s.key} className={`chip check-chip ${s.hidden ? '' : 'on'}`}>
              <input type="checkbox" checked={!s.hidden} onChange={() => setSel({ hiddenSets: s.hidden ? sel.hiddenSets.filter((k) => k !== s.key) : [...sel.hiddenSets, s.key] })} />
              {setName(s)}
            </label>
          ))}
        </div>
      </details>

      <div className="table-actions compare-controls">
        <div className="segmented small" role="group" aria-label="Which runs">
          <button className={sel.which !== 'raw' ? 'on' : ''} onClick={() => setSel({ which: 'processed' })}>Included runs after review</button>
          <button className={sel.which === 'raw' ? 'on' : ''} onClick={() => setSel({ which: 'raw' })}>All valid runs</button>
        </div>
        <label className="field inline">
          <span>Compare</span>
          <select value={metric.key} onChange={(e) => setSel({ metric: e.target.value })}>
            {metrics.map((m) => <option key={m.key} value={m.key}>{m.label} ({m.unit})</option>)}
          </select>
        </label>
        {cmp.gels.length > 1 && (
          <div className="segmented small" role="group" aria-label="Bar groups">
            <button className={!byCr ? 'on' : ''} onClick={() => setSel({ panelBy: 'gel' })}>Charge ratios within each gel</button>
            <button className={byCr ? 'on' : ''} onClick={() => setSel({ panelBy: 'chargeRatio' })}>Gels side by side</button>
          </div>
        )}
        <div className="segmented small" role="group" aria-label="Order of charge ratios">
          <button className={sel.order === 'desc' ? 'on' : ''} onClick={() => setSel({ order: 'desc' })}>Charge ratio high → low</button>
          <button className={sel.order === 'asc' ? 'on' : ''} onClick={() => setSel({ order: 'asc' })}>low → high</button>
        </div>
        <div className="export-group">
          <span>Save chart</span>
          <button className="small" onClick={() => save('png')}>PNG</button>
          <button className="small" onClick={() => save('svg')}>SVG</button>
        </div>
      </div>
      <p className="note">
        {note} Each data set is one substrate, gel, charge ratio and concentration from the folder names; bars show mean ± sample SD over its runs
        {noHold ? '' : ', one bar per dwell time'}. Concentrations and gels are never averaged together; a missing bar or “—” means no runs for that combination.
        {visible.some((s) => s.concentrationDefault) ? ' * No concentration in the folder name, so 2.1 M is assumed.' : ''}
      </p>
      {visible.length === 0 || holds.length === 0 ? (
        <p className="note">Nothing to compare: {cmp.sets.length === 0 ? 'no runs match the ticked substrate, gel, charge ratio and concentration' : visible.length === 0 ? 'every data set is unticked in the list above' : 'no dwell time is ticked'}. Tick at least one value in each group.</p>
      ) : (
        <>
          <PlotlyChart data={bars.data} layout={bars.layout} className="plot compare-bars" onReady={(el) => (plotEl.current = el)} config={{ toImageButtonOptions: { format: 'png', filename: fileName, scale: 4 } }} />
          <div className="table-scroll">
            <table className="grid compare-table">
              <thead>
                <tr>
                  <th>Substrate</th>{hasGels && <th>Gel</th>}<th>Charge ratio</th><th>Concentration</th>
                  {holds.map((h) => <th key={h} className="num">{noHold ? `${metric.label} (${metric.unit})` : `${holdName(h)} (${metric.unit})`}</th>)}
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
                      const v = cmp.stat(s, h, metric.key);
                      return <td key={h} className="num">{v.n ? `${fmt(v.mean, metric.digits)} ± ${v.n > 1 ? fmt(v.sd, metric.digits) : '—'} (n = ${v.n})` : '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {numericHolds.length > 1 && (
            <section>
              <h3>{metric.label} vs dwell time</h3>
              <PlotlyChart data={lines.data} layout={lines.layout} className="plot summary" />
            </section>
          )}
        </>
      )}
    </div>
  );
}
