import { useMemo, useState } from 'react';
import type { Data, Layout } from 'plotly.js';
import { useApp } from '../state/AppContext';
import { withRunInclusion } from '../state/inclusion';
import { STATUS_LABEL, computeGroups, groupValue, isIncluded, type CycleResult } from '../analysis/engine';
import { displayFactor, peakLabel, type Metrics } from '../analysis/cycleMetrics';
import { QC_LABEL, QC_ORDER } from '../analysis/pointOutliers';
import { axisLabel, axisValues } from '../plotting/axes';
import { PlotlyChart } from '../plotting/PlotlyChart';
import { GF_TO_N, type AnalysisSettings, type GroupKey, type MetaOverride } from '../types';
import { QcLegend, compareConditionKeys, fmt, forceDigits, meanSd, useSetRunChoice, type RunChoice } from './common';
import { useExperiment } from '../state/experiment';
import { metricsOf } from '../state/tackMetrics';
import { WorkMethods } from './AdhesionMethods';
import { mean, sampleSD } from '../analysis/stats';

/** Runs are listed per experimental condition: substrate × charge ratio × concentration × gel × holding time. */
export const CONDITION_KEYS: GroupKey[] = ['chargeRatio', 'concentrationM', 'substrate', 'gel', 'holdTimeS'];

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

/** "glass · CR 0.25 · 2.5 M · Gel A · 1 s dwell" */
function groupTitle(r: CycleResult): string {
  const m = r.meta;
  return [
    m.substrate.value ?? 'Substrate unknown',
    m.chargeRatio.value !== null ? `CR ${m.chargeRatio.value}` : 'Charge ratio unknown',
    `${m.concentrationM.value} M${m.concentrationM.source === 'default' ? ' (assumed)' : ''}`,
    m.gel.value,
    r.holdTimeS !== null ? `${r.holdTimeS} s dwell` : 'Dwell unknown',
  ].filter(Boolean).join(' · ');
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

/** "In average" checkbox: writes a manual override only when the choice differs from the automatic rule. */
function InAverage({ r }: { r: CycleResult }) {
  const { update } = useApp();
  // Shared with Tack metrics: the override is relative to the automatic rule and any whole-Repeat/session exclusion.
  const toggle = (want: boolean) => update((p) => withRunInclusion(p, r, want, want ? 'Kept after review (Data analysis)' : 'Left out after review (Data analysis)'));
  const reset = () => update((p) => {
    const runOverrides = { ...p.runOverrides };
    delete runOverrides[r.cycle.cycleId];
    return { ...p, runOverrides };
  });
  return (
    <span className="in-average" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={isIncluded(r)}
        onChange={(e) => toggle(e.target.checked)}
        aria-label={`Use run ${r.cycle.cycleNumber} of ${r.file.name} in the average`}
        title={r.override ? `Your choice: ${r.override.reason}.` : isIncluded(r) ? 'Included in the average (automatic)' : `${r.statusReason}. Tick to keep it anyway.`}
      />
      {r.override && <button className="link small" onClick={reset} aria-label={`Reset run ${r.cycle.cycleNumber} of ${r.file.name} to the automatic decision`} title="Back to the automatic decision">Reset</button>}
    </span>
  );
}

export function DataAnalysis() {
  const { derived, project, ui, setUi } = useApp();
  const ex = useExperiment();
  const [scope, setScope] = useState<'experiment' | 'graph'>('experiment');
  const u = project.settings.forceUnit;
  const f = displayFactor(project.settings);
  const fa = Math.abs(f); // spreads (SD) are never negative
  const d = forceDigits(u);
  const valueLabel = project.settings.peakMetric === 'min' && project.settings.forceSign !== 'positive' ? 'Peak (min) force' : peakLabel(project.settings);
  // The Z-score is computed on recorded forces; with inverted sign it is shown inverted too, so high = stronger adhesion.
  const zSign = project.settings.forceSign === 'positive' ? -1 : 1;
  const runs = scope === 'experiment' ? ex.experimentRuns : ex.graphRuns;

  const groups = useMemo(() => {
    const stats = new Map(computeGroups(runs, CONDITION_KEYS).map((g) => [g.key, g]));
    const map = new Map<string, CycleResult[]>();
    for (const r of runs) map.set(conditionKey(r), [...(map.get(conditionKey(r)) ?? []), r]);
    return [...map]
      .sort(([a], [b]) => compareConditionKeys(a, b))
      .map(([key, list]) => ({ key, hold: list[0].holdTimeS, runs: [...list].sort(byRepeatAndRun), stats: stats.get(key) ?? null }));
  }, [runs]);

  const diameter = project.settings.probe.diameterMm;
  const thickness = project.tackMetrics.h0;
  const work = useMemo(() => new Map(runs.map((r) => [
    r.cycle.cycleId, metricsOf(r.cycle, diameter, thickness[r.file.fileId] ?? null, true),
  ])), [runs, diameter, thickness]);

  const focus = ui.focusId ? derived.results.get(ui.focusId) ?? null : null;
  const excl = project.settings.runExclusion.excludeClasses;
  const nOutliers = runs.filter((r) => r.qc !== 'green').length;
  const dupNames = useMemo(() => new Set(runs.map((r) => r.file).filter((file, _i, all) => all.findIndex((x) => x.name === file.name && x.fileId !== file.fileId) >= 0).map((file) => file.name)), [runs]);

  if (!ex.hasData) return <p className="note pad">No data yet. Open a folder in step 1 on the left, then choose an experiment in step 2.</p>;
  if (!ex.main) return <p className="note pad">No files match the chosen experiment. Set one of the dropdowns in step 2 back to <em>All</em>.</p>;

  return (
    <div className={`analysis-layout ${focus ? 'with-detail' : ''}`}>
      <div className="analysis-main">
        <div className="analysis-intro">
          <div className="table-actions">
            <h3 className="exp-title">{ex.title}</h3>
            <div className="segmented small" role="group" aria-label="Which runs">
              <button className={scope === 'experiment' ? 'on' : ''} aria-pressed={scope === 'experiment'} onClick={() => setScope('experiment')}>Chosen experiment ({ex.experimentRuns.length} runs)</button>
              <button className={scope === 'graph' ? 'on' : ''} aria-pressed={scope === 'graph'} onClick={() => setScope('graph')}>Runs on the graph ({ex.graphRuns.length})</button>
            </div>
          </div>
          <p className="note">
            One summary per condition (substrate × charge ratio × concentration × gel × dwell time); repeat files of the same condition, such as
            1s.txt and 1s-v2.txt, are combined. Each run (one pull inside a TXT file) is one value. Its <strong>modified Z-score</strong> (based on the median)
            shows how far its peak adhesion force lies from the other runs of the condition; |Z| ≥ {project.settings.cycle.modZOrange} is suspicious.
            With fewer than {project.settings.cycle.minGroupSize} valid runs a condition is <em>not scored</em>.
            Runs are also checked for no negative force, no peak, weak response, probe start position and incomplete movement.{' '}
            {nOutliers ? `${nOutliers} run(s) are highlighted. ` : 'No runs are highlighted. '}
            {excl.length ? `${excl.join(' and ').replace(/^./, (c) => c.toUpperCase())} runs are left out of the average without outliers.` : 'No runs are left out automatically.'}{' '}
            Untick or tick <em>In average</em> to decide yourself; <em>Reset</em> returns a run to the automatic decision. Click a row for its curve and details.
          </p>
          <p className="note">W<sub>adh</sub> is tensile work. An asterisk marks a pull that ended before detachment was detected.</p>
          <QcLegend />
        </div>
        <WorkMethods mode="tack" />
        {groups.map((g) => {
          const raw = g.stats?.raw;
          const pr = g.stats?.processed;
          const workStats = (list: CycleResult[], metric: 'workMJ' | 'wJm2') => {
            const values = list.map((r) => work.get(r.cycle.cycleId)?.[metric] ?? NaN);
            return meanSd(mean(values), sampleSD(values), values.filter(Number.isFinite).length, 3);
          };
          const included = g.runs.filter(isIncluded);
          const sources = [...new Set(g.runs.map((r) => r.file.fileId))].map((id) => g.runs.find((r) => r.file.fileId === id)!.file);
          // Peak force in both units (1 gf = 0.00980665 N); the unit set in Settings comes first.
          const other = u === 'gf' ? 'N' : 'gf';
          const k = u === 'gf' ? GF_TO_N : 1 / GF_TO_N;
          const peak = (st: typeof raw, scale: number, digits: number) => meanSd((st?.mean ?? NaN) * f * scale, (st?.sd ?? NaN) * fa * scale, st?.n ?? 0, digits);
          return (
            <section key={g.key} className="run-group">
              <header className="run-group-head">
                <h3>{groupTitle(g.runs[0])}</h3>
                <span>{sources.length} file{sources.length === 1 ? '' : 's'} · {g.runs.length} run{g.runs.length === 1 ? '' : 's'}</span>
              </header>
              <table className="grid group-summary">
                <thead><tr><th>Mean ± sample SD (n)</th><th className="num">{valueLabel} ({u})</th><th className="num">{valueLabel} ({other})</th><th className="num">W<sub>adh</sub> (mJ)</th>{diameter > 0 && <th className="num">W<sub>adh</sub>/A (J/m²)</th>}</tr></thead>
                <tbody>
                  <tr><th>All valid runs</th><td className="num">{peak(raw, 1, d)}</td><td className="num">{peak(raw, k, forceDigits(other))}</td><td className="num">{workStats(g.runs, 'workMJ')}</td>{diameter > 0 && <td className="num">{workStats(g.runs, 'wJm2')}</td>}</tr>
                  <tr><th>Included runs after review</th><td className="num strong">{peak(pr, 1, d)}</td><td className="num strong">{peak(pr, k, forceDigits(other))}</td><td className="num strong">{workStats(included, 'workMJ')}</td>{diameter > 0 && <td className="num strong">{workStats(included, 'wJm2')}</td>}</tr>
                </tbody>
              </table>
              <p className="note sources">Source files: {sources.map((file) => <span key={file.fileId} title={file.path} className="source-file">{file.name}</span>)}</p>
              <table className="grid run-table">
                <thead>
                  <tr>
                    <th>File</th><th>Run</th><th className="num">{`${valueLabel} (${u})`}</th><th className="num">W<sub>adh</sub> (mJ)</th>{diameter > 0 && <th className="num">W<sub>adh</sub>/A (J/m²)</th>}<th className="num" title="Modified Z-score within the same condition; needs at least 4 valid runs">Modified Z</th><th>Flag</th><th>Why</th><th title="Included in the condition average after review">In average</th>
                  </tr>
                </thead>
                <tbody>
                  {g.runs.map((r) => {
                    const msgs = flagMessages(r);
                    const w = work.get(r.cycle.cycleId);
                    return (
                      <tr
                        key={r.cycle.cycleId}
                        className={`hl-${r.qc} ${isIncluded(r) ? '' : 'excluded'} ${ui.focusId === r.cycle.cycleId ? 'focus' : ''}`}
                        onClick={() => setUi({ focusId: r.cycle.cycleId })}
                      >
                        <td title={r.file.path}>{r.file.name}{dupNames.has(r.file.name) && <div className="cond">{r.file.path.split('/').slice(-3, -1).join('/')}</div>}</td>
                        <td className="num">{r.cycle.cycleNumber}</td>
                        <td className="num value">{fmt(r.peakRaw * f, d)}</td>
                        <td className="num" title={w?.error ?? undefined}>{fmt(w?.workMJ, 3)}{w?.incomplete && ' *'}</td>
                        {diameter > 0 && <td className="num">{fmt(w?.wJm2, 3)}{w?.incomplete && ' *'}</td>}
                        <td className={`num z ${r.modZ !== null && Math.abs(r.modZ) >= project.settings.cycle.modZOrange ? 'big' : ''}`} title={r.modZ === null ? 'Fewer than the minimum number of runs in this condition' : ''}>
                          {r.modZ === null ? '—' : Math.abs(r.modZ) >= 99 ? (r.modZ * zSign > 0 ? '≫' : '≪') : (r.modZ * zSign).toFixed(2)}
                        </td>
                        <td>{r.modZ === null && r.qc === 'green' ? <span className="muted" title="Too few valid runs in this condition for a modified Z-score">Not scored</span> : <span className={`qc-pill ${r.qc}`} title={QC_LABEL[r.qc]}>{r.qc === 'green' ? 'ok' : QC_LABEL[r.qc].split(' —')[0].toLowerCase()}</span>}</td>
                        <td className="reason" title={msgs.join('\n')}><div className="clamp">{shorten(msgs, 90) || <span className="muted">—</span>}</div></td>
                        <td className="center"><InAverage r={r} /></td>
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

function MetricsTable({ raw, proc, s }: { raw: Metrics; proc: Metrics; s: AnalysisSettings }) {
  const u = s.forceUnit;
  const f = displayFactor(s);
  const fa = Math.abs(f);
  const pos = s.forceSign === 'positive';
  const rows: [string, number | null, number | null, number?][] = [
    [pos ? `Peak adhesion force (${u})` : `Minimum (${u})`, raw.min * f, proc.min * f],
    [`Peak magnitude (${u})`, raw.absPeak * fa, proc.absPeak * fa],
    [`Mean (${u})`, raw.mean * f, proc.mean * f],
    [`SD (${u})`, raw.sd * fa, proc.sd * fa],
    ['Points', raw.n, proc.n, 0],
    [pos ? 'Time at peak (s)' : 'Time at min (s)', raw.tAtMin, proc.tAtMin],
    [pos ? 'Z at peak (mm)' : 'Z at min (mm)', raw.zAtMin, proc.zAtMin, 4],
    [pos ? 'Displacement at peak (mm)' : 'Displacement at min (mm)', raw.dispAtMin, proc.dispAtMin, 4],
    [`Baseline (${u})`, raw.baseline === null ? null : raw.baseline * f, proc.baseline === null ? null : proc.baseline * f],
    [pos ? `Baseline-corrected peak (${u})` : `Baseline-corrected min (${u})`, raw.baselineMin === null ? null : raw.baselineMin * f, proc.baselineMin === null ? null : proc.baselineMin * f],
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
    // The adhesion peak is the minimum of the recorded force, whatever sign is displayed.
    const fz = r.cycle.force_gf;
    let iMin = -1;
    for (let i = 0; i < fz.length; i++) if (r.include[i] && (iMin < 0 || fz[i] < fz[iMin])) iMin = i;
    const traces: Data[] = [
      { type: 'scatter', mode: 'lines', x: Array.from(xs), y: Array.from(ys, (v, i) => (r.include[i] ? v : null)), connectgaps: false, line: { color, width: 1.6, dash: isIncluded(r) ? 'solid' : 'dash' }, hovertemplate: 'x = %{x:.4f}<br>y = %{y:.4f}<extra></extra>' } as unknown as Data,
    ];
    if (iMin >= 0) {
      traces.push({ type: 'scatter', mode: 'markers', x: [xs[iMin]], y: [ys[iMin]], marker: { symbol: s.forceSign === 'positive' ? 'triangle-up' : 'triangle-down', size: 11, color, line: { color: '#18263A', width: 1 } }, hovertemplate: `${peakLabel(s)} %{y:.4f}<extra></extra>` } as unknown as Data);
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

/** Corrections of the metadata read from folder and file names (this file or its whole folder); shared by all tests. */
export function MetadataEditor({ r }: { r: { file: { fileId: string; path: string } } }) {
  const { project, update, files, meta } = useApp();
  const [scope, setScope] = useState<'file' | 'folder'>('file');
  const m = meta.get(r.file.fileId);
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
  if (!m) return null;
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
              <th>#</th><th>Time (s)</th><th>z (mm)</th><th title="Exactly as in the TXT file (adhesion negative)">Fz as recorded (gf)</th><th>Rolling median</th><th>Score</th><th>Point flag</th><th>Exclude</th>
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
        {fmt(r.peakProcessed * displayFactor(s), u === 'N' ? 5 : 2)} <span>{u}</span> <small>{peakLabel(s)}</small>
        {r.peakProcessed !== r.peakRaw && Number.isFinite(r.peakRaw) && <small> all points {fmt(r.peakRaw * displayFactor(s), 2)}</small>}
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
        <MetricsTable raw={r.raw} proc={r.processed} s={s} />
        <p className="note">{r.baselineNote}</p>
      </details>
      <details className="section">
        <summary>Point data</summary>
        <PointTable r={r} />
      </details>
    </aside>
  );
}
