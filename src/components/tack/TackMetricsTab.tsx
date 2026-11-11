import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Data, Layout, PlotlyHTMLElement } from 'plotly.js';
import { useApp, download } from '../../state/AppContext';
import {
  DIAG_METRICS, FAILURE_MODES, MAIN_METRICS, TACK_MORPHOLOGIES, failureModeCounts, failureModeLabel, morphologyCounts, morphologyLabel, tackFlags, usedRuns, allOkRuns, useTackMetrics,
  type Metric, type TackRepeat,
} from '../../state/tackMetrics';
import { TACK_DEFAULTS } from '../../analysis/tackMetrics';
import { PlotlyChart, loadPlotly } from '../../plotting/PlotlyChart';
import { EXPORT_SIZE, LINE, figAxis, figLayout } from '../../plotting/figureStyle';
import { CURVE_COLORS } from '../../plotting/colors';
import { NumberField } from '../lapShear/NumberField';
import { fmt } from '../common';
import { TackMethods } from './TackMethods';
import { AREA_EDITS, AreaTool, areaFillTrace, areaShapes } from '../AreaTool';
import { areaFromRelayout, areaLimits, integrateRange, type CustomArea } from '../../analysis/customArea';

/** Plot edits off, except what a tool switches on. */
const NO_EDITS = { annotationPosition: false, annotationTail: false, annotationText: false, axisTitleText: false, titleText: false, legendText: false, legendPosition: false, colorbarTitleText: false, colorbarPosition: false, shapePosition: false };
const rgbaOf = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
import type { FailureMode, TackMorphology } from '../../types';
import { BulkAssignBar, ObservationGlossary, useRunSelection, type SelectableRow } from '../ObservationTools';

const SUBSTRATES = ['PET', 'stainless steel', 'glass'];

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const saveCsv = (rows: unknown[][], name: string) => download(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), name);
const ms = (s: { mean: number; sd: number; n: number } | undefined, d: number) => (s && s.n ? `${fmt(s.mean, d)} ± ${s.n > 1 ? fmt(s.sd, d) : '—'}` : '—');
type MSv = { mean: number; sd: number; n: number } | undefined;
/** After exclusion (main line) and before exclusion (all runs), as in Data analysis. */
function Both({ after, before, d }: { after: MSv; before: MSv; d: number }) {
  return (
    <>
      <div title="After exclusion">{ms(after, d)}</div>
      <div className="note before" title="Before exclusion (all runs)">all: {ms(before, d)}</div>
    </>
  );
}
const EXCL_LABEL = { manual: 'Excluded (manual)', dataset: 'Excluded (Repeat/session)', auto: 'Excluded (QC rule)' } as const;

/** Table header of a metric: name with subscripts, unit below. */
function MetricTh({ k }: { k: Metric }) {
  return (
    <th className="num">
      <span dangerouslySetInnerHTML={{ __html: k.html }} /> <small>({k.unit})</small>
    </th>
  );
}

/** A numbered section that can be collapsed (click its title), like Advanced / Diagnostics and Methods. */
function Section({ n, title, children, extra, open = true, id }: { n: number; title: string; children: ReactNode; extra?: ReactNode; open?: boolean; id?: string }) {
  return (
    <details className="section tack-section" open={open} id={id}>
      <summary>{n}. {title}{extra}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

/** Open or close every section of the tab. */
function toggleAll(e: { currentTarget: HTMLElement }, open: boolean) {
  e.currentTarget.closest('.tack-metrics')?.querySelectorAll<HTMLDetailsElement>(':scope > details.section').forEach((d) => (d.open = open));
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
function TackPlot({ repeat, mode, area, setArea }: { repeat: TackRepeat; mode: PlotMode; area: CustomArea; setArea: (a: CustomArea) => void }) {
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
      const fill = areaFillTrace(xs, ys, area, rgbaOf(color, 0.18), name, (mm) => mm * fx);
      if (fill) traces.push(fill);
      traces.push({ type: 'scatter', mode: 'lines', x: xs, y: ys, name, legendgroup: name, line: { color, width: LINE.normal, dash: r.excluded ? 'dash' : 'solid' }, hovertemplate: `${name}<br>${xl} = %{x:.3f}${xu}<br>${yl} = %{y:.4f} ${yu}<extra></extra>` } as Data);
      traces.push({ type: 'scatter', mode: 'markers', x: [m.deltaPeakMm * fx], y: [m.fmaxN * fy], legendgroup: name, showlegend: false, marker: { symbol: 'triangle-up', size: 12, color, line: { color: '#18263A', width: 1 } }, hovertemplate: `${name}<br>peak: ${yl} = %{y:.4f} ${yu} at ${xl} = %{x:.3f}${xu}<extra></extra>` } as Data);
      if (!m.incomplete && m.failureDispMm !== null) traces.push({ type: 'scatter', mode: 'markers', x: [m.failureDispMm * fx], y: [TACK_DEFAULTS.endFraction * m.fmaxN * fy], legendgroup: name, showlegend: false, marker: { symbol: 'x', size: 12, color, line: { color, width: 2 } }, hovertemplate: `${name}<br>failure: ${xl} = %{x:.3f}${xu}<extra></extra>` } as Data);
      if (m.plateau) traces.push({ type: 'scatter', mode: 'lines', x: [m.plateau.fromMm * fx, m.plateau.toMm * fx], y: [m.plateau.levelN * fy, m.plateau.levelN * fy], legendgroup: name, showlegend: false, line: { color, width: 1.4, dash: 'dot' }, hovertemplate: `${name}<br>plateau ${m.plateau.stressKPa.toFixed(2)} kPa over ${m.plateau.lengthMm.toFixed(2)} mm<extra></extra>` } as Data);
    });
    const lay: Partial<Layout> = {
      ...figLayout(),
      xaxis: figAxis(stress ? 'Nominal strain ε = δ / h₀' : 'Displacement δ from tensile onset (mm)'),
      yaxis: figAxis(stress ? 'Nominal stress σ = F / A (kPa)' : 'Tensile force F (N)'),
      legend: { x: 1.01, y: 1, font: { size: 14 } },
      hovermode: 'closest',
      uirevision: `${repeat.fileId}|${stress}`,
      shapes: areaShapes(area, (mm) => (stress ? mm / repeat.h0! : mm)),
    };
    return { data: traces, layout: lay };
  }, [repeat, stress, area]);
  const xRange = useMemo<[number, number] | null>(() => {
    let a = Infinity, b = -Infinity;
    for (const r of repeat.runs) if (r.m.ok) for (const v of r.m.curve.deltaMm) { if (v < a) a = v; if (v > b) b = v; }
    return Number.isFinite(a) && b > a ? [Math.max(0, a), b] : null;
  }, [repeat]);
  const save = async (format: 'png' | 'svg') => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.downloadImage(plotEl.current, { format, filename: `tack_${repeat.name.replace(/[^\w.-]+/g, '_')}`, ...EXPORT_SIZE, scale: format === 'png' ? 4 : 1 } as never);
  };
  return (
    <>
      <div className="table-actions">
        <span className="note">▲ peak · × true failure · dotted = automatically detected plateau. Incomplete runs have no true-failure marker.</span>
        <div className="export-group"><span>Save graph</span><button className="small" onClick={() => save('png')}>PNG</button><button className="small" onClick={() => save('svg')}>SVG</button></div>
      </div>
      <PlotlyChart
        data={data}
        layout={layout}
        className="plot summary"
        onReady={(el) => (plotEl.current = el)}
        config={{ editable: true, edits: { ...NO_EDITS, ...AREA_EDITS } }}
        onRelayout={(e) => { const a = areaFromRelayout(e, area, (x) => (stress ? x * repeat.h0! : x)); if (a && a.fromMm !== null && a.toMm !== null) setArea({ fromMm: +a.fromMm.toFixed(4), toMm: +a.toMm.toFixed(4) }); }}
      />
      <AreaTool
        area={area}
        setArea={setArea}
        xRangeMm={xRange}
        rows={repeat.runs.filter((r) => r.m.ok).map((r) => {
          const lim = areaLimits(area)!;
          const res = lim ? integrateRange(r.m.curve.deltaMm, r.m.curve.tN, lim[0], lim[1]) : { workMJ: NaN, covered: true };
          return { id: r.id, label: `${repeat.name} – Run ${r.cycle.cycleNumber}${r.excluded ? ' (excluded)' : ''}`, workMJ: res.workMJ, perAreaJm2: (res.workMJ / r.m.areaMm2) * 1000, covered: res.covered };
        })}
        perAreaLabel="W/A_probe (J/m²)"
        note="δ is measured from the tensile onset, as on the graph; A_probe = π d²/4."
      />
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
  const allRuns = t.repeats.flatMap((rp) => rp.runs.map((r) => ({ rp, r })));
  const obsRows: SelectableRow[] = allRuns.map(({ rp, r }) => ({
    id: r.id, mode: r.obs.locus, morphology: r.obs.morphology,
    repeatKey: rp.fileId, repeatLabel: rp.name,
    conditionKey: `${rp.substrateLabel.toLowerCase()}|${rp.dwellS ?? '—'}`, conditionLabel: `${rp.substrateLabel} · ${rp.dwellS ?? '—'} s`,
  }));
  const obsSel = useRunSelection(obsRows);
  if (!t.repeats.length) return <p className="note pad">Open your probe-tack files and choose a charge ratio and concentration on the left.</p>;
  const plotRepeat = t.repeats.find((r) => r.fileId === plotId) ?? t.repeats.find((r) => r.included) ?? t.repeats[0];
  const sessions = [...new Set(t.repeats.map((r) => r.session))];
  const excludedRepeats = t.repeats.filter((r) => r.excluded);
  const excludedSessions = sessions.filter((s) => t.tm.excludedSessions[s]);
  // Runs excluded on their own (runs of an excluded Repeat/session are covered by that entry).
  const excludedRuns = t.repeats.flatMap((rp) => rp.runs.filter((r) => r.excluded && r.excluded.kind !== 'dataset').map((r) => ({ rp, r })));
  const base = `${project.name || 'tack'}_CR${t.ex.chargeRatio}_${t.ex.concentrationM}M`.replace(/[^\w.-]+/g, '_');

  const runCsv = () => [
    ['Repeat (file)', 'Path', 'Session', 'Substrate', 'Dwell (s)', 'h0 (mm)', 'Probe d (mm)', 'Repeat excluded', 'Run', 'Run excluded', 'Exclusion reason',
      ...MAIN_METRICS.map((k) => `${k.label} (${k.unit})`), 'Failure mode', 'Debonding morphology', 'Observation', 'Fibril onset δ (mm)', 'Max fibril extension (mm)', 'Flags', 'Flag details',
      ...DIAG_METRICS.map((k) => `${k.label} (${k.unit})`), 'Custom area δ1 (mm)', 'Custom area δ2 (mm)', 'W_selected (mJ)', 'W_selected/A_probe (J/m²)'],
    ...allRuns.map(({ rp, r }) => {
      const flags = tackFlags(r.m);
      return [rp.name, rp.file.path, rp.session, rp.substrateLabel, rp.dwellS, rp.h0, d, rp.included ? '' : 'yes', r.cycle.cycleNumber, r.excluded ? 'yes' : '', r.excluded?.reason ?? '',
        ...MAIN_METRICS.map((k) => (r.m.ok ? k.get(r.m) : null)), r.obs.locus === 'unspecified' ? '' : failureModeLabel(r.obs.locus), r.obs.morphology === 'unspecified' ? '' : morphologyLabel(r.obs.morphology), r.obs.note, r.obs.fibrilOnsetMm, r.obs.fibrilMaxMm,
        flags.map((f) => f.label).join('; '), flags.map((f) => f.detail).join(' | '), ...DIAG_METRICS.map((k) => (r.m.ok ? k.get(r.m) : null)),
        ...(() => {
          const lim = areaLimits(t.tm.area);
          if (!lim || !r.m.ok) return [t.tm.area.fromMm, t.tm.area.toMm, null, null];
          const w = integrateRange(r.m.curve.deltaMm, r.m.curve.tN, lim[0], lim[1]).workMJ;
          return [lim[0], lim[1], w, (w / r.m.areaMm2) * 1000];
        })()];
    }),
  ];
  const summaryCsv = () => [
    ['Mean ± SD per Repeat over its runs: after exclusion (shared with Data analysis) and before exclusion (all runs)'],
    ['Repeat (file)', 'Substrate', 'Dwell (s)', 'Repeat excluded', 'Runs used', 'Runs (all)', ...MAIN_METRICS.flatMap((k) => [`${k.label} mean (${k.unit})`, `${k.label} SD (${k.unit})`, `${k.label} mean, all runs (${k.unit})`, `${k.label} SD, all runs (${k.unit})`]), 'Failure modes'],
    ...t.repeats.map((rp) => [rp.name, rp.substrateLabel, rp.dwellS, rp.included ? '' : 'yes', usedRuns(rp).length, allOkRuns(rp).length, ...MAIN_METRICS.flatMap((k) => { const s = t.repeatStats.get(rp.fileId)![k.key]; const a = t.repeatStatsAll.get(rp.fileId)![k.key]; return [s.mean, s.sd, a.mean, a.sd]; }), failureModeCounts(usedRuns(rp))]),
    [],
    ['Mean ± SD per condition (substrate × dwell) over the Repeat means: after exclusion and before exclusion (all runs)'],
    ['Substrate', 'Dwell (s)', 'Repeats used', 'Repeats (all)', 'Runs used', 'Runs (all)', ...MAIN_METRICS.flatMap((k) => [`${k.label} mean (${k.unit})`, `${k.label} SD (${k.unit})`, `${k.label} mean, all runs (${k.unit})`, `${k.label} SD, all runs (${k.unit})`]), 'Failure modes'],
    ...t.conditions.map((c) => [c.substrate, c.dwellS, c.nRepeats, c.nRepeatsAll, c.nRuns, c.nRunsAll, ...MAIN_METRICS.flatMap((k) => [c.stats[k.key].mean, c.stats[k.key].sd, c.statsAll[k.key].mean, c.statsAll[k.key].sd]), c.modes]),
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
        Flags are warnings only. Exclusions are shared with the Data analysis tab (including its automatic QC rule).
      </p>
      <div className="table-actions section-toggles">
        <button className="link small" onClick={(e) => toggleAll(e, true)}>Expand all sections</button>
        <button className="link small" onClick={(e) => toggleAll(e, false)}>Collapse all</button>
      </div>

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
          <strong>Excluded data sets</strong> <span className="note">(shared with Data analysis: excluding or re-including a run here or there updates both tabs)</span>
          {!excludedRepeats.length && !excludedSessions.length && !excludedRuns.length ? (
            <span className="note"> none</span>
          ) : (
            <ul>
              {excludedSessions.map((s) => <li key={s}>Session {s}: <input className="reason" value={t.tm.excludedSessions[s].reason} placeholder="reason" onChange={(e) => t.excludeSession(s, true, e.target.value)} /></li>)}
              {excludedRepeats.map((r) => <li key={r.fileId}>Repeat {r.name}: <input className="reason" value={r.excluded!.reason} placeholder="reason" onChange={(e) => t.excludeRepeat(r.fileId, true, e.target.value)} /></li>)}
              {excludedRuns.map(({ rp, r }) => (
                <li key={r.id}>
                  Run {r.cycle.cycleNumber} of {rp.name}:{' '}
                  {r.excluded!.kind === 'manual'
                    ? <input className="reason" value={r.result.override?.reason ?? ''} placeholder="reason" onChange={(e) => t.setRunReason(r.id, e.target.value)} aria-label={`Reason for excluding run ${r.cycle.cycleNumber} of ${rp.name}`} />
                    : <span className="note">{r.excluded!.reason}</span>}{' '}
                  <button className="link small" onClick={() => t.excludeRun(r.id, false)}>Include again</button>
                </li>
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
        <TackPlot repeat={plotRepeat} mode={plotMode} area={t.tm.area} setArea={t.setArea} />
      </Section>

      <Section n={3} title="Per-run results">
        <div className="table-scroll">
          <table className="grid tack-runs">
            <thead>
              <tr>
                <th title="Left out of the averages: the same decision as the In average box in Data analysis">Excl.</th><th>Repeat</th><th>Run</th><th>Substrate</th><th className="num">Dwell (s)</th>
                {MAIN_METRICS.map((k) => <MetricTh key={k.key} k={k} />)}
                <th>Failure mode</th><th>Debonding morphology</th><th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {allRuns.map(({ rp, r }) => (
                <tr key={r.id} className={rp.included && !r.excluded ? '' : 'excluded-row'}>
                  <td><input type="checkbox" checked={!!r.excluded} disabled={!r.m.ok} title={r.excluded ? r.excluded.reason : 'Included'} onChange={(e) => t.excludeRun(r.id, e.target.checked)} aria-label={`Exclude run ${r.cycle.cycleNumber} of ${rp.name}`} /></td>
                  <td title={rp.file.path}>{rp.name}</td>
                  <td>{r.cycle.cycleNumber}</td>
                  <td>{rp.substrateLabel}</td>
                  <td className="num">{rp.dwellS ?? '—'}</td>
                  {MAIN_METRICS.map((k) => <td key={k.key} className="num">{r.m.ok ? fmt(k.get(r.m), k.digits) : '—'}</td>)}
                  <td title={r.obs.note}>{r.obs.locus === 'unspecified' ? '—' : failureModeLabel(r.obs.locus)}</td>
                  <td title={r.obs.note}>{r.obs.morphology === 'unspecified' ? '—' : morphologyLabel(r.obs.morphology)}</td>
                  <td>{r.excluded && <span className={`excl-chip excl-${r.excluded.kind}`} title={r.excluded.reason}>{EXCL_LABEL[r.excluded.kind]}</span>}<Flags m={r.m} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">Excluded rows stay visible (struck through). Exclusion is shared with Data analysis, including its automatic QC rule; tick or untick Excl. here or In average there. ε needs h₀ for the Repeat. Hover or click a flag for details. Failure mode and debonding morphology are entered in section 6. Incomplete runs have blank true failure strain.</p>
      </Section>

      <Section n={4} title="Mean ± SD per Repeat (after exclusion; all runs below)">
        <div className="table-scroll">
          <table className="grid">
            <thead><tr><th>Repeat</th><th>Substrate</th><th className="num">Dwell (s)</th><th className="num" title="Runs used after exclusion / all analysed runs">Runs</th>{MAIN_METRICS.map((k) => <MetricTh key={k.key} k={k} />)}<th>Failure modes</th><th>Debonding morphologies</th></tr></thead>
            <tbody>
              {t.repeats.map((rp) => (
                <tr key={rp.fileId} className={rp.included ? '' : 'excluded-row'}>
                  <td>{rp.name}</td><td>{rp.substrateLabel}</td><td className="num">{rp.dwellS ?? '—'}</td><td className="num">{usedRuns(rp).length} / {allOkRuns(rp).length}</td>
                  {MAIN_METRICS.map((k) => <td key={k.key} className="num"><Both after={t.repeatStats.get(rp.fileId)![k.key]} before={t.repeatStatsAll.get(rp.fileId)![k.key]} d={k.digits} /></td>)}
                  <td>{failureModeCounts(usedRuns(rp))}</td><td>{morphologyCounts(usedRuns(rp))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section n={5} title="Mean ± SD per condition (substrate × dwell; after exclusion, all runs below)">
        <div className="table-scroll">
          <table className="grid">
            <thead><tr><th>Condition</th><th className="num" title="Repeats with included runs / all Repeats">Repeats</th><th className="num" title="Runs used after exclusion / all analysed runs">Runs</th>{MAIN_METRICS.map((k) => <MetricTh key={k.key} k={k} />)}<th>Failure modes</th><th>Debonding morphologies</th></tr></thead>
            <tbody>
              {t.conditions.map((c) => (
                <tr key={c.key}>
                  <td className="strong">{c.label}</td><td className="num">{c.nRepeats} / {c.nRepeatsAll}</td><td className="num">{c.nRuns} / {c.nRunsAll}</td>
                  {MAIN_METRICS.map((k) => <td key={k.key} className="num"><Both after={c.stats[k.key]} before={c.statsAll[k.key]} d={k.digits} /></td>)}
                  <td>{c.modes}</td><td>{morphologyCounts(t.repeats.filter((rp) => rp.substrateLabel === c.substrate && rp.dwellS === c.dwellS).flatMap(usedRuns))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">Over the Repeat means of the included Repeats, so each Repeat counts once.</p>
      </Section>

      <Section n={6} title="Failure observations">
        <p className="note">Failure mode and debonding morphology are separate manual observations and are never inferred from the force curve. Definitions are in section 9.</p>
        <BulkAssignBar
          rows={obsRows}
          selection={obsSel}
          morphologies={TACK_MORPHOLOGIES}
          onApply={(ps) => t.setObservations(ps.map((x) => ({ id: x.id, patch: { ...(x.mode !== undefined ? { locus: x.mode } : {}), ...(x.morphology !== undefined ? { morphology: x.morphology } : {}) } })))}
        />
        <div className="table-scroll">
          <table className="grid tack-obs">
            <thead><tr><th title="Select for bulk assignment">Sel.</th><th>Repeat</th><th>Run</th><th>Failure mode</th><th>Debonding morphology</th><th>Observation</th><th>Fibril onset δ (mm)</th><th>Max fibril extension (mm)</th></tr></thead>
            <tbody>
              {allRuns.map(({ rp, r }) => (
                <tr key={r.id} className={`${rp.included && !r.excluded ? '' : 'excluded-row'} ${obsSel.current?.id === r.id ? 'focus' : ''}`} onClick={() => obsSel.setCurrentId(r.id)}>
                  <td><input type="checkbox" checked={obsSel.selected.has(r.id)} onChange={(e) => obsSel.toggle(r.id, e.target.checked)} aria-label={`Select run ${r.cycle.cycleNumber} of ${rp.name}`} /></td>
                  <td>{rp.name}</td><td>{r.cycle.cycleNumber}</td>
                  <td><select value={r.obs.locus} onChange={(e) => t.setObservation(r.id, { locus: e.target.value as FailureMode })} aria-label={`Failure mode of run ${r.cycle.cycleNumber} of ${rp.name}`}>{FAILURE_MODES.map((f) => <option key={f.value} value={f.value} title={f.title}>{f.label}</option>)}</select></td>
                  <td><select value={r.obs.morphology} onChange={(e) => t.setObservation(r.id, { morphology: e.target.value as TackMorphology })} aria-label={`Debonding morphology of run ${r.cycle.cycleNumber} of ${rp.name}`}>{TACK_MORPHOLOGIES.map((f) => <option key={f.value} value={f.value} title={f.title}>{f.label}</option>)}</select></td>
                  <td><input className="obs-note" value={r.obs.note} placeholder="what you observed" onChange={(e) => t.setObservation(r.id, { note: e.target.value })} /></td>
                  <td><NumberField compact value={r.obs.fibrilOnsetMm} min={0} allowEmpty placeholder="—" label="Fibril onset (mm)" onCommit={(v) => t.setObservation(r.id, { fibrilOnsetMm: v })} />{r.obs.fibrilOnsetMm !== null && rp.h0 !== null && <small> ε = {fmt(r.obs.fibrilOnsetMm / rp.h0, 3)}</small>}</td>
                  <td><NumberField compact value={r.obs.fibrilMaxMm} min={0} allowEmpty placeholder="—" label="Max fibril extension (mm)" onCommit={(v) => t.setObservation(r.id, { fibrilMaxMm: v })} />{r.obs.fibrilMaxMm !== null && rp.h0 !== null && <small> ε = {fmt(r.obs.fibrilMaxMm / rp.h0, 3)}</small>}</td>
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

      <Section n={9} title="Definitions & References: failure mode and debonding morphology" id="tack-definitions">
        <ObservationGlossary test="tack" title="Definitions & References: failure mode and debonding morphology" hideTitle />
      </Section>

      <Section n={10} title="Export CSV">
        <div className="table-actions">
          <button className="small" onClick={() => saveCsv(runCsv(), `${base}_tack_runs.csv`)}>Per-run results</button>
          <button className="small" onClick={() => saveCsv(summaryCsv(), `${base}_tack_summary.csv`)}>Repeat and condition summaries</button>
          <span className="note">Per-run CSV includes failure modes, observations, flags with details and the diagnostic quantities; the summary lists excluded data sets with reasons.</span>
        </div>
      </Section>
    </div>
  );
}
