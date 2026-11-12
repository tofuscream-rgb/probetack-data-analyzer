import { useMemo, useState } from 'react';
import { useApp } from '../state/AppContext';
import { mean, sampleSD } from '../analysis/stats';
import { QC_LABEL } from '../analysis/pointOutliers';
import { reviewGroups, type AnalysisRow } from '../analysis/adhesionReview';
import { fmt, meanSd, QcLegend } from './common';
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

  return (
    <div className="analysis-layout">
      <div className="analysis-main">
        <div className="analysis-intro">
          <div className="table-actions">
            <h3 className="exp-title">Condition summaries</h3>
            <div className="segmented small" role="group" aria-label="Which runs">
              <button className={scope === 'experiment' ? 'on' : ''} onClick={() => setScope('experiment')}>All runs in chosen experiments ({rows.length})</button>
              <button className={scope === 'graph' ? 'on' : ''} onClick={() => setScope('graph')}>Only runs on the graph ({graphed.length})</button>
            </div>
          </div>
          <p className="note">Files are grouped by substrate, charge ratio, concentration, gel and holding time. Each run counts once. Z-scores use {primary.toLowerCase()} from all runs with the same conditions, with at least {qc.minGroupSize} valid values. Review colors and automatic exclusion follow the shared Probe Tack settings. Use <em>In average</em> to override a flag for these summaries.</p>
          <p className="note">An asterisk marks work through the last recorded displacement when separation was not detected.</p>
          <QcLegend />
        </div>
        <WorkMethods mode={mode} />
        {!rows.length && <p className="note pad">Open your experiment files and choose the conditions in the sidebar.</p>}
        {scope === 'graph' && !graphed.length && rows.length > 0 && <p className="note pad">Tick runs under Files and runs to include them in this view.</p>}
        {groups.map((g) => {
          const shown = g.runs.filter(({ row }) => scope === 'experiment' || graphIds.has(row.id));
          if (!shown.length) return null;
          const all = shown.map(({ row }) => row);
          const kept = shown.filter(({ row, automatic }) => inclusion[row.id] ?? automatic).map(({ row }) => row);
          const stats = (label: string, metric: (row: AnalysisRow) => number, digits: number) => (
            <span className="group-stat">{label}: <strong>{summarize(all, metric, digits)} / {summarize(kept, metric, digits)}</strong></span>
          );
          return (
            <section className="run-group" key={g.key}>
              <header className="run-group-head"><h3>{g.title}</h3><span>{new Set(all.map((r) => r.fileId)).size} file(s) · {all.length} run(s) · all / included</span></header>
              <div className="run-group-head">
                {stats(primary + ' (N)', (r) => r.primary, 4)}
                {mode === 'peel' && stats('Peak load (N)', (r) => r.peakN, 4)}
                {stats(normalized, (r) => r.normalized, 3)}
                {stats('Wadh (mJ)', (r) => r.workMJ, 3)}
              </div>
              <div className="table-scroll">
                <table className="grid run-table">
                  <thead><tr><th>File</th><th>Run</th><th>{primary} (N)</th>{mode === 'peel' && <th>Peak load (N)</th>}<th>{normalized}</th><th>W<sub>adh</sub> (mJ)</th><th>Modified Z</th><th>Flag</th><th>Why / diagnostics</th><th>In average</th></tr></thead>
                  <tbody>{shown.map(({ row, z, flag, automatic }) => {
                    const included = inclusion[row.id] ?? automatic;
                    const label = `${row.name}, run ${row.number}`;
                    return (
                      <tr key={row.id} className={`hl-${flag} ${included ? '' : 'excluded'}`}>
                        <td title={row.path}>{row.name}<div className="cond">{row.path === row.name ? '' : row.path}</div></td>
                        <td className="num">{row.number}</td><td className="num">{fmt(row.primary, 4)}</td>
                        {mode === 'peel' && <td className="num">{fmt(row.peakN, 4)}</td>}
                        <td className="num">{fmt(row.normalized, 3)}</td><td className="num">{fmt(row.workMJ, 3)}{row.incomplete && ' *'}</td>
                        <td className="num z">{z === null ? '—' : Number.isFinite(z) ? z.toFixed(2) : z < 0 ? '−∞' : '+∞'}</td>
                        <td>{z === null ? 'Not scored' : <span className={`qc-pill ${flag}`}>{QC_LABEL[flag].split(' —')[0]}</span>}</td>
                        <td>{[z === null ? Number.isFinite(row.primary) ? `Only ${g.valid} valid runs in this condition` : 'Missing screening value' : g.method === 'meanAD' ? 'Zero MAD: mean deviation fallback' : '', row.note].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="center">
                          <input type="checkbox" aria-label={`Use ${label} in the average`} checked={included} disabled={!Number.isFinite(row.primary)} onChange={(e) => setInclusion(row.id, e.target.checked === automatic ? null : e.target.checked)} />
                          {inclusion[row.id] !== undefined && <button className="link small" onClick={() => setInclusion(row.id, null)} aria-label={`Reset review of ${label}`}>Reset</button>}
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
