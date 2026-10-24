import { useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { useApp } from '../state/AppContext';
import { STATUS_LABEL, computeGroups, groupValue, isIncluded, type CycleResult, type SummaryStats } from '../analysis/engine';
import { PEAK_LABEL, unitFactor } from '../analysis/cycleMetrics';
import { QC_LABEL } from '../analysis/pointOutliers';
import { PlotlyChart } from '../plotting/PlotlyChart';
import type { GroupKey } from '../types';
import { CURVE_COLORS } from '../plotting/colors';
import { CONDITION_KEYS, conditionTitle } from './DataAnalysis';
import { compareConditionKeys, fmt, forceDigits, meanSd } from './common';

type ChartMode = 'raw' | 'processed' | 'both';

interface Row {
  hold: string;
  holdNum: number;
  runs: CycleResult[];
  raw: SummaryStats | null;
  processed: SummaryStats | null;
}

interface Block {
  key: string;
  title: string;
  rows: Row[];
}

const BLOCK_KEYS: GroupKey[] = ['chargeRatio', 'concentrationM', 'substrate'];
const blockKey = (r: CycleResult) => BLOCK_KEYS.map((k) => groupValue(r, k)).join(' | ');

export function DataSummary() {
  const { visible, derived, project } = useApp();
  const [mode, setMode] = useState<ChartMode>('both');
  const [repeatLevel, setRepeatLevel] = useState(false);
  const u = project.settings.forceUnit;
  const f = unitFactor(u);
  const d = forceDigits(u);

  const blocks = useMemo<Block[]>(() => {
    const stats = new Map(computeGroups(visible, CONDITION_KEYS).map((g) => [g.key, g]));
    const map = new Map<string, Map<string, CycleResult[]>>();
    for (const r of visible) {
      const bk = blockKey(r);
      const rows = map.get(bk) ?? new Map<string, CycleResult[]>();
      const hold = groupValue(r, 'holdTimeS');
      rows.set(hold, [...(rows.get(hold) ?? []), r]);
      map.set(bk, rows);
    }
    return [...map]
      .sort(([a], [b]) => compareConditionKeys(a, b))
      .map(([key, rows]) => ({
        key,
        title: conditionTitle([...rows.values()][0][0], false),
        rows: [...rows]
          .map(([hold, runs]) => {
            const g = stats.get(`${key} | ${hold}`); // same key order as CONDITION_KEYS
            return { hold, holdNum: Number(hold), runs, raw: g?.raw ?? null, processed: g?.processed ?? null };
          })
          .sort((a, b) => (Number.isFinite(a.holdNum) ? a.holdNum : Infinity) - (Number.isFinite(b.holdNum) ? b.holdNum : Infinity)),
      }));
  }, [visible]);

  const chart = useMemo(() => {
    const traces: Data[] = [];
    blocks.forEach((b, k) => {
      const color = CURVE_COLORS[k % CURVE_COLORS.length];
      const rows = b.rows.filter((r) => Number.isFinite(r.holdNum));
      const add = (which: 'raw' | 'processed', dash: 'solid' | 'dash') => {
        const pts = rows.map((r) => ({ x: r.holdNum, st: r[which] })).filter((p) => p.st && p.st.n > 0);
        const y = pts.map((p) => (repeatLevel ? p.st!.repeatMean : p.st!.mean) * f);
        const e = pts.map((p) => ((repeatLevel ? p.st!.repeatSD : p.st!.sd) || 0) * f);
        const n = pts.map((p) => (repeatLevel ? `${p.st!.nRepeats} repeat(s)` : `${p.st!.n} run(s)`));
        const name = `${b.title}${mode === 'both' ? (which === 'raw' ? ' (raw)' : ' (processed)') : ''}`;
        traces.push({
          type: 'scatter',
          mode: 'lines+markers',
          name,
          x: pts.map((p) => p.x),
          y,
          text: n,
          error_y: { type: 'data', array: e, visible: true, color, thickness: 1 },
          line: { color, dash, width: dash === 'dash' ? 1.4 : 2 },
          marker: { color, size: 7, symbol: which === 'raw' && mode === 'both' ? 'circle-open' : 'circle' },
          hovertemplate: `${name}<br>%{x} s hold<br>mean %{y:.3f} ± %{error_y.array:.3f} (SD)<br>%{text}<extra></extra>`,
        } as unknown as Data);
      };
      if (mode !== 'raw') add('processed', 'solid');
      if (mode !== 'processed') add('raw', mode === 'both' ? 'dash' : 'solid');
    });
    const layout: Partial<Layout> = {
      margin: { l: 64, r: 10, t: 10, b: 46 },
      font: { family: 'IBM Plex Sans, system-ui, sans-serif', size: 11, color: '#18263A' },
      xaxis: { title: { text: 'Holding time (s)' }, gridcolor: '#EEF2F6', zeroline: false },
      yaxis: { title: { text: `Mean ${PEAK_LABEL[project.settings.peakMetric].toLowerCase()} (${u})` }, zerolinecolor: '#C9D2DD', gridcolor: '#EEF2F6' },
      legend: { orientation: 'h', y: -0.22 },
      hovermode: 'closest',
    };
    return { traces, layout };
  }, [blocks, mode, repeatLevel, f, u, project.settings.peakMetric]);

  if (!derived.ordered.length) return <p className="note pad">Import files with the navigator on the left to see the summary.</p>;

  const stat = (st: SummaryStats | null) =>
    st ? (
      <>
        <div className="ms">{meanSd(st.mean * f, st.sd * f, st.n, d)}</div>
        {repeatLevel && <div className="ms repeat" title="Each repeat (file) averaged first">Repeats: {meanSd(st.repeatMean * f, st.repeatSD * f, st.nRepeats, d)}</div>}
      </>
    ) : (
      <div className="ms">no runs</div>
    );

  return (
    <div className="summary-tab">
      <div className="table-actions">
        <span>
          {PEAK_LABEL[project.settings.peakMetric]} in {u}, for the runs shown by the navigator filters. Runs on the same specimen are not independent
          replicates.
        </span>
        <label className="check-row">
          <input type="checkbox" checked={repeatLevel} onChange={(e) => setRepeatLevel(e.target.checked)} /> Also show repeat-level statistics (average per repeat first)
        </label>
      </div>
      {blocks.length === 0 && <p className="note">No runs match the current filters.</p>}
      {blocks.map((b) => (
        <section key={b.key} className="summary-block">
          <h3>{b.title}</h3>
          <div className="table-scroll">
            <table className="grid summary-table">
              <thead>
                <tr>
                  <th>Hold (s)</th>
                  <th className="grp">Raw (all runs)</th>
                  <th className="grp">Flagged</th>
                  <th className="grp">Processed (after exclusions)</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row) => {
                  const nExcluded = row.runs.filter((r) => !isIncluded(r)).length;
                  return (
                    <tr key={row.hold}>
                      <td className="num strong">{row.hold}</td>
                      <td>
                        <div className="values">{row.runs.map((r) => <span key={r.cycle.cycleId}>{fmt(r.peakRaw * f, d)}</span>)}</div>
                        {stat(row.raw)}
                      </td>
                      <td>
                        <div className="values">
                          {row.runs.map((r) => (
                            <span
                              key={r.cycle.cycleId}
                              className={`vchip ${r.qc} ${isIncluded(r) ? '' : 'out'}`}
                              title={`Repeat ${r.meta.repeat.value}, Run ${r.cycle.cycleNumber}: ${QC_LABEL[r.qc]}. ${STATUS_LABEL[r.status]}`}
                            >
                              {fmt(r.peakRaw * f, d)}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {stat(row.processed)}
                        <div className="excl">{nExcluded ? `${nExcluded} run(s) excluded` : 'none excluded'}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {blocks.length > 0 && (
        <section className="summary-block">
          <div className="table-actions">
            <h3>Mean ± SD versus holding time{repeatLevel ? ' (repeat level)' : ''}</h3>
            <div className="segmented small" role="group" aria-label="Chart data">
              {(['raw', 'processed', 'both'] as ChartMode[]).map((m) => (
                <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>
                  {m === 'raw' ? 'Raw' : m === 'processed' ? 'Processed' : 'Both'}
                </button>
              ))}
            </div>
            {mode === 'both' && <span>processed solid, raw dashed</span>}
          </div>
          <PlotlyChart data={chart.traces} layout={chart.layout} className="plot summary" />
        </section>
      )}
    </div>
  );
}
