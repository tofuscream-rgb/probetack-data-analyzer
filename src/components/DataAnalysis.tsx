import { useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { useApp } from '../state/AppContext';
import { STATUS_LABEL, computeGroups, groupValue, isIncluded, type CycleResult } from '../analysis/engine';
import { PEAK_LABEL, unitFactor, type Metrics } from '../analysis/cycleMetrics';
import { QC_LABEL, QC_ORDER } from '../analysis/pointOutliers';
import { axisLabel, axisValues } from '../plotting/axes';
import { PlotlyChart } from '../plotting/PlotlyChart';
import type { ForceUnit, GroupKey, MetaOverride } from '../types';
import { QcLegend, compareConditionKeys, fmt, forceDigits, meanSd, useSetRunChoice, type RunChoice } from './common';

/** Runs are listed per experimental condition. Concentration is always part of the key. */
export const CONDITION_KEYS: GroupKey[] = ['chargeRatio', 'concentrationM', 'substrate', 'holdTimeS'];

const conditionKey = (r: CycleResult) => CONDITION_KEYS.map((k) => groupValue(r, k)).join(' | ');

export function conditionTitle(r: CycleResult, withHold = true): string {
  const m = r.meta;
  const parts = [
    m.chargeRatio.value !== null ? `Charge ratio ${m.chargeRatio.value}` : 'Charge ratio unknown',
    `${m.concentrationM.value} M${m.concentrationM.source === 'default' ? '*' : ''}`,
    m.substrate.value ?? 'substrate unknown',
  ];
  if (withHold) parts.push(r.holdTimeS !== null ? `${r.holdTimeS} s hold` : 'hold unknown');
  return parts.join(', ');
}

const byRepeatAndRun = (a: CycleResult, b: CycleResult) =>
  (a.meta.repeat.value ?? 0) - (b.meta.repeat.value ?? 0) || a.file.path.localeCompare(b.file.path) || a.cycle.cycleNumber - b.cycle.cycleNumber;

const flagMessages = (r: CycleResult) => r.flags.filter((f) => f.cls !== 'green').map((f) => f.message);

function shorten(messages: string[], max = 64): string {
  if (!messages.length) return '';
  const first = messages[0].length > max ? `${messages[0].slice(0, max - 1).trimEnd()}…` : messages[0];
  return messages.length > 1 ? `${first} (+${messages.length - 1})` : first;
}

function RunChoiceSelect({ r }: { r: CycleResult }) {
  const setChoice = useSetRunChoice();
  const value: RunChoice = r.override?.action ?? 'auto';
  return (
    <select
      className="run-choice"
      value={value}
      aria-label={`Decision for run ${r.cycle.cycleNumber}`}
      title={r.override ? `${r.override.action === 'include' ? 'Kept' : 'Excluded'} manually: ${r.override.reason}` : 'Follows the automatic rule in Settings'}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setChoice(r.cycle.cycleId, e.target.value as RunChoice)}
    >
      <option value="auto">Automatic</option>
      <option value="include">Keep anyway</option>
      <option value="exclude">Exclude anyway</option>
    </select>
  );
}

export function DataAnalysis() {
  const { visible, derived, project, ui, setUi } = useApp();
  const u = project.settings.forceUnit;
  const f = unitFactor(u);
  const d = forceDigits(u);
  const valueLabel = project.settings.peakMetric === 'min' ? 'Minimum force' : PEAK_LABEL[project.settings.peakMetric];

  const groups = useMemo(() => {
    const stats = new Map(computeGroups(visible, CONDITION_KEYS).map((g) => [g.key, g]));
    const map = new Map<string, CycleResult[]>();
    for (const r of visible) map.set(conditionKey(r), [...(map.get(conditionKey(r)) ?? []), r]);
    return [...map]
      .sort(([a], [b]) => compareConditionKeys(a, b))
      .map(([key, runs]) => ({ key, title: conditionTitle(runs[0]), runs: [...runs].sort(byRepeatAndRun), stats: stats.get(key) ?? null }));
  }, [visible]);

  const focus = ui.focusId ? derived.results.get(ui.focusId) ?? null : null;
  const excl = project.settings.runExclusion.excludeClasses;

  if (!derived.ordered.length) return <p className="note pad">Import files with the navigator on the left to analyse their runs.</p>;

  return (
    <div className={`analysis-layout ${focus ? 'with-detail' : ''}`}>
      <div className="analysis-main">
        <div className="analysis-intro">
          <QcLegend />
          <p className="note">
            How runs are compared: each run’s peak is compared with runs of the same condition (modified Z-score), plus checks for no negative force,
            no peak, weak response, probe start position and incomplete movement.{' '}
            {excl.length ? `${excl.join(' and ').replace(/^./, (c) => c.toUpperCase())} runs are excluded automatically` : 'No runs are excluded automatically'} (change in
            Settings); Keep anyway / Exclude anyway always win.
          </p>
        </div>
        {groups.length === 0 && <p className="note">No runs match the current filters.</p>}
        {groups.map((g) => {
          const st = g.stats?.processed;
          return (
            <section key={g.key} className="run-group">
              <header className="run-group-head">
                <h3>{g.title}</h3>
                <span className="group-stat" title="Processed: included and manually kept runs only">
                  Processed {meanSd((st?.mean ?? NaN) * f, (st?.sd ?? NaN) * f, st?.n ?? 0, d)} {u}
                </span>
              </header>
              <table className="grid run-table">
                <thead>
                  <tr>
                    <th>Repeat</th><th>Run</th><th className="num">{`${valueLabel} (${u})`}</th><th>Flag</th><th>Reason</th><th>Status</th><th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {g.runs.map((r) => {
                    const msgs = flagMessages(r);
                    return (
                      <tr
                        key={r.cycle.cycleId}
                        className={`${isIncluded(r) ? '' : 'excluded'} ${ui.focusId === r.cycle.cycleId ? 'focus' : ''}`}
                        onClick={() => setUi({ focusId: r.cycle.cycleId })}
                      >
                        <td className="num" title={r.file.path}>{r.meta.repeat.value ?? '—'}</td>
                        <td className="num">{r.cycle.cycleNumber}</td>
                        <td className="num value">{fmt(r.peakRaw * f, d)}</td>
                        <td><span className={`qc-pill ${r.qc}`} title={QC_LABEL[r.qc]}>{r.qc}</span></td>
                        <td className="reason" title={msgs.join('\n')}><div className="clamp">{shorten(msgs, 90) || <span className="muted">—</span>}</div></td>
                        <td title={r.statusReason}>{STATUS_LABEL[r.status]}</td>
                        <td><RunChoiceSelect r={r} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
      {focus && <RunDetail r={focus} onClose={() => setUi({ focusId: null })} />}
    </div>
  );
}

function MetricsTable({ raw, proc, u }: { raw: Metrics; proc: Metrics; u: ForceUnit }) {
  const f = unitFactor(u);
  const rows: [string, number | null, number | null, number?][] = [
    [`Minimum (${u})`, raw.min * f, proc.min * f],
    [`Peak magnitude (${u})`, raw.absPeak * f, proc.absPeak * f],
    [`Mean (${u})`, raw.mean * f, proc.mean * f],
    [`SD (${u})`, raw.sd * f, proc.sd * f],
    ['Points', raw.n, proc.n, 0],
    ['Time at min (s)', raw.tAtMin, proc.tAtMin],
    ['Z at min (mm)', raw.zAtMin, proc.zAtMin, 4],
    ['Displacement at min (mm)', raw.dispAtMin, proc.dispAtMin, 4],
    [`Baseline (${u})`, raw.baseline === null ? null : raw.baseline * f, proc.baseline === null ? null : proc.baseline * f],
    [`Baseline-corrected min (${u})`, raw.baselineMin === null ? null : raw.baselineMin * f, proc.baselineMin === null ? null : proc.baselineMin * f],
  ];
  return (
    <table className="metrics">
      <thead>
        <tr><th /><th>All points</th><th>Retained points</th></tr>
      </thead>
      <tbody>
        {rows.map(([l, a, b, dd]) => (
          <tr key={l} className={a !== b && Number.isFinite(a) ? 'diff' : ''}>
            <th>{l}</th>
            <td>{fmt(a, dd ?? (u === 'N' ? 5 : 3))}</td>
            <td>{fmt(b, dd ?? (u === 'N' ? 5 : 3))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RunCurve({ r }: { r: CycleResult }) {
  const { project } = useApp();
  const s = project.settings;
  const { data, layout } = useMemo(() => {
    const xs = axisValues(r, 'disp_mm', s) ?? r.cycle.time_s;
    const xId = axisValues(r, 'disp_mm', s) ? 'disp_mm' : 'time_s';
    const ys = axisValues(r, 'force', s)!;
    const color = isIncluded(r) ? '#1F4E9C' : '#9AA6B5';
    let iMin = -1;
    for (let i = 0; i < ys.length; i++) if (r.include[i] && (iMin < 0 || ys[i] < ys[iMin])) iMin = i;
    const traces: Data[] = [
      { type: 'scatter', mode: 'lines', x: Array.from(xs), y: Array.from(ys, (v, i) => (r.include[i] ? v : null)), connectgaps: false, line: { color, width: 1.6, dash: isIncluded(r) ? 'solid' : 'dash' }, hovertemplate: 'x = %{x:.4f}<br>y = %{y:.4f}<extra></extra>' } as unknown as Data,
    ];
    if (iMin >= 0) {
      traces.push({ type: 'scatter', mode: 'markers', x: [xs[iMin]], y: [ys[iMin]], marker: { symbol: 'triangle-down', size: 11, color, line: { color: '#18263A', width: 1 } }, hovertemplate: 'Minimum force %{y:.4f}<extra></extra>' } as unknown as Data);
    }
    const lay: Partial<Layout> = {
      margin: { l: 56, r: 8, t: 8, b: 40 },
      font: { family: 'IBM Plex Sans, system-ui, sans-serif', size: 11, color: '#18263A' },
      showlegend: false,
      xaxis: { title: { text: axisLabel(xId, s) }, zerolinecolor: '#C9D2DD', gridcolor: '#EEF2F6' },
      yaxis: { title: { text: axisLabel('force', s) }, zerolinecolor: '#C9D2DD', gridcolor: '#EEF2F6' },
      hovermode: 'closest',
    };
    return { data: traces, layout: lay };
  }, [r, s]);
  return <PlotlyChart data={data} layout={layout} className="plot detail" config={{ displayModeBar: false }} />;
}

function MetadataEditor({ r }: { r: CycleResult }) {
  const { project, update, files, meta } = useApp();
  const [scope, setScope] = useState<'file' | 'folder'>('file');
  const m = meta.get(r.file.fileId)!;
  const folder = r.file.path.split('/').slice(0, -1).join('/');
  const targets = scope === 'file' ? [r.file.fileId] : files.filter((l) => l.parsed.path.split('/').slice(0, -1).join('/') === folder).map((l) => l.parsed.fileId);
  const setField = (k: keyof MetaOverride, v: string, numeric: boolean) => {
    const value = v.trim() === '' ? undefined : numeric ? Number(v) : v.trim();
    if (numeric && value !== undefined && !Number.isFinite(value as number)) return;
    update((p) => {
      const ov = { ...p.overrides };
      for (const id of targets) {
        const cur = { ...(ov[id] ?? {}) };
        if (value === undefined) delete cur[k];
        else (cur as Record<string, unknown>)[k] = value;
        if (Object.keys(cur).length) ov[id] = cur;
        else delete ov[id];
      }
      return { ...p, overrides: ov };
    });
  };
  const rows: [keyof MetaOverride, string, boolean][] = [
    ['chargeRatio', 'Charge ratio', true],
    ['concentrationM', 'Total monomer concentration (M)', true],
    ['substrate', 'Substrate', false],
    ['nominalHoldS', 'Nominal holding time (s)', true],
    ['repeat', 'Repeat number', true],
  ];
  const ov = project.overrides[r.file.fileId] ?? {};
  return (
    <div className="metadata-editor">
      <div className="segmented small">
        <button className={scope === 'file' ? 'on' : ''} onClick={() => setScope('file')}>This file</button>
        <button className={scope === 'folder' ? 'on' : ''} onClick={() => setScope('folder')}>All {targets.length} file(s) in “{folder || '(top level)'}”</button>
      </div>
      <div className="pair">
        {rows.map(([k, label, numeric]) => {
          const fld = m[k] as { value: unknown; source: string };
          return (
            <label key={`${r.file.fileId}-${k}-${scope}`} className="field">
              <span>
                {label} <small className={fld.source === 'default' ? 'warn' : ''}>{fld.source}</small>
              </span>
              <input
                defaultValue={ov[k] !== undefined ? String(ov[k]) : ''}
                placeholder={fld.value === null ? 'unknown' : String(fld.value)}
                onBlur={(e) => setField(k, e.target.value, numeric)}
                inputMode={numeric ? 'decimal' : 'text'}
              />
            </label>
          );
        })}
      </div>
      <p className="note">Leave a field empty to use the value read from the folder or file name (shown in grey). Corrections are saved with the project and listed in exports.</p>
      {m.notes.map((n, i) => <p key={i} className="note warn">{n}</p>)}
    </div>
  );
}

function PointTable({ r }: { r: CycleResult }) {
  const { project, update } = useApp();
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const c = r.cycle;
  const id = c.cycleId;
  const manual = project.excludedPoints[id] ?? {};
  const n = c.force_gf.length;
  const LIMIT = 3000;
  const rows: number[] = [];
  for (let i = 0; i < n && rows.length < LIMIT; i++) {
    if (onlyFlagged && r.points.cls[i] === 0 && !manual[String(i)]) continue;
    rows.push(i);
  }
  const togglePoint = (i: number) =>
    update((p) => {
      const cur = { ...(p.excludedPoints[id] ?? {}) };
      if (cur[String(i)]) delete cur[String(i)];
      else cur[String(i)] = { reason: `Manual review (${QC_ORDER[r.points.cls[i]]} point flag)`, at: new Date().toISOString() };
      const ep = { ...p.excludedPoints, [id]: cur };
      if (Object.keys(cur).length === 0) delete ep[id];
      return { ...p, excludedPoints: ep };
    });
  return (
    <>
      <div className="table-actions">
        <label className="check-row">
          <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Only flagged points ({r.points.counts[1] + r.points.counts[2] + r.points.counts[3]})
        </label>
        <span>{rows.length} of {n} points{rows.length === LIMIT ? ` (first ${LIMIT}; the Excel export contains all)` : ''}</span>
      </div>
      <div className="table-scroll point-scroll">
        <table className="grid dense">
          <thead>
            <tr>
              <th>#</th><th>Time (s)</th><th>z (mm)</th><th>Fz (gf)</th><th>Rolling median</th><th>Score</th><th>Point flag</th><th>Exclude</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i} className={`qc-row-${QC_ORDER[r.points.cls[i]]}`}>
                <td className="num">{i}</td>
                <td className="num">{c.time_s[i]?.toFixed(3)}</td>
                <td className="num">{c.z_mm[i]?.toFixed(5)}</td>
                <td className="num">{c.force_gf[i]?.toFixed(3)}</td>
                <td className="num">{r.points.localMedian[i].toFixed(3)}</td>
                <td className="num">{r.points.score[i].toFixed(3)}</td>
                <td>{r.points.cls[i] ? <><span className={`qc-dot ${QC_ORDER[r.points.cls[i]]}`} /> {QC_ORDER[r.points.cls[i]]}</> : ''}</td>
                <td>
                  <input type="checkbox" checked={!!manual[String(i)]} onChange={() => togglePoint(i)} aria-label={`Exclude point ${i}`} title={r.include[i] ? '' : manual[String(i)] ? 'Excluded by hand' : 'Excluded by the point rule (Settings → Advanced)'} />
                  {!r.include[i] && !manual[String(i)] && <small> rule</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Level A floor (force resolution) used: {fmt(r.points.floorUsed, 4)} gf.</p>
    </>
  );
}

function RunDetail({ r, onClose }: { r: CycleResult; onClose: () => void }) {
  const { project } = useApp();
  const s = project.settings;
  const u = s.forceUnit;
  const m = r.meta;
  const h = r.file.header;
  return (
    <aside className="run-detail" aria-label="Run details">
      <div className="detail-head">
        <h3 className="cycle-title">
          {r.file.name} <span>Repeat {m.repeat.value}, Run {r.cycle.cycleNumber}</span> <span className={`qc-pill ${r.qc}`}>{QC_LABEL[r.qc]}</span>
        </h3>
        <button className="icon" onClick={onClose} aria-label="Close details">×</button>
      </div>
      <p className="path">{r.file.path} · {conditionTitle(r)}</p>
      <div className="detail-status">
        <span className={`status-label ${isIncluded(r) ? 'in' : 'out'}`}>{STATUS_LABEL[r.status]}</span>
        <RunChoiceSelect r={r} />
        <p className="note">{r.statusReason}</p>
      </div>
      <p className="big-number">
        {fmt(r.peakProcessed * unitFactor(u), u === 'N' ? 5 : 2)} <span>{u}</span> <small>{PEAK_LABEL[s.peakMetric]}</small>
        {r.peakProcessed !== r.peakRaw && Number.isFinite(r.peakRaw) && <small> all points {fmt(r.peakRaw * unitFactor(u), 2)}</small>}
      </p>
      <RunCurve r={r} />

      <h4>Flags and notes</h4>
      {r.flags.length === 0 && <p className="note ok">No issues found for this run.</p>}
      <ul className="flags">
        {r.flags.map((fl, i) => (
          <li key={i} className={fl.cls}>
            <span className={`qc-dot ${fl.cls}`} /> {fl.cls === 'green' ? <em>Note: </em> : null}{fl.message}
          </li>
        ))}
      </ul>

      <h4>Metadata</h4>
      <dl className="meta-grid">
        <dt>Charge ratio</dt><dd>{m.chargeRatio.value ?? '—'} <small>{m.chargeRatio.source}</small></dd>
        <dt>Concentration</dt><dd>{m.concentrationM.value} M <small className={m.concentrationM.source === 'default' ? 'warn' : ''}>{m.concentrationM.source}</small></dd>
        <dt>Substrate</dt><dd>{m.substrate.value ?? '—'} <small>{m.substrate.source}</small></dd>
        <dt>Holding time</dt><dd>{r.holdTimeS ?? '—'} s <small>{r.cycle.holdTimeS !== null ? 'from Wait block' : 'from file name'}</small></dd>
        <dt>Repeat</dt><dd>{m.repeat.value}</dd>
        <dt>Movement</dt><dd>{r.cycle.operation}, {r.cycle.amplitudeMm ?? '—'} mm at {r.cycle.velocityMmS ?? '—'} mm/s</dd>
        <dt>Recorded</dt><dd>{r.cycle.date}, {r.cycle.time}</dd>
        <dt>Load cell</dt><dd>{h['Load Cell Name'] ?? '—'}, calibration factor {h['Load Cell Calibration Factor'] ?? '—'}</dd>
        <dt>Instrument filter</dt><dd>{h['Load Cell Low-pass filter'] === 'Yes' ? `Low-pass, order ${h['Load Cell Low-pass filter Order']}, ${h['Load Cell Low-pass filter Cutoff frequency (Hz)']} Hz` : h['Load Cell Low-pass filter'] ?? '—'}</dd>
      </dl>
      {m.concentrationM.source === 'default' && <p className="note warn">Concentration is the default 2.1 M. If this dataset differs (for example 2.5 M), correct it below.</p>}
      <details className="section" open={m.concentrationM.source === 'default'}>
        <summary>Correct metadata</summary>
        <MetadataEditor r={r} />
      </details>
      <details className="section">
        <summary>Measured values</summary>
        <MetricsTable raw={r.raw} proc={r.processed} u={u} />
        <p className="note">{r.baselineNote}</p>
      </details>
      <details className="section">
        <summary>Point data</summary>
        <PointTable r={r} />
      </details>
    </aside>
  );
}
