import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { mean, sampleSD } from '../analysis/stats';
import { QC_LABEL } from '../analysis/pointOutliers';
import { reviewGroups, type AnalysisRow } from '../analysis/adhesionReview';
import { fmt, meanSd, QcLegend } from './common';
import { GF_TO_N } from '../types';
import { WorkMethods } from './AdhesionMethods';

function summarize(rows: AnalysisRow[], metric: (row: AnalysisRow) => number, digits: number) {
  const values = rows.map(metric).filter(Number.isFinite);
  return meanSd(mean(values), sampleSD(values), values.length, digits);
}

export function AdhesionDataAnalysis({ mode, rows, graphed, inclusion, setInclusion }: {
  mode: 'lapShear' | 'peel';
  rows: AnalysisRow[];
  graphed: string[];
  inclusion: Record<string, boolean>;
  setInclusion: (id: string, value: boolean | null) => void;
}) {
  const { project } = useApp();
  const [scope, setScope] = useState<'experiment' | 'graph'>('experiment');
  const qc = project.settings.cycle;
  const exclude = project.settings.runExclusion.excludeClasses;
  const graphIds = new Set(graphed);
  const primary = mode === 'lapShear' ? 'Peak load' : 'Steady-state force';
  const normalized = mode === 'lapShear' ? 'Apparent strength (kPa)' : 'Peel energy (J/m²)';
  const groups = useMemo(() => {
    return reviewGroups(rows, qc, exclude);
  }, [rows, qc, exclude]);

  const dupNames = new Set(rows.map((r) => r.name).filter((n, i, all) => all.indexOf(n) !== i && rows.some((x) => x.name === n && x.fileId !== rows[i].fileId)));

  return (
    <div className="analysis-layout">
      <div className="analysis-main">
        <div className="analysis-intro">
          <div className="table-actions">
            <h3 className="exp-title">Condition summaries</h3>
            <div className="segmented small" role="group" aria-label="Which runs">
              <button className={scope === 'experiment' ? 'on' : ''} aria-pressed={scope === 'experiment'} onClick={() => setScope('experiment')}>Chosen experiment ({rows.length} runs)</button>
              <button className={scope === 'graph' ? 'on' : ''} aria-pressed={scope === 'graph'} onClick={() => setScope('graph')}>Runs on the graph ({graphed.length})</button>
            </div>
          </div>
          <p className="note">One summary per condition (substrate × charge ratio × concentration × gel × dwell time); repeat files of the same condition, such as 1s.txt and 1s-v2.txt, are combined. Each run counts once. The modified Z-score uses the {primary.toLowerCase()} of the runs of the condition and needs at least {qc.minGroupSize} valid values; otherwise the run is <em>not scored</em>. Flag colours and automatic exclusion follow the shared settings. Untick or tick <em>In average</em> to decide yourself; <em>Reset</em> returns to the automatic decision.</p>
          <p className="note">An asterisk marks work integrated to the end of the recording because no separation was detected.</p>
          <QcLegend />
        </div>
        <WorkMethods mode={mode} />
        {!rows.length && <p className="note pad">No runs in the chosen experiment. Open your files in step 1, or set a dropdown in step 2 back to <em>All</em>.</p>}
        {scope === 'graph' && !graphed.length && rows.length > 0 && <p className="note pad">No runs on the graph. Tick runs under “Runs on the graph” on the left.</p>}
        {groups.map((g) => {
          const shown = g.runs.filter(({ row }) => scope === 'experiment' || graphIds.has(row.id));
          if (!shown.length) return null;
          const all = shown.map(({ row }) => row).filter((r) => Number.isFinite(r.primary));
          const kept = shown.filter(({ row, automatic }) => inclusion[row.id] ?? automatic).map(({ row }) => row);
          const sources = [...new Map(shown.map(({ row }) => [row.fileId, row])).values()];
          return (
            <section className="run-group" key={g.key}>
              <header className="run-group-head"><h3>{g.title}</h3><span>{sources.length} file{sources.length === 1 ? '' : 's'} · {shown.length} run{shown.length === 1 ? '' : 's'}</span></header>
              <div className="table-scroll">
                <table className="grid group-summary">
                  <thead><tr><th>Mean ± sample SD (n)</th><th className="num">{primary} (N)</th><th className="num">{primary} (gf)</th>{mode === 'peel' && <th className="num">Peak load (N)</th>}<th className="num">{normalized}</th><th className="num">W<sub>adh</sub> (mJ)</th></tr></thead>
                  <tbody>
                    {([['All valid runs', all], ['Included runs after review', kept]] as [string, AnalysisRow[]][]).map(([label, list], i) => (
                      <tr key={label}>
                        <th>{label}</th>
                        <td className={`num ${i ? 'strong' : ''}`}>{summarize(list, (r) => r.primary, 4)}</td>
                        <td className={`num ${i ? 'strong' : ''}`}>{summarize(list, (r) => r.primary / GF_TO_N, 2)}</td>
                        {mode === 'peel' && <td className={`num ${i ? 'strong' : ''}`}>{summarize(list, (r) => r.peakN, 4)}</td>}
                        <td className={`num ${i ? 'strong' : ''}`}>{summarize(list, (r) => r.normalized, 3)}</td>
                        <td className={`num ${i ? 'strong' : ''}`}>{summarize(list, (r) => r.workMJ, 3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note sources">Source files: {sources.map((r) => <span key={r.fileId} title={r.path} className="source-file">{r.name}</span>)}</p>
              <div className="table-scroll">
                <table className="grid run-table">
                  <thead><tr><th>File</th><th className="num">Run</th><th className="num">{primary} (N)</th>{mode === 'peel' && <th className="num">Peak load (N)</th>}<th className="num">{normalized}</th><th className="num">W<sub>adh</sub> (mJ)</th><th className="num">Modified Z</th><th>Flag</th><th>Reason</th><th>In average</th></tr></thead>
                  <tbody>{shown.map(({ row, z, flag, automatic }) => {
                    const included = inclusion[row.id] ?? automatic;
                    const label = `${row.name}, run ${row.number}`;
                    const reason = z === null ? Number.isFinite(row.primary) ? `Not scored: ${g.valid} valid run${g.valid === 1 ? '' : 's'} (needs ${qc.minGroupSize})` : 'Missing measurement' : g.method === 'meanAD' ? 'Zero MAD: mean deviation fallback' : flag === 'green' ? '' : `|Z| = ${Math.abs(z).toFixed(2)}`;
                    const notes = row.note ? row.note.split(' · ') : [];
                    return (
                      <tr key={row.id} className={`hl-${flag} ${included ? '' : 'excluded'}`}>
                        <td title={row.path}>{row.name}{dupNames.has(row.name) && <div className="cond">{row.path.split('/').slice(-3, -1).join('/')}</div>}</td>
                        <td className="num">{row.number}</td><td className="num">{fmt(row.primary, 4)}</td>
                        {mode === 'peel' && <td className="num">{fmt(row.peakN, 4)}</td>}
                        <td className="num">{fmt(row.normalized, 3)}</td><td className="num">{fmt(row.workMJ, 3)}{row.incomplete && ' *'}</td>
                        <td className="num z">{z === null ? '—' : Number.isFinite(z) ? z.toFixed(2) : z < 0 ? '−∞' : '+∞'}</td>
                        <td>{z === null ? <span className="muted">Not scored</span> : <span className={`qc-pill ${flag}`}>{flag === 'green' ? 'ok' : QC_LABEL[flag].split(' —')[0].toLowerCase()}</span>}</td>
                        <td className="reason">
                          {reason || (notes.length ? '' : <span className="muted">—</span>)}
                          {notes.length > 0 && (
                            <details className="diag-more"><summary>{notes.length} diagnostic note{notes.length === 1 ? '' : 's'}</summary>{notes.map((n) => <div key={n}>{n}</div>)}</details>
                          )}
                        </td>
                        <td className="center">
                          <span className="in-average">
                            <input type="checkbox" aria-label={`Use ${label} in the average`} checked={included} disabled={!Number.isFinite(row.primary)} onChange={(e) => setInclusion(row.id, e.target.checked === automatic ? null : e.target.checked)} />
                            {inclusion[row.id] !== undefined && <button className="link small" onClick={() => setInclusion(row.id, null)} aria-label={`Reset ${label} to the automatic decision`} title="Back to the automatic decision">Reset</button>}
                          </span>
                        </td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
