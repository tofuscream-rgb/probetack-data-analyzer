import { useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { useApp } from '../state/AppContext';
import { useExperiment } from '../state/experiment';
import { computeGroups, groupValue, type CycleResult, type GroupStats, type SummaryStats } from '../analysis/engine';
import { displayFactor, peakLabel } from '../analysis/cycleMetrics';
import { PlotlyChart } from '../plotting/PlotlyChart';
import { CURVE_COLORS } from '../plotting/colors';
import { forceDigits, meanSd } from './common';

type Which = 'raw' | 'processed';

const ALL = '__all__';
const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const byNum = (a: string, b: string) => {
  const x = num(a);
  const y = num(b);
  if (Number.isFinite(x) && Number.isFinite(y)) return x - y;
  return Number.isFinite(x) ? -1 : Number.isFinite(y) ? 1 : a.localeCompare(b);
};
/** "ss", "SS" and " ss " are the same substrate. */
const subKey = (r: CycleResult) => groupValue(r, 'substrate').trim().toLowerCase();

/** One gel = one charge ratio at one total monomer concentration. */
interface Gel {
  key: string;
  cr: string;
  conc: string;
  label: string;
}

export function CompareChargeRatios() {
  const { derived, project } = useApp();
  const ex = useExperiment();
  const u = project.settings.forceUnit;
  const f = displayFactor(project.settings);
  const fa = Math.abs(f); // SD is never negative
  const d = forceDigits(u);
  const [which, setWhich] = useState<Which>('processed');
  const [subPick, setSub] = useState<string | null>(null);
  const [concPick, setConc] = useState<string>(ALL);

  // Substrates, merged case-insensitively; shown with their most common spelling.
  const subOptions = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of derived.ordered) {
      const spellings = m.get(subKey(r)) ?? new Map<string, number>();
      spellings.set(groupValue(r, 'substrate'), (spellings.get(groupValue(r, 'substrate')) ?? 0) + 1);
      m.set(subKey(r), spellings);
    }
    return [...m]
      .map(([value, spellings]) => ({ value, label: [...spellings].sort((a, b) => b[1] - a[1])[0][0] }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [derived]);
  const chosenSub = ex.substrate?.trim().toLowerCase() ?? null;
  const sub = subPick && subOptions.some((o) => o.value === subPick) ? subPick : chosenSub && subOptions.some((o) => o.value === chosenSub) ? chosenSub : subOptions[0]?.value;
  const subLabel = subOptions.find((o) => o.value === sub)?.label ?? '';

  const onSub = useMemo(() => derived.ordered.filter((r) => subKey(r) === sub), [derived, sub]);
  const concOptions = useMemo(() => [...new Set(onSub.map((r) => groupValue(r, 'concentrationM')))].sort(byNum), [onSub]);
  const conc = concPick !== ALL && concOptions.includes(concPick) ? concPick : ALL;
  const runs = conc === ALL ? onSub : onSub.filter((r) => groupValue(r, 'concentrationM') === conc);

  // Statistics per gel and holding time (concentration is always part of the key).
  const groups = useMemo(() => computeGroups(runs, ['chargeRatio', 'concentrationM', 'holdTimeS']), [runs]);
  const gels = useMemo<Gel[]>(() => {
    const m = new Map<string, Gel>();
    for (const r of runs) {
      const cr = groupValue(r, 'chargeRatio');
      const c = groupValue(r, 'concentrationM');
      const key = `${cr} | ${c}`;
      if (!m.has(key)) {
        const dflt = runs.filter((x) => groupValue(x, 'chargeRatio') === cr && groupValue(x, 'concentrationM') === c).every((x) => x.meta.concentrationM.source === 'default');
        m.set(key, { key, cr, conc: c, label: `${cr} · ${c} M${dflt ? '*' : ''}` });
      }
    }
    return [...m.values()].sort((a, b) => byNum(a.cr, b.cr) || byNum(a.conc, b.conc));
  }, [runs]);
  const holds = [...new Set(groups.map((g) => g.label.holdTimeS))].sort(byNum);
  const cell = (gel: Gel, h: string): GroupStats | undefined =>
    groups.find((g) => g.label.chargeRatio === gel.cr && g.label.concentrationM === gel.conc && g.label.holdTimeS === h);
  const st = (g: GroupStats | undefined): SummaryStats | null => (g ? g[which] : null);
  const peakName = peakLabel(project.settings).toLowerCase();
  const anyDefault = gels.some((g) => g.label.endsWith('*'));

  const font = { family: 'IBM Plex Sans, system-ui, sans-serif', size: 11, color: '#18263A' };
  const yaxis = { title: { text: `Mean ${peakName} (${u})` }, zerolinecolor: '#C9D2DD', gridcolor: '#EEF2F6' };

  // Chart 1: one group of bars per gel, one bar per holding time.
  const byGel = useMemo(() => {
    const data: Data[] = holds.map((h, k) => {
      const color = CURVE_COLORS[k % CURVE_COLORS.length];
      const vals = gels.map((g) => st(cell(g, h)));
      return {
        type: 'bar',
        name: `${h} s hold`,
        x: gels.map((g) => g.label),
        y: vals.map((v) => (v && v.n > 0 ? v.mean * f : null)),
        error_y: { type: 'data', array: vals.map((v) => (v && v.n > 0 ? (v.sd || 0) * fa : 0)), visible: true, color: '#18263A', thickness: 1 },
        text: vals.map((v) => (v ? `n = ${v.n}` : '')),
        textposition: 'none', // n is shown on hover and in the table
        marker: { color },
        hovertemplate: `Gel %{x}<br>${h} s hold<br>mean %{y:.3f} ± %{error_y.array:.3f} (SD)<br>%{text}<extra></extra>`,
      } as unknown as Data;
    });
    const layout: Partial<Layout> = {
      margin: { l: 64, r: 10, t: 10, b: 60 },
      font,
      barmode: 'group',
      xaxis: { title: { text: 'Gel (charge ratio · concentration)' }, type: 'category' },
      yaxis,
      legend: { orientation: 'h', y: -0.3 },
      hovermode: 'closest',
    };
    return { data, layout };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gels, groups, holds.join('|'), which, f]);

  // Chart 2: one line per gel across holding times.
  const byHold = useMemo(() => {
    const data: Data[] = gels.map((g, k) => {
      const color = CURVE_COLORS[k % CURVE_COLORS.length];
      const pts = holds.map((h) => ({ h, v: st(cell(g, h)) })).filter((p) => p.v && p.v.n > 0 && Number.isFinite(num(p.h)));
      return {
        type: 'scatter',
        mode: 'lines+markers',
        name: g.label,
        x: pts.map((p) => num(p.h)),
        y: pts.map((p) => p.v!.mean * f),
        error_y: { type: 'data', array: pts.map((p) => (p.v!.sd || 0) * fa), visible: true, color, thickness: 1 },
        text: pts.map((p) => `n = ${p.v!.n}`),
        line: { color, width: 2 },
        marker: { color, size: 8 },
        hovertemplate: `Gel ${g.label}<br>%{x} s hold<br>mean %{y:.3f} ± %{error_y.array:.3f} (SD)<br>%{text}<extra></extra>`,
      } as unknown as Data;
    });
    const layout: Partial<Layout> = {
      margin: { l: 64, r: 10, t: 10, b: 60 },
      font,
      xaxis: { title: { text: 'Holding time (s)' }, gridcolor: '#EEF2F6', zeroline: false },
      yaxis,
      legend: { orientation: 'h', y: -0.3 },
      hovermode: 'closest',
    };
    return { data, layout };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gels, groups, holds.join('|'), which, f]);

  if (!derived.ordered.length) return <p className="note">Open your experiment folder in step 1 on the left to compare charge ratios.</p>;

  return (
    <div className="compare-tab">
      <div className="table-actions compare-controls">
        <label className="field inline">
          <span>Substrate</span>
          <select value={sub} onChange={(e) => { setSub(e.target.value); setConc(ALL); }}>
            {subOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="field inline">
          <span>Total monomer concentration</span>
          <select value={conc} onChange={(e) => setConc(e.target.value)}>
            <option value={ALL}>All concentrations</option>
            {concOptions.map((c) => <option key={c} value={c}>{c} M</option>)}
          </select>
        </label>
        <div className="segmented small" role="group" aria-label="Which runs">
          <button className={which === 'processed' ? 'on' : ''} onClick={() => setWhich('processed')}>Without outliers</button>
          <button className={which === 'raw' ? 'on' : ''} onClick={() => setWhich('raw')}>All runs</button>
        </div>
      </div>
      <p className="note">
        Every gel measured on {subLabel || 'this substrate'}: {gels.length} gel(s) (charge ratio · total monomer concentration) and {holds.length} holding time(s).
        Mean ± SD of the {peakName} in {u}, one value per run. Different concentrations are kept as separate gels, never averaged together. Runs on the
        same specimen are not independent replicates.{anyDefault ? ' * No concentration in the folder name, so 2.1 M is assumed.' : ''}
      </p>
      {gels.length === 0 ? (
        <p className="note">No data for this substrate.</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="grid compare-table">
              <thead>
                <tr>
                  <th>Charge ratio</th>
                  <th>Concentration</th>
                  {holds.map((h) => <th key={h} className="num">{h} s hold</th>)}
                </tr>
              </thead>
              <tbody>
                {gels.map((g) => (
                  <tr key={g.key}>
                    <td className="strong">{g.cr}</td>
                    <td>{g.conc} M{g.label.endsWith('*') ? '*' : ''}</td>
                    {holds.map((h) => {
                      const v = st(cell(g, h));
                      return <td key={h} className="num">{v && v.n > 0 ? meanSd(v.mean * f, v.sd * fa, v.n, d) : '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="compare-charts">
            <section>
              <h3>Peak force vs charge ratio (each gel)</h3>
              <PlotlyChart data={byGel.data} layout={byGel.layout} className="plot summary" />
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
