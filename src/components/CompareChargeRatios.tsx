import { useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { useApp } from '../state/AppContext';
import { useExperiment } from '../state/experiment';
import { computeGroups, groupValue, type GroupStats, type SummaryStats } from '../analysis/engine';
import { PEAK_LABEL, unitFactor } from '../analysis/cycleMetrics';
import { PlotlyChart } from '../plotting/PlotlyChart';
import { CURVE_COLORS } from '../plotting/colors';
import { CONDITION_KEYS } from './DataAnalysis';
import { forceDigits, meanSd } from './common';

type Which = 'raw' | 'processed';

const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const byNum = (a: string, b: string) => (num(a) - num(b)) || a.localeCompare(b);

export function CompareChargeRatios() {
  const { derived, project } = useApp();
  const ex = useExperiment();
  const u = project.settings.forceUnit;
  const f = unitFactor(u);
  const d = forceDigits(u);
  const [which, setWhich] = useState<Which>('processed');
  const [concPick, setConc] = useState<string | null>(null);
  const [subPick, setSub] = useState<string | null>(null);

  const all = useMemo(() => computeGroups(derived.ordered, CONDITION_KEYS), [derived]);
  const concOptions = useMemo(() => [...new Set(derived.ordered.map((r) => groupValue(r, 'concentrationM')))].sort(byNum), [derived]);
  // Default: the concentration measured at the most charge ratios (e.g. 2.1 M), preferring the chosen experiment's on a tie.
  const ratiosAt = (c: string) => new Set(all.filter((g) => g.label.concentrationM === c).map((g) => g.label.chargeRatio)).size;
  const bestConc = [...concOptions].sort((a, b) => ratiosAt(b) - ratiosAt(a) || (b === ex.concentrationM ? 1 : 0) - (a === ex.concentrationM ? 1 : 0))[0];
  const conc = concPick && concOptions.includes(concPick) ? concPick : bestConc;
  const subOptions = useMemo(
    () => [...new Set(derived.ordered.filter((r) => groupValue(r, 'concentrationM') === conc).map((r) => groupValue(r, 'substrate')))].sort(byNum),
    [derived, conc],
  );
  const sub = subPick && subOptions.includes(subPick) ? subPick : ex.substrate && subOptions.includes(ex.substrate) ? ex.substrate : subOptions[0];

  const groups = all.filter((g) => g.label.concentrationM === conc && g.label.substrate === sub);
  const ratios = [...new Set(groups.map((g) => g.label.chargeRatio))].sort(byNum);
  const holds = [...new Set(groups.map((g) => g.label.holdTimeS))].sort(byNum);
  const cell = (cr: string, h: string): GroupStats | undefined => groups.find((g) => g.label.chargeRatio === cr && g.label.holdTimeS === h);
  const st = (g: GroupStats | undefined): SummaryStats | null => (g ? g[which] : null);
  const peakName = PEAK_LABEL[project.settings.peakMetric].toLowerCase();

  const chart = (xs: string[], series: string[], get: (x: string, s: string) => GroupStats | undefined, xTitle: string, seriesName: (s: string) => string) => {
    const data: Data[] = series.map((s, k) => {
      const pts = xs.map((x) => ({ x, v: st(get(x, s)) })).filter((p) => p.v && p.v.n > 0 && Number.isFinite(num(p.x)));
      const color = CURVE_COLORS[k % CURVE_COLORS.length];
      return {
        type: 'scatter',
        mode: 'lines+markers',
        name: seriesName(s),
        x: pts.map((p) => num(p.x)),
        y: pts.map((p) => p.v!.mean * f),
        error_y: { type: 'data', array: pts.map((p) => (p.v!.sd || 0) * f), visible: true, color, thickness: 1 },
        text: pts.map((p) => `n = ${p.v!.n}`),
        line: { color, width: 2 },
        marker: { color, size: 8 },
        hovertemplate: `${seriesName(s)}<br>${xTitle} %{x}<br>mean %{y:.3f} ± %{error_y.array:.3f} (SD)<br>%{text}<extra></extra>`,
      } as unknown as Data;
    });
    const layout: Partial<Layout> = {
      margin: { l: 64, r: 10, t: 10, b: 46 },
      font: { family: 'IBM Plex Sans, system-ui, sans-serif', size: 11, color: '#18263A' },
      xaxis: { title: { text: xTitle }, gridcolor: '#EEF2F6', zeroline: false, ...(xTitle === 'Charge ratio' ? { tickvals: xs.map(num).filter(Number.isFinite) } : {}) },
      yaxis: { title: { text: `Mean ${peakName} (${u})` }, zerolinecolor: '#C9D2DD', gridcolor: '#EEF2F6' },
      legend: { orientation: 'h', y: -0.25 },
      hovermode: 'closest',
    };
    return { data, layout };
  };
  const byRatio = chart(ratios, holds, (cr, h) => cell(cr, h), 'Charge ratio', (h) => `${h} s hold`);
  const byHold = chart(holds, ratios, (h, cr) => cell(cr, h), 'Holding time (s)', (cr) => `Charge ratio ${cr}`);

  if (!derived.ordered.length) return <p className="note">Open your experiment folder in step 1 on the left to compare charge ratios.</p>;

  return (
    <div className="compare-tab">
      <div className="table-actions compare-controls">
        <label className="field inline">
          <span>Total monomer concentration</span>
          <select value={conc} onChange={(e) => setConc(e.target.value)}>
            {concOptions.map((c) => <option key={c} value={c}>{c} M</option>)}
          </select>
        </label>
        <label className="field inline">
          <span>Substrate</span>
          <select value={sub} onChange={(e) => setSub(e.target.value)}>
            {subOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <div className="segmented small" role="group" aria-label="Which runs">
          <button className={which === 'processed' ? 'on' : ''} onClick={() => setWhich('processed')}>Without outliers</button>
          <button className={which === 'raw' ? 'on' : ''} onClick={() => setWhich('raw')}>All runs</button>
        </div>
      </div>
      <p className="note">
        Mean ± SD of the {peakName} in {u}, one value per run. Only charge ratios measured at {conc} M on {sub} are shown, so different concentrations are never
        mixed. Runs on the same specimen are not independent replicates.
      </p>
      {ratios.length === 0 ? (
        <p className="note">No data for this combination.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="grid compare-table">
              <thead>
                <tr>
                  <th>Charge ratio</th>
                  {holds.map((h) => <th key={h} className="num">{h} s hold</th>)}
                </tr>
              </thead>
              <tbody>
                {ratios.map((cr) => (
                  <tr key={cr}>
                    <td className="strong">{cr}</td>
                    {holds.map((h) => {
                      const v = st(cell(cr, h));
                      return <td key={h} className="num">{v ? meanSd(v.mean * f, v.sd * f, v.n, d) : '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="compare-charts">
            <section>
              <h3>Peak force vs charge ratio</h3>
              <PlotlyChart data={byRatio.data} layout={byRatio.layout} className="plot summary" />
            </section>
            <section>
              <h3>Peak force vs holding time</h3>
              <PlotlyChart data={byHold.data} layout={byHold.layout} className="plot summary" />
            </section>
          </div>
        </>
      )}
    </div>
  );
}
