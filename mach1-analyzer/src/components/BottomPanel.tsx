import { useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { useApp, useGraphActions } from '../state/AppContext';
import { GROUP_LABEL, groupValue, type CycleResult } from '../analysis/engine';
import { unitFactor } from '../analysis/cycleMetrics';
import { QC_ORDER } from '../analysis/pointOutliers';
import { PlotlyChart } from '../plotting/PlotlyChart';
import type { GroupKey } from '../types';
import { QcRibbon } from './Navigator';

const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));

function ImportStatus() {
  const { files, skipped, pending } = useApp();
  const ok = files.filter((f) => f.parsed.status === 'ok').length;
  const warn = files.filter((f) => f.parsed.status === 'warning').length;
  const err = files.filter((f) => f.parsed.status === 'error').length;
  if (!files.length && !skipped.length && !pending.length) return <p className="note">No files imported yet.</p>;
  return (
    <div className="import-status">
      <p className="summary-line">
        <span className="pill ok">{ok} imported</span> <span className="pill warning">{warn} with warnings</span>{' '}
        <span className="pill error">{err} unreadable or empty</span> <span className="pill">{files.reduce((s, f) => s + f.cycles.length, 0)} cycles</span>
        {skipped.length > 0 && <span className="pill">{skipped.length} non-TXT files skipped</span>}
      </p>
      <table className="grid">
        <thead>
          <tr><th>Status</th><th>File</th><th>Cycles</th><th>Blocks</th><th>Recorded</th><th>Messages</th></tr>
        </thead>
        <tbody>
          {files.map((l) => (
            <tr key={l.parsed.fileId} className={l.parsed.status}>
              <td><span className={`status ${l.parsed.status}`}>{l.parsed.status === 'ok' ? 'OK' : l.parsed.status === 'warning' ? 'Warning' : 'No data'}</span></td>
              <td title={l.parsed.sha256}>{l.parsed.path}</td>
              <td className="num">{l.cycles.length}</td>
              <td className="num">{l.parsed.blocks.length}</td>
              <td>{l.parsed.header['Date'] ?? '—'}</td>
              <td className="msgs">{l.parsed.issues.length ? l.parsed.issues.map((i, k) => <div key={k} className={i.severity}>{i.message}</div>) : '—'}</td>
            </tr>
          ))}
          {pending.map((p) => (
            <tr key={p.fileId} className="warning">
              <td><span className="status warning">Missing</span></td>
              <td>{p.path}</td>
              <td colSpan={4}>Listed in the project but not selected yet.</td>
            </tr>
          ))}
          {skipped.map((s, i) => (
            <tr key={`s${i}`} className="muted">
              <td>Skipped</td>
              <td>{s.path}</td>
              <td colSpan={4}>{s.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type SortKey = 'cond' | 'file' | 'cycle' | 'peak' | 'min' | 'max' | 'score' | 'qc' | 'date';

function CycleTable() {
  const { visible, project, update, setUi, ui } = useApp();
  const { addToActive } = useGraphActions();
  const [sort, setSort] = useState<{ k: SortKey; asc: boolean }>({ k: 'cond', asc: true });
  const u = project.settings.forceUnit;
  const f = unitFactor(u);
  const sel = new Set(project.selection);
  const rows = useMemo(() => {
    const val = (r: CycleResult): string | number => {
      switch (sort.k) {
        case 'cond': return `${r.meta.concentrationM.value}|${r.meta.chargeRatio.value}|${r.meta.substrate.value}|${String(r.holdTimeS).padStart(6, '0')}|${r.file.path}|${String(r.cycle.cycleNumber).padStart(4, '0')}`;
        case 'file': return r.file.path;
        case 'cycle': return r.cycle.cycleNumber;
        case 'peak': return r.peakProcessed;
        case 'min': return r.raw.min;
        case 'max': return r.raw.max;
        case 'score': return r.cycleScore;
        case 'qc': return QC_ORDER.indexOf(r.qc);
        case 'date': return r.cycle.timestamp ?? '';
      }
    };
    return [...visible].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === 'number' && typeof y === 'number' ? (Number.isFinite(x) ? x : Infinity) - (Number.isFinite(y) ? y : Infinity) : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sort.asc ? c : -c;
    });
  }, [visible, sort]);
  const H = ({ k, children }: { k: SortKey; children: string }) => (
    <th aria-sort={sort.k === k ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button className="th-sort" onClick={() => setSort((s) => ({ k, asc: s.k === k ? !s.asc : true }))}>
        {children} {sort.k === k ? (sort.asc ? '▲' : '▼') : ''}
      </button>
    </th>
  );
  const toggle = (id: string, on: boolean) =>
    update((p) => ({ ...p, selection: on ? [...new Set([...p.selection, id])] : p.selection.filter((x) => x !== id) }));
  const redIds = rows.filter((r) => r.qc === 'red' && !r.cycleExcluded).map((r) => r.cycle.cycleId);

  return (
    <div className="cycle-table">
      <div className="table-actions">
        <span>{rows.length} cycle(s) shown; filters from the navigator apply.</span>
        <button className="small" disabled={!project.selection.length} onClick={() => addToActive(project.selection)}>Add selected to graph</button>
        <button
          className="small"
          disabled={!redIds.length}
          title="Records a manual exclusion for every red cycle shown. Reversible."
          onClick={() =>
            update((p) => {
              const ec = { ...p.excludedCycles };
              const at = new Date().toISOString();
              for (const id of redIds) ec[id] = { reason: 'Bulk exclusion of red (QC) cycles after review', at };
              return { ...p, excludedCycles: ec };
            })
          }
        >
          Exclude {redIds.length} red cycle(s)
        </button>
      </div>
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th><span className="sr-only">Select</span></th>
              <H k="cond">Charge ratio</H>
              <th>Conc. (M)</th><th>Gel</th><th>Substrate</th><th>Hold (s)</th>
              <H k="file">File</H>
              <th>Repeat</th>
              <H k="cycle">Cycle</H>
              <H k="date">Test date/time</H>
              <H k="min">{`Min (${u})`}</H>
              <H k="max">{`Max (${u})`}</H>
              <th>{`|Peak| (${u})`}</th><th>{`Mean (${u})`}</th><th>{`SD (${u})`}</th>
              <H k="peak">{`Selected peak (${u})`}</H>
              <H k="score">Anomaly score</H>
              <H k="qc">QC</H>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cycle.cycleId} className={`${ui.focusId === r.cycle.cycleId ? 'focus' : ''} ${r.cycleExcluded ? 'excluded' : ''}`} onClick={() => setUi({ focusId: r.cycle.cycleId, rightTab: 'cycle' })}>
                <td onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={sel.has(r.cycle.cycleId)} onChange={(e) => toggle(r.cycle.cycleId, e.target.checked)} aria-label="Select" />
                </td>
                <td className="num">{r.meta.chargeRatio.value ?? '—'}</td>
                <td className={`num ${r.meta.concentrationM.source === 'default' ? 'default' : ''}`}>{r.meta.concentrationM.value}</td>
                <td>{r.meta.gel.value ?? '—'}</td>
                <td>{r.meta.substrate.value ?? '—'}</td>
                <td className="num">{r.holdTimeS ?? '—'}</td>
                <td>{r.file.name}</td>
                <td className="num">{r.meta.repeat.value}</td>
                <td className="num">{r.cycle.cycleNumber}</td>
                <td>{r.cycle.timestamp?.replace('T', ' ').slice(0, 19) ?? '—'}</td>
                <td className="num">{fmt(r.raw.min * f, u === 'N' ? 4 : 2)}</td>
                <td className="num">{fmt(r.raw.max * f, u === 'N' ? 4 : 2)}</td>
                <td className="num">{fmt(r.raw.absPeak * f, u === 'N' ? 4 : 2)}</td>
                <td className="num">{fmt(r.raw.mean * f, u === 'N' ? 4 : 2)}</td>
                <td className="num">{fmt(r.raw.sd * f, u === 'N' ? 4 : 2)}</td>
                <td className="num strong">{fmt(r.peakProcessed * f, u === 'N' ? 4 : 2)}</td>
                <td className="num">{fmt(r.cycleScore)}</td>
                <td><span className={`qc-pill ${r.qc}`}>{r.qc}</span></td>
                <td>{r.cycleExcluded ? 'Excluded' : 'Included'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const GROUP_KEYS: GroupKey[] = ['chargeRatio', 'concentrationM', 'gel', 'substrate', 'holdTimeS', 'amplitudeMm', 'velocityMmS'];

function StatsTab() {
  const { derived, project, update } = useApp();
  const [level, setLevel] = useState<'cycle' | 'run'>('run');
  const u = project.settings.forceUnit;
  const f = unitFactor(u);
  const keys = project.groupBy.includes('concentrationM') ? project.groupBy : [...project.groupBy, 'concentrationM' as GroupKey];
  const xKey = keys.find((k) => k === 'holdTimeS') ?? keys[0];
  const series = useMemo(() => {
    const m = new Map<string, { x: string[]; y: number[]; e: number[]; n: number[] }>();
    for (const g of derived.groups) {
      const name = keys.filter((k) => k !== xKey).map((k) => `${GROUP_LABEL[k]} ${g.label[k]}`).join(', ') || 'All';
      const s = m.get(name) ?? { x: [], y: [], e: [], n: [] };
      s.x.push(g.label[xKey]);
      s.y.push((level === 'run' ? g.runMean : g.mean) * f);
      s.e.push(((level === 'run' ? g.runSD : g.sd) || 0) * f);
      s.n.push(level === 'run' ? g.nRuns : g.nCycles);
      m.set(name, s);
    }
    return m;
  }, [derived.groups, keys, xKey, level, f]);
  const data: Data[] = [...series].map(([name, s]) => ({
    type: 'scatter',
    mode: 'lines+markers',
    name,
    x: s.x,
    y: s.y,
    error_y: { type: 'data', array: s.e, visible: true },
    text: s.n.map((n) => `n = ${n}`),
    hovertemplate: `${name}<br>${GROUP_LABEL[xKey]} %{x}<br>mean %{y:.3f} ± %{error_y.array:.3f} (SD)<br>%{text}<extra></extra>`,
  }));
  const layout: Partial<Layout> = {
    margin: { l: 60, r: 10, t: 10, b: 44 },
    font: { family: 'IBM Plex Sans, system-ui, sans-serif', size: 11 },
    xaxis: { title: { text: GROUP_LABEL[xKey] }, type: 'category' },
    yaxis: { title: { text: `Mean selected peak (${u})` }, zerolinecolor: '#C9D2DD' },
    legend: { orientation: 'h', y: -0.3 },
  };
  return (
    <div className="stats-tab">
      <div className="table-actions">
        <span>Group by:</span>
        <div className="chips">
          {GROUP_KEYS.map((k) => (
            <button
              key={k}
              className={`chip ${keys.includes(k) ? 'on' : ''}`}
              disabled={k === 'concentrationM'}
              title={k === 'concentrationM' ? 'Always included so different concentrations are never merged' : ''}
              onClick={() => update((p) => ({ ...p, groupBy: p.groupBy.includes(k) ? p.groupBy.filter((x) => x !== k) : [...p.groupBy, k] }))}
            >
              {GROUP_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      <p className="note">
        Cycle-level statistics treat each movement as one value. Cycles on the same specimen are not independent replicates. Run-level
        statistics first average each file (repeat run), then summarise across runs. Excluded cycles are omitted.
      </p>
      <div className="stats-split">
        <div className="table-scroll">
          <table className="grid">
            <thead>
              <tr>
                {keys.map((k) => <th key={k}>{GROUP_LABEL[k]}</th>)}
                <th>Cycles n</th><th>{`Cycle mean (${u})`}</th><th>{`Median (${u})`}</th><th>{`SD (${u})`}</th><th>CV</th>
                <th>Runs n</th><th>{`Run mean (${u})`}</th><th>{`Run SD (${u})`}</th><th>Run CV</th>
              </tr>
            </thead>
            <tbody>
              {derived.groups.map((g) => (
                <tr key={g.key}>
                  {keys.map((k) => <td key={k}>{g.label[k]}</td>)}
                  <td className="num">{g.nCycles}</td>
                  <td className="num">{fmt(g.mean * f, 3)}</td>
                  <td className="num">{fmt(g.median * f, 3)}</td>
                  <td className="num">{fmt(g.sd * f, 3)}</td>
                  <td className="num">{fmt(g.cv * 100, 1)}%</td>
                  <td className="num">{g.nRuns}</td>
                  <td className="num">{fmt(g.runMean * f, 3)}</td>
                  <td className="num" title={g.nRuns < 2 ? 'Only one run' : ''}>{fmt(g.runSD * f, 3)}</td>
                  <td className="num">{Number.isFinite(g.runCV) ? `${fmt(g.runCV * 100, 1)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="stats-chart">
          <div className="segmented small">
            <button className={level === 'run' ? 'on' : ''} onClick={() => setLevel('run')}>Between runs</button>
            <button className={level === 'cycle' ? 'on' : ''} onClick={() => setLevel('cycle')}>Between cycles</button>
          </div>
          {derived.groups.length > 0 && <PlotlyChart data={data} layout={layout} className="plot small" />}
          <p className="note">Error bars: ±1 SD {level === 'run' ? 'of run means' : 'of individual cycles'}.</p>
        </div>
      </div>
    </div>
  );
}

function DataTab() {
  const { derived, ui, setUi, project } = useApp();
  const r = ui.focusId ? derived.results.get(ui.focusId) : null;
  if (!r) return <p className="note">Select a cycle to see its recorded values point by point.</p>;
  const c = r.cycle;
  const n = c.force_gf.length;
  const LIMIT = 3000;
  const rows: number[] = [];
  for (let i = 0; i < n && rows.length < LIMIT; i++) {
    if (ui.dataView === 'flagged' && r.points.cls[i] === 0) continue;
    if (ui.dataView === 'processed' && (!r.include[i] || r.cycleExcluded)) continue;
    rows.push(i);
  }
  const extra = Object.keys(c.extra);
  const manual = project.excludedPoints[c.cycleId] ?? {};
  return (
    <div className="data-tab">
      <div className="table-actions">
        <strong>
          {r.file.path}, cycle {c.cycleNumber} ({groupValue(r, 'holdTimeS')} s hold)
        </strong>
        <div className="segmented small">
          {(['raw', 'flagged', 'processed'] as const).map((v) => (
            <button key={v} className={ui.dataView === v ? 'on' : ''} onClick={() => setUi({ dataView: v })}>
              {v === 'raw' ? 'Raw data (all points)' : v === 'flagged' ? 'Flagged points only' : 'Processed (retained points)'}
            </button>
          ))}
        </div>
        <span>{rows.length} of {n} points{rows.length === LIMIT ? ` (first ${LIMIT} shown; the Excel export contains all)` : ''}</span>
      </div>
      <div className="table-scroll">
        <table className="grid dense">
          <thead>
            <tr>
              <th>#</th><th>Time (s)</th><th>Position z (mm)</th><th>Fz (gf)</th>{extra.map((k) => <th key={k}>{k}</th>)}
              <th>Rolling median (gf)</th><th>Robust z</th><th>Score</th><th>Class</th><th>Processed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i} className={`qc-row-${QC_ORDER[r.points.cls[i]]}`}>
                <td className="num">{i}</td>
                <td className="num">{c.time_s[i]?.toFixed(3)}</td>
                <td className="num">{c.z_mm[i]?.toFixed(6)}</td>
                <td className="num">{c.force_gf[i]?.toFixed(6)}</td>
                {extra.map((k) => <td key={k} className="num">{c.extra[k][i]}</td>)}
                <td className="num">{r.points.localMedian[i].toFixed(3)}</td>
                <td className="num">{r.points.z[i].toFixed(2)}</td>
                <td className="num">{r.points.score[i].toFixed(3)}</td>
                <td><span className={`qc-dot ${QC_ORDER[r.points.cls[i]]}`} /> {QC_ORDER[r.points.cls[i]]}</td>
                <td>{r.include[i] ? 'kept' : manual[String(i)] ? 'excluded (manual)' : 'excluded (rule)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BottomPanel() {
  const { ui, setUi, files, derived } = useApp();
  const tabs = [
    { id: 'import', label: `Import status (${files.length})` },
    { id: 'cycles', label: `Cycle summary (${derived.ordered.length})` },
    { id: 'stats', label: `Statistics (${derived.groups.length} groups)` },
    { id: 'data', label: 'Point data' },
  ] as const;
  return (
    <section className={`bottom-panel ${ui.bottomOpen ? 'open' : 'closed'}`} aria-label="Results">
      <div className="panel-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={ui.bottomTab === t.id} className={ui.bottomTab === t.id ? 'tab active' : 'tab'} onClick={() => setUi({ bottomTab: t.id, bottomOpen: true })}>
            {t.label}
          </button>
        ))}
        <span className="spacer" />
        {ui.bottomTab === 'cycles' && <QcLegend />}
        <button className="link" onClick={() => setUi((u) => ({ bottomOpen: !u.bottomOpen }))} aria-expanded={ui.bottomOpen}>
          {ui.bottomOpen ? 'Hide results' : 'Show results'}
        </button>
      </div>
      {ui.bottomOpen && (
        <div className="panel-body">
          {ui.bottomTab === 'import' && <ImportStatus />}
          {ui.bottomTab === 'cycles' && <CycleTable />}
          {ui.bottomTab === 'stats' && <StatsTab />}
          {ui.bottomTab === 'data' && <DataTab />}
        </div>
      )}
    </section>
  );
}

function QcLegend() {
  return (
    <span className="qc-legend">
      <span className="qc-dot green" /> Normal <span className="qc-dot yellow" /> Potential outlier <span className="qc-dot orange" /> Strongly suspicious{' '}
      <span className="qc-dot red" /> Review
    </span>
  );
}

export { QcRibbon };
