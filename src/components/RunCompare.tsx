import { useMemo, useRef } from 'react';
import type { Data, Layout, PlotlyHTMLElement, Shape } from 'plotly.js';
import { buildRunComparison, type CompareItem, type RunDataSet } from '../analysis/runCompare';
import { PlotlyChart, loadPlotly } from '../plotting/PlotlyChart';
import { PASTEL_COLORS } from '../plotting/colors';
import type { RunCompareSelection } from '../types';
import { AXIS, ChipGroup } from './CompareChargeRatios';
import { fmt } from './common';

export interface CompareMetric {
  key: string;
  label: string;
  unit: string;
  digits: number;
}

type ListKey = 'substrates' | 'chargeRatios' | 'concentrations' | 'holdTimes';

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
  const holdName = (h: string) => (h === '—' ? (noHold ? 'All runs' : 'hold not in file name') : `${h} s`);
  const manyConc = new Set(visible.map((s) => s.concentration)).size > 1;
  const conc = (s: RunDataSet) => `${s.concentration} M${s.concentrationDefault ? '*' : ''}`;
  const tick = (s: RunDataSet) => (manyConc ? `${s.chargeRatio}<br>${conc(s)}` : s.chargeRatio);
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
        customdata: visible.map((s, i) => [s.substrateLabel, s.chargeRatio, conc(s), vals[i].n]),
        marker: { color: PASTEL_COLORS[k % PASTEL_COLORS.length], line: { color: '#18263A', width: 1 } },
        hovertemplate: `%{customdata[0]}, charge ratio %{customdata[1]}, %{customdata[2]}<br>${holdName(h)}: %{y:.${metric.digits}f} ± %{error_y.array:.${metric.digits}f} ${metric.unit} (SD), n = %{customdata[3]}<extra></extra>`,
      } as unknown as Data;
    });
    const panels: { label: string; from: number; to: number }[] = [];
    visible.forEach((s, i) => {
      const last = panels[panels.length - 1];
      if (last && last.label === s.substrateLabel) last.to = i;
      else panels.push({ label: s.substrateLabel, from: i, to: i });
    });
    const shapes: Partial<Shape>[] = panels.slice(1).map((p) => ({ type: 'line', xref: 'x', yref: 'paper', x0: p.from - 0.5, x1: p.from - 0.5, y0: 0, y1: 1, line: { color: '#4A5A70', width: 1.2, dash: 'dash' } }));
    const layout: Partial<Layout> = {
      margin: { l: 76, r: 14, t: 14, b: manyConc ? 78 : 62 },
      font: { family: 'IBM Plex Sans, Arial, sans-serif', size: 13, color: '#18263A' },
      plot_bgcolor: '#ffffff',
      paper_bgcolor: '#ffffff',
      barmode: 'group',
      bargap: 0.22,
      bargroupgap: 0.04,
      showlegend: !noHold,
      xaxis: { ...AXIS, type: 'category', tickvals: x, ticktext: visible.map(tick), title: { text: 'Gel charge ratio', font: { size: 16 } } },
      yaxis: { ...AXIS, rangemode: 'tozero', ...(bottom >= 0 && top > 0 ? { range: [0, top * 1.22] } : {}), title: { text: yTitle, font: { size: 15 } } },
      legend: { x: 0.995, y: 0.99, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.9)', bordercolor: '#18263A', borderwidth: 1 },
      shapes,
      annotations: panels.map((p) => ({ x: (p.from + p.to) / 2, xref: 'x', y: 0.95, yref: 'paper', text: `<b>${p.label}</b>`, showarrow: false, font: { size: 15, color: '#7B8899' } })),
      hovermode: 'closest',
    };
    return { data, layout };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmp, metric.key, manyConc, noHold]);

  const save = async (format: 'png' | 'svg') => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.downloadImage(plotEl.current, { format, filename: fileName, width: 1200, height: 760, scale: format === 'png' ? 4 : 1 } as never);
  };

  if (!items.length) return <p className="note pad">Tick runs in step 2 on the left; their folder names give the substrate, charge ratio and concentration to compare.</p>;

  return (
    <div className="compare-tab">
      <div className="compare-picker">
        <ChipGroup title="Substrate" items={cmp.substrates} selected={cmp.selected.substrates} onToggle={(v) => toggle('substrates', v)} onAll={() => setSel({ substrates: null })} onNone={() => setSel({ substrates: [] })} />
        <ChipGroup title="Charge ratio" items={cmp.chargeRatios.map((v) => ({ value: v, label: v === '—' ? 'unknown' : v }))} selected={cmp.selected.chargeRatios} onToggle={(v) => toggle('chargeRatios', v)} onAll={() => setSel({ chargeRatios: null })} onNone={() => setSel({ chargeRatios: [] })} />
        <ChipGroup title="Concentration" items={cmp.concentrations.map((v) => ({ value: v, label: `${v} M` }))} selected={cmp.selected.concentrations} onToggle={(v) => toggle('concentrations', v)} onAll={() => setSel({ concentrations: null })} onNone={() => setSel({ concentrations: [] })} />
        <ChipGroup title="Holding time" items={cmp.holdTimes.map((v) => ({ value: v, label: holdName(v) }))} selected={cmp.selected.holdTimes} onToggle={(v) => toggle('holdTimes', v)} onAll={() => setSel({ holdTimes: null })} onNone={() => setSel({ holdTimes: [] })} />
      </div>

      <details className="section sets-list" open={cmp.sets.length <= 16}>
        <summary>{visible.length} of {cmp.sets.length} data set(s) compared <small>(untick one to leave it out)</small></summary>
        <div className="chips">
          {cmp.sets.map((s) => (
            <label key={s.key} className={`chip check-chip ${s.hidden ? '' : 'on'}`}>
              <input type="checkbox" checked={!s.hidden} onChange={() => setSel({ hiddenSets: s.hidden ? sel.hiddenSets.filter((k) => k !== s.key) : [...sel.hiddenSets, s.key] })} />
              {s.substrateLabel} · {s.chargeRatio} · {conc(s)}
            </label>
          ))}
        </div>
      </details>

      <div className="table-actions compare-controls">
        <label className="field inline">
          <span>Compare</span>
          <select value={metric.key} onChange={(e) => setSel({ metric: e.target.value })}>
            {metrics.map((m) => <option key={m.key} value={m.key}>{m.label} ({m.unit})</option>)}
          </select>
        </label>
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
        {note} Each data set is one substrate, charge ratio and concentration from the folder names; bars show mean ± SD over its ticked runs
        {noHold ? '' : ', one bar per holding time (from the file name)'}. Concentrations are never averaged together.
        {visible.some((s) => s.concentrationDefault) ? ' * No concentration in the folder name, so 2.1 M is assumed.' : ''}
      </p>
      {visible.length === 0 || holds.length === 0 ? (
        <p className="note">Tick at least one substrate, charge ratio, concentration and holding time with data.</p>
      ) : (
        <>
          <PlotlyChart data={bars.data} layout={bars.layout} className="plot compare-bars" onReady={(el) => (plotEl.current = el)} config={{ toImageButtonOptions: { format: 'png', filename: fileName, scale: 4 } }} />
          <div className="table-scroll">
            <table className="grid compare-table">
              <thead>
                <tr>
                  <th>Substrate</th><th>Charge ratio</th><th>Concentration</th>
                  {holds.map((h) => <th key={h} className="num">{noHold ? `${metric.label} (${metric.unit})` : `${holdName(h)} (${metric.unit})`}</th>)}
                </tr>
              </thead>
              <tbody>
                {visible.map((s) => (
                  <tr key={s.key}>
                    <td>{s.substrateLabel}</td>
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
        </>
      )}
    </div>
  );
}
