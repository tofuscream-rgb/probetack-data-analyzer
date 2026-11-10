import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Data, Layout, PlotlyHTMLElement } from 'plotly.js';
import { useApp, download } from '../../state/AppContext';
import {
  DIAG_METRICS, FAILURE_MODES, MAIN_METRICS, failureModeCounts, failureModeLabel, tackFlags, usedRuns, useTackMetrics,
  type Metric, type TackRepeat,
} from '../../state/tackMetrics';
import { TACK_DEFAULTS } from '../../analysis/tackMetrics';
import { PlotlyChart, loadPlotly } from '../../plotting/PlotlyChart';
import { EXPORT_SIZE, LINE, figAxis, figLayout } from '../../plotting/figureStyle';
import { CURVE_COLORS } from '../../plotting/colors';
import { NumberField } from '../lapShear/NumberField';
import { fmt } from '../common';
import { TackMethods } from './TackMethods';
import type { TackFailureMode } from '../../types';

const SUBSTRATES = ['PET', 'stainless steel', 'glass'];

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const saveCsv = (rows: unknown[][], name: string) => download(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), name);
const ms = (s: { mean: number; sd: number; n: number } | undefined, d: number) => (s && s.n ? `${fmt(s.mean, d)} ± ${s.n > 1 ? fmt(s.sd, d) : '—'}` : '—');

/** Table header of a metric: name with subscripts, unit below. */
function MetricTh({ k }: { k: Metric }) {
  return (
    <th className="num">
      <span dangerouslySetInnerHTML={{ __html: k.html }} /> <small>({k.unit})</small>
    </th>
  );
}

function Section({ n, title, children, extra }: { n: number; title: string; children: ReactNode; extra?: ReactNode }) {
  return (
    <section className="tack-section">
      <div className="tack-section-head">
        <h3 className="ls-h">{n}. {title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

/** Short flag; the details show on hover and when clicked. */
function Flags({ m }: { m: Parameters<typeof tackFlags>[0] }) {
  const flags = tackFlags(m);
  if (!flags.length) return null;
  return (
    <span className="flags">
      {flags.map((f) => (
        <details key={f.key} className={`flag flag-${f.key}`}>
          <summary title={f.detail}>{f.label}</summary>
          <span className="flag-detail">{f.detail}</span>
        </details>
      ))}
    </span>
  );
}

type PlotMode = 'force' | 'stress';

/** F vs δ (or σ vs ε) of the runs of one Repeat, with F_max, δ_break and plateau. */
function TackPlot({ repeat, mode }: { repeat: TackRepeat; mode: PlotMode }) {
  const plotEl = useRef<PlotlyHTMLElement | null>(null);
  const stress = mode === 'stress' && repeat.h0 !== null;
  const { data, layout } = useMemo(() => {
    const traces: Data[] = [];
    repeat.runs.forEach((r, k) => {
      const m = r.m;
      if (!m.ok) return;
      const fy = stress ? 1000 / m.areaMm2 : 1; // N → kPa
      const fx = stress ? 1 / repeat.h0! : 1; // mm → strain
      const color = CURVE_COLORS[k % CURVE_COLORS.length];
      const name = `Run ${r.cycle.cycleNumber}${r.excluded ? ' (excluded)' : ''}`;
      const step = Math.max(1, Math.floor(m.curve.deltaMm.length / 3000));
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < m.curve.deltaMm.length; i += step) { xs.push(m.curve.deltaMm[i] * fx); ys.push(m.curve.tN[i] * fy); }
      const xl = stress ? 'ε' : 'δ';
      const yl = stress ? 'σ' : 'F';
      const yu = stress ? 'kPa' : 'N';
      const xu = stress ? '' : ' mm';
      traces.push({ type: 'scatter', mode: 'lines', x: xs, y: ys, name, legendgroup: name, line: { color, width: LINE.normal, dash: r.excluded ? 'dash' : 'solid' }, hovertemplate: `${name}<br>${xl} = %{x:.3f}${xu}<br>${yl} = %{y:.4f} ${yu}<extra></extra>` } as Data);
      traces.push({ type: 'scatter', mode: 'markers', x: [m.deltaPeakMm * fx], y: [m.fmaxN * fy], legendgroup: name, showlegend: false, marker: { symbol: 'triangle-up', size: 12, color, line: { color: '#18263A', width: 1 } }, hovertemplate: `${name}<br>peak: ${yl} = %{y:.4f} ${yu} at ${xl} = %{x:.3f}${xu}<extra></extra>` } as Data);
      traces.push({ type: 'scatter', mode: 'markers', x: [m.deltaMaxMm * fx], y: [TACK_DEFAULTS.endFraction * m.fmaxN * fy], legendgroup: name, showlegend: false, marker: { symbol: m.incomplete ? 'x-open' : 'x', size: 12, color, line: { color, width: 2 } }, hovertemplate: `${name}<br>break: ${xl} = %{x:.3f}${xu}${m.incomplete ? ' (end of data: incomplete detachment)' : ''}<extra></extra>` } as Data);
      if (m.plateau) traces.push({ type: 'scatter', mode: 'lines', x: [m.plateau.fromMm * fx, m.plateau.toMm * fx], y: [m.plateau.levelN * fy, m.plateau.levelN * fy], legendgroup: name, showlegend: false, line: { color, width: 1.4, dash: 'dot' }, hovertemplate: `${name}<br>plateau ${m.plateau.stressKPa.toFixed(2)} kPa over ${m.plateau.lengthMm.toFixed(2)} mm<extra></extra>` } as Data);
    });
    const lay: Partial<Layout> = {
      ...figLayout(),
      xaxis: figAxis(stress ? 'Nominal strain ε = δ / h₀' : 'Displacement δ from tensile onset (mm)'),
      yaxis: figAxis(stress ? 'Nominal stress σ = F / A (kPa)' : 'Tensile force F (N)'),
      legend: { x: 1.01, y: 1, font: { size: 14 } },
      hovermode: 'closest',
      uirevision: `${repeat.fileId}|${stress}`,
    };
    return { data: traces, layout: lay };
  }, [repeat, stress]);
  const save = async (format: 'png' | 'svg') => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.downloadImage(plotEl.current, { format, filename: `tack_${repeat.name.replace(/[^\w.-]+/g, '_')}`, ...EXPORT_SIZE, scale: format === 'png' ? 4 : 1 } as never);
  };
  return (
    <>
      <div className="table-actions">
        <span className="note">▲ peak · × break (F ≤ {TACK_DEFAULTS.endFraction * 100}% F<sub>max</sub>; open × = end of data) · dotted = plateau</span>
        <div className="export-group"><span>Save graph</span><button className="small" onClick={() => save('png')}>PNG</button><button className="small" onClick={() => save('svg')}>SVG</button></div>
      </div>
      <PlotlyChart data={data} layout={layout} className="plot summary" onReady={(el) => (plotEl.current = el)} />
    </>
  );
}

export function TackMetricsTab() {
  const { project, update } = useApp();
  const t = useTackMetrics();
  const [plotId, setPlotId] = useState<string | null>(null);
  const [plotMode, setPlotMode] = useState<PlotMode>('force');
  const [allH0, setAllH0] = useState<number | null>(null);
  const d = t.diameter;
  const area = d > 0 ? (Math.PI * d * d) / 4 : NaN;
  const setDiameter = (v: number) => update((p) => ({ ...p, settings: { ...p.settings, probe: { ...p.settings.probe, diameterMm: v } } }));
  if (!t.repeats.length) return <p className="note pad">Open your probe-tack files and choose a charge ratio and concentration on the left.</p>;
  const plotRepeat = t.repeats.find((r) => r.fileId === plotId) ?? t.repeats.find((r) => r.included) ?? t.repeats[0];
  const sessions = [...new Set(t.repeats.map((r) => r.session))];
  const excludedRepeats = t.repeats.filter((r) => r.excluded);
  const excludedSessions = sessions.filter((s) => t.tm.excludedSessions[s]);
  const excludedRuns = t.repeats.flatMap((rp) => rp.runs.filter((r) => r.excluded).map((r) => ({ rp, r })));
  const allRuns = t.repeats.flatMap((rp) => rp.runs.map((r) => ({ rp, r })));
  const base = `${project.name || 'tack'}_CR${t.ex.chargeRatio}_${t.ex.concentrationM}M`.replace(/[^\w.-]+/g, '_');

  const runCsv = () => [
    ['Repeat (file)', 'Path', 'Session', 'Substrate', 'Dwell (s)', 'h0 (mm)', 'Probe d (mm)', 'Repeat excluded', 'Run', 'Run excluded', 'Exclusion reason',
      ...MAIN_METRICS.map((k) => `${k.label} (${k.unit})`), 'Failure mode', 'Observation', 'Fibril onset δ (mm)', 'Max fibril extension (mm)', 'Flags', 'Flag details',
      ...DIAG_METRICS.map((k) => `${k.label} (${k.unit})`)],
    ...allRuns.map(({ rp, r }) => {
      const flags = tackFlags(r.m);
      return [rp.name, rp.file.path, rp.session, rp.substrateLabel, rp.dwellS, rp.h0, d, rp.included ? '' : 'yes', r.cycle.cycleNumber, r.excluded ? 'yes' : '', r.excluded?.reason ?? '',
        ...MAIN_METRICS.map((k) => (r.m.ok ? k.get(r.m) : null)), r.obs.mode ? failureModeLabel(r.obs.mode) : '', r.obs.note, r.obs.fibrilOnsetMm, r.obs.fibrilMaxMm,
        flags.map((f) => f.label).join('; '), flags.map((f) => f.detail).join(' | '), ...DIAG_METRICS.map((k) => (r.m.ok ? k.get(r.m) : null))];
    }),
  ];
  const summaryCsv = () => [
    ['Mean ± SD per Repeat (over its runs, excluded runs left out)'],
    ['Repeat (file)', 'Substrate', 'Dwell (s)', 'Repeat excluded', 'Runs', ...MAIN_METRICS.flatMap((k) => [`${k.label} mean (${k.unit})`, `${k.label} SD (${k.unit})`]), 'Failure modes'],
    ...t.repeats.map((rp) => [rp.name, rp.substrateLabel, rp.dwellS, rp.included ? '' : 'yes', usedRuns(rp).length, ...MAIN_METRICS.flatMap((k) => { const s = t.repeatStats.get(rp.fileId)![k.key]; return [s.mean, s.sd]; }), failureModeCounts(usedRuns(rp))]),
    [],
    ['Mean ± SD per condition (substrate × dwell; over the Repeat means of included Repeats)'],
    ['Substrate', 'Dwell (s)', 'Repeats', 'Runs', ...MAIN_METRICS.flatMap((k) => [`${k.label} mean (${k.unit})`, `${k.label} SD (${k.unit})`]), 'Failure modes'],
    ...t.conditions.map((c) => [c.substrate, c.dwellS, c.nRepeats, c.nRuns, ...MAIN_METRICS.flatMap((k) => [c.stats[k.key].mean, c.stats[k.key].sd]), c.modes]),
    [],
    ['Probe diameter (mm)', d, 'A (mm²)', area],
    ['Excluded Repeats'], ...excludedRepeats.map((r) => [r.name, r.excluded!.reason]),
    ['Excluded sessions'], ...excludedSessions.map((s) => [s, t.tm.excludedSessions[s].reason]),
    ['Excluded runs'], ...excludedRuns.map(({ rp, r }) => [`${rp.name} run ${r.cycle.cycleNumber}`, r.excluded!.reason]),
  ];

  return (
    <div className="ls-results tack-metrics">
      <p className="note">
        Charge ratio <strong>{t.ex.chargeRatio}</strong>, <strong>{t.ex.concentrationM} M</strong> (chosen on the left): every substrate and dwell time, tensile part of each pull.
        Flags are warnings only; nothing is excluded unless you choose to.
      </p>

      <Section n={1} title="Test settings">
        <div className="table-actions">
          <NumberField label="Probe diameter d (mm)" value={d > 0 ? d : null} positive onCommit={(v) => v !== null && setDiameter(v)} title="A = π d² / 4" />
          <span className="note">A = {fmt(area, 3)} mm²</span>
          <NumberField label="Set h₀ for all Repeats (mm)" value={allH0} positive allowEmpty placeholder="mm" onCommit={setAllH0} />
          <button className="small" disabled={allH0 === null} onClick={() => t.setH0(t.repeats.map((r) => r.fileId), allH0)}>Apply to all</button>
        </div>
        <div className="table-scroll">
          <table className="grid">
            <thead><tr><th>Exclude</th><th>Repeat (file)</th><th>Session</th><th>Substrate</th><th className="num">Dwell (s)</th><th>h₀ (mm)</th><th className="num">Runs</th><th>Reason (if excluded)</th></tr></thead>
            <tbody>
              {t.repeats.map((rp) => (
                <tr key={rp.fileId} className={rp.included ? '' : 'excluded-row'}>
                  <td><input type="checkbox" checked={!!rp.excluded} onChange={(e) => t.excludeRepeat(rp.fileId, e.target.checked, rp.excluded?.reason ?? '')} aria-label={`Exclude ${rp.name}`} /></td>
                  <td title={rp.file.path}>{rp.name}</td>
                  <td>{rp.session}{rp.sessionExcluded ? ' (session excluded)' : ''}</td>
                  <td>
                    <select value={SUBSTRATES.includes(rp.substrateLabel) ? rp.substrateLabel : '__read__'} onChange={(e) => t.setSubstrate(rp.fileId, e.target.value === '__read__' ? null : e.target.value)} aria-label={`Substrate of ${rp.name}`}>
                      {SUBSTRATES.map((s) => <option key={s} value={s}>{s}</option>)}
                      {!SUBSTRATES.includes(rp.substrateLabel) && <option value="__read__">{rp.substrate === '—' ? 'unknown' : rp.substrate}</option>}
                    </select>
                  </td>
                  <td className="num" title="Read from the Wait section">{rp.dwellS ?? '—'}</td>
                  <td><NumberField compact value={rp.h0} positive allowEmpty placeholder="skip" label={`h₀ of ${rp.name} (mm)`} onCommit={(v) => t.setH0([rp.fileId], v)} /></td>
                  <td className="num">{rp.runs.length}</td>
                  <td>{rp.excluded && <input className="reason" value={rp.excluded.reason} placeholder="reason" onChange={(e) => t.excludeRepeat(rp.fileId, true, e.target.value)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-actions">
          <span className="note">Exclude a whole test session:</span>
          {sessions.map((s) => (
            <label key={s} className="check"><input type="checkbox" checked={!!t.tm.excludedSessions[s]} onChange={(e) => t.excludeSession(s, e.target.checked, t.tm.excludedSessions[s]?.reason ?? '')} /> {s}</label>
          ))}
        </div>
        <div className="excluded-list">
          <strong>Excluded data sets</strong>
          {!excludedRepeats.length && !excludedSessions.length && !excludedRuns.length ? (
            <span className="note"> none</span>
          ) : (
            <ul>
              {excludedSessions.map((s) => <li key={s}>Session {s}: <input className="reason" value={t.tm.excludedSessions[s].reason} placeholder="reason" onChange={(e) => t.excludeSession(s, true, e.target.value)} /></li>)}
              {excludedRepeats.map((r) => <li key={r.fileId}>Repeat {r.name}: <input className="reason" value={r.excluded!.reason} placeholder="reason" onChange={(e) => t.excludeRepeat(r.fileId, true, e.target.value)} /></li>)}
              {excludedRuns.map(({ rp, r }) => (
                <li key={r.id}>Run {r.cycle.cycleNumber} of {rp.name}: <input className="reason" value={r.excluded!.reason} placeholder="reason" onChange={(e) => t.excludeRun(r.id, true, e.target.value)} /> <button className="link small" onClick={() => t.excludeRun(r.id, false)}>Include again</button></li>
              ))}
            </ul>
          )}
        </div>
      </Section>

      <Section n={2} title="Force–displacement / stress–strain">
        <div className="table-actions">
          <label className="field inline">
            <span>Repeat</span>
            <select value={plotRepeat.fileId} onChange={(e) => setPlotId(e.target.value)}>
              {t.repeats.map((r) => <option key={r.fileId} value={r.fileId}>{r.substrateLabel} · {r.dwellS ?? '—'} s · {r.name}</option>)}
            </select>
          </label>
          <div className="segmented small" role="group" aria-label="Plot">
            <button className={plotMode === 'force' ? 'on' : ''} onClick={() => setPlotMode('force')}>F vs δ</button>
            <button className={plotMode === 'stress' ? 'on' : ''} disabled={plotRepeat.h0 === null} title={plotRepeat.h0 === null ? 'Enter h₀ for this Repeat' : ''} onClick={() => setPlotMode('stress')}>σ vs ε</button>
          </div>
        </div>
        <TackPlot repeat={plotRepeat} mode={plotMode} />
      </Section>

      <Section n={3} title="Per-run results">
        <div className="table-scroll">
          <table className="grid tack-runs">
            <thead>
              <tr>
                <th title="Optional: leave this run out of the statistics (none by default)">Excl.</th><th>Repeat</th><th>Run</th><th>Substrate</th><th className="num">Dwell (s)</th>
                {MAIN_METRICS.map((k) => <MetricTh key={k.key} k={k} />)}
                <th>Failure mode</th><th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {allRuns.map(({ rp, r }) => (
                <tr key={r.id} className={rp.included && !r.excluded ? '' : 'excluded-row'}>
                  <td><input type="checkbox" checked={!!r.excluded} disabled={!r.m.ok} onChange={(e) => t.excludeRun(r.id, e.target.checked, r.excluded?.reason ?? '')} aria-label={`Exclude run ${r.cycle.cycleNumber} of ${rp.name}`} /></td>
                  <td title={rp.file.path}>{rp.name}</td>
                  <td>{r.cycle.cycleNumber}</td>
                  <td>{rp.substrateLabel}</td>
                  <td className="num">{rp.dwellS ?? '—'}</td>
                  {MAIN_METRICS.map((k) => <td key={k.key} className="num">{r.m.ok ? fmt(k.get(r.m), k.digits) : '—'}</td>)}
                  <td title={r.obs.note}>{r.obs.mode ? failureModeLabel(r.obs.mode) : '—'}</td>
                  <td><Flags m={r.m} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">ε needs h₀ for the Repeat. Hover or click a flag for details. Failure modes are entered in section 6.</p>
      </Section>

      <Section n={4} title="Mean ± SD per Repeat">
        <div className="table-scroll">
          <table className="grid">
            <thead><tr><th>Repeat</th><th>Substrate</th><th className="num">Dwell (s)</th><th className="num">Runs</th>{MAIN_METRICS.map((k) => <MetricTh key={k.key} k={k} />)}<th>Failure modes</th></tr></thead>
            <tbody>
              {t.repeats.map((rp) => (
                <tr key={rp.fileId} className={rp.included ? '' : 'excluded-row'}>
                  <td>{rp.name}</td><td>{rp.substrateLabel}</td><td className="num">{rp.dwellS ?? '—'}</td><td className="num">{usedRuns(rp).length}</td>
                  {MAIN_METRICS.map((k) => <td key={k.key} className="num">{ms(t.repeatStats.get(rp.fileId)![k.key], k.digits)}</td>)}
                  <td>{failureModeCounts(usedRuns(rp))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section n={5} title="Mean ± SD per condition (substrate × dwell)">
        <div className="table-scroll">
          <table className="grid">
            <thead><tr><th>Condition</th><th className="num">Repeats</th><th className="num">Runs</th>{MAIN_METRICS.map((k) => <MetricTh key={k.key} k={k} />)}<th>Failure modes</th></tr></thead>
            <tbody>
              {t.conditions.map((c) => (
                <tr key={c.key}>
                  <td className="strong">{c.label}</td><td className="num">{c.nRepeats}</td><td className="num">{c.nRuns}</td>
                  {MAIN_METRICS.map((k) => <td key={k.key} className="num">{ms(c.stats[k.key], k.digits)}</td>)}
                  <td>{c.modes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">Over the Repeat means of the included Repeats, so each Repeat counts once.</p>
      </Section>

      <Section n={6} title="Failure-mode observations">
        <p className="note">Entered by you from what you saw (video, inspection); never inferred from the force curve. Fibril fields are optional.</p>
        <div className="table-scroll">
          <table className="grid tack-obs">
            <thead><tr><th>Repeat</th><th>Run</th><th>Failure mode</th><th>Observation</th><th>Fibril onset δ (mm)</th><th>Max fibril extension (mm)</th></tr></thead>
            <tbody>
              {allRuns.map(({ rp, r }) => (
                <tr key={r.id} className={rp.included && !r.excluded ? '' : 'excluded-row'}>
                  <td>{rp.name}</td><td>{r.cycle.cycleNumber}</td>
                  <td>
                    <select value={r.obs.mode} onChange={(e) => t.setObservation(r.id, { mode: e.target.value as TackFailureMode })} aria-label={`Failure mode of run ${r.cycle.cycleNumber} of ${rp.name}`}>
                      {FAILURE_MODES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </td>
                  <td><input className="obs-note" value={r.obs.note} placeholder="what you observed" onChange={(e) => t.setObservation(r.id, { note: e.target.value })} aria-label={`Observation for run ${r.cycle.cycleNumber} of ${rp.name}`} /></td>
                  <td>
                    <NumberField compact value={r.obs.fibrilOnsetMm} min={0} allowEmpty placeholder="—" label={`Fibril onset of run ${r.cycle.cycleNumber} (mm)`} onCommit={(v) => t.setObservation(r.id, { fibrilOnsetMm: v })} />
                    {r.obs.fibrilOnsetMm !== null && rp.h0 !== null && <small> ε = {fmt(r.obs.fibrilOnsetMm / rp.h0, 3)}</small>}
                  </td>
                  <td>
                    <NumberField compact value={r.obs.fibrilMaxMm} min={0} allowEmpty placeholder="—" label={`Max fibril extension of run ${r.cycle.cycleNumber} (mm)`} onCommit={(v) => t.setObservation(r.id, { fibrilMaxMm: v })} />
                    {r.obs.fibrilMaxMm !== null && rp.h0 !== null && <small> ε = {fmt(r.obs.fibrilMaxMm / rp.h0, 3)}</small>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <details className="section tack-advanced">
        <summary>7. Advanced / Diagnostics: dwell forces and relaxation</summary>
        <div className="section-body">
          <p className="note">Secondary quantities. With few force steps (Low force resolution) the relaxation is approximate.</p>
          <div className="table-scroll">
            <table className="grid">
              <thead><tr><th>Repeat</th><th>Run</th>{DIAG_METRICS.map((k) => <MetricTh key={k.key} k={k} />)}</tr></thead>
              <tbody>
                {allRuns.map(({ rp, r }) => (
                  <tr key={r.id} className={rp.included && !r.excluded ? '' : 'excluded-row'}>
                    <td>{rp.name}</td><td>{r.cycle.cycleNumber}</td>
                    {DIAG_METRICS.map((k) => <td key={k.key} className="num">{r.m.ok ? fmt(k.get(r.m), k.digits) : '—'}</td>)}
                  </tr>
                ))}
                {t.repeats.map((rp) => (
                  <tr key={`m-${rp.fileId}`} className="mean-row">
                    <td colSpan={2}>{rp.name} mean ± SD</td>
                    {DIAG_METRICS.map((k) => <td key={k.key} className="num">{ms(t.repeatStats.get(rp.fileId)![k.key], k.digits)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <TackMethods n={8} />

      <Section n={9} title="Export CSV">
        <div className="table-actions">
          <button className="small" onClick={() => saveCsv(runCsv(), `${base}_tack_runs.csv`)}>Per-run results</button>
          <button className="small" onClick={() => saveCsv(summaryCsv(), `${base}_tack_summary.csv`)}>Repeat and condition summaries</button>
          <span className="note">Per-run CSV includes failure modes, observations, flags with details and the diagnostic quantities; the summary lists excluded data sets with reasons.</span>
        </div>
      </Section>
    </div>
  );
}
