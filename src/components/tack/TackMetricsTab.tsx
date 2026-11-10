import { useMemo, useRef, useState } from 'react';
import type { Data, Layout, PlotlyHTMLElement } from 'plotly.js';
import { useApp, download } from '../../state/AppContext';
import { TACK_METRICS, useTackMetrics, type GroupStat, type TackRepeat } from '../../state/tackMetrics';
import { LOW_RESOLUTION_STEPS, TACK_DEFAULTS, type TackMetrics } from '../../analysis/tackMetrics';
import { PlotlyChart, loadPlotly } from '../../plotting/PlotlyChart';
import { EXPORT_SIZE, LINE, figAxis, figLayout } from '../../plotting/figureStyle';
import { CURVE_COLORS } from '../../plotting/colors';
import { NumberField } from '../lapShear/NumberField';
import { fmt } from '../common';
import { TackMethods } from './TackMethods';

const SUBSTRATES = ['PET', 'stainless steel', 'glass'];

function flagsOf(m: TackMetrics): string[] {
  if (!m.ok) return [m.error ?? 'not analysed'];
  const f: string[] = [m.detachment];
  if (m.incomplete) f.push('detachment incomplete – W underestimated');
  if (m.peakSteps !== null && m.peakSteps < LOW_RESOLUTION_STEPS) f.push(`coarse: F_max = ${m.peakSteps.toFixed(1)} force steps of ${m.resolutionN!.toFixed(4)} N`);
  if (m.zeroedN !== null) f.push(`load zeroed after dwell (${m.zeroedN.toFixed(4)} N)`);
  return f;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v)) ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
const saveCsv = (rows: unknown[][], name: string) => download(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), name);
const ms = (s: { mean: number; sd: number; n: number }, d: number) => (s.n ? `${fmt(s.mean, d)} ± ${s.n > 1 ? fmt(s.sd, d) : '—'}` : '—');

/** F vs δ of the runs of one Repeat, with F_max, δ_max and the fitted initial slope. */
function TackPlot({ repeat }: { repeat: TackRepeat }) {
  const plotEl = useRef<PlotlyHTMLElement | null>(null);
  const { data, layout } = useMemo(() => {
    const traces: Data[] = [];
    repeat.runs.forEach((r, k) => {
      const m = r.m;
      if (!m.ok) return;
      const color = CURVE_COLORS[k % CURVE_COLORS.length];
      const name = `Run ${r.cycle.cycleNumber}`;
      const step = Math.max(1, Math.floor(m.curve.deltaMm.length / 3000));
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < m.curve.deltaMm.length; i += step) { xs.push(m.curve.deltaMm[i]); ys.push(m.curve.tN[i]); }
      traces.push({ type: 'scatter', mode: 'lines', x: xs, y: ys, name, legendgroup: name, line: { color, width: LINE.normal }, hovertemplate: `${name}<br>δ = %{x:.3f} mm<br>F = %{y:.4f} N<extra></extra>` } as Data);
      traces.push({ type: 'scatter', mode: 'markers', x: [m.deltaPeakMm], y: [m.fmaxN], legendgroup: name, showlegend: false, marker: { symbol: 'triangle-up', size: 12, color, line: { color: '#18263A', width: 1 } }, hovertemplate: `${name}<br>F_max = %{y:.4f} N at δ_peak = %{x:.3f} mm<extra></extra>` } as Data);
      traces.push({ type: 'scatter', mode: 'markers', x: [m.deltaMaxMm], y: [TACK_DEFAULTS.endFraction * m.fmaxN], legendgroup: name, showlegend: false, marker: { symbol: m.incomplete ? 'x-open' : 'x', size: 12, color, line: { color, width: 2 } }, hovertemplate: `${name}<br>δ_max = %{x:.3f} mm${m.incomplete ? ' (end of data: detachment incomplete)' : ''}<extra></extra>` } as Data);
      if (m.fit) {
        const x0 = -m.fit.b / m.fit.k; // T = 0
        const x1 = (0.8 * m.fmaxN - m.fit.b) / m.fit.k;
        traces.push({ type: 'scatter', mode: 'lines', x: [x0, x1], y: [0, 0.8 * m.fmaxN], legendgroup: name, showlegend: false, line: { color, width: 1.6, dash: 'dash' }, hovertemplate: `${name}<br>k = ${m.fit.k.toFixed(4)} N/mm (fit ${TACK_DEFAULTS.slopeFrom * 100}–${TACK_DEFAULTS.slopeTo * 100}% F_max)<extra></extra>` } as Data);
      }
      if (m.plateau) {
        traces.push({ type: 'scatter', mode: 'lines', x: [m.plateau.fromMm, m.plateau.toMm], y: [m.plateau.levelN, m.plateau.levelN], legendgroup: name, showlegend: false, line: { color, width: 1.4, dash: 'dot' }, hovertemplate: `${name}<br>Plateau ${m.plateau.stressKPa.toFixed(2)} kPa over ${m.plateau.lengthMm.toFixed(2)} mm<extra></extra>` } as Data);
      }
    });
    const lay: Partial<Layout> = {
      ...figLayout(),
      xaxis: figAxis('δ from tensile onset (mm)'),
      yaxis: figAxis('Tensile force F (N)'),
      legend: { x: 1.01, y: 1, font: { size: 14 } },
      hovermode: 'closest',
      uirevision: repeat.fileId,
    };
    return { data: traces, layout: lay };
  }, [repeat]);
  const save = async (format: 'png' | 'svg') => {
    if (!plotEl.current) return;
    const Plotly = await loadPlotly();
    await Plotly.downloadImage(plotEl.current, { format, filename: `tack_${repeat.name.replace(/[^\w.-]+/g, '_')}`, ...EXPORT_SIZE, scale: format === 'png' ? 4 : 1 } as never);
  };
  return (
    <>
      <div className="table-actions">
        <span className="note">▲ F_max at δ_peak · × δ_max (F ≤ {TACK_DEFAULTS.endFraction * 100}% F_max; open × = end of data) · dashed = fitted initial slope k · dotted = plateau</span>
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
  const [allH0, setAllH0] = useState<number | null>(null);
  const d = t.diameter;
  const area = d > 0 ? (Math.PI * d * d) / 4 : NaN;
  const setDiameter = (v: number) => update((p) => ({ ...p, settings: { ...p.settings, probe: { ...p.settings.probe, diameterMm: v } } }));
  if (!t.repeats.length) return <p className="note pad">Open your probe-tack files and choose a charge ratio and concentration on the left.</p>;
  const plotRepeat = t.repeats.find((r) => r.fileId === plotId) ?? t.repeats.find((r) => r.included) ?? t.repeats[0];
  const sessions = [...new Set(t.repeats.map((r) => r.session))];
  const excludedRepeats = t.repeats.filter((r) => r.excluded);
  const excludedSessions = sessions.filter((s) => t.tm.excludedSessions[s]);

  const runRows = () => [
    ['Repeat (file)', 'Path', 'Session', 'Substrate', 'Dwell (s)', 'h0 (mm)', 'Excluded', 'Run', ...TACK_METRICS.map((k) => `${k.label} (${k.unit})`), 'Detachment', 'Flags'],
    ...t.repeats.flatMap((rp) =>
      rp.runs.map((r) => [rp.name, rp.file.path, rp.session, rp.substrateLabel, rp.dwellS, rp.h0, rp.included ? '' : 'yes', r.cycle.cycleNumber, ...TACK_METRICS.map((k) => (r.m.ok ? k.get(r.m) : null)), r.m.ok ? r.m.detachment : '', flagsOf(r.m).slice(1).join('; ') || (r.m.ok ? '' : r.m.error)]),
    ),
  ];
  const summaryRows = () => [
    ['Per Repeat (mean ± SD over runs)'],
    ['Repeat (file)', 'Substrate', 'Dwell (s)', 'Excluded', 'Runs', ...TACK_METRICS.flatMap((k) => [`${k.label} mean (${k.unit})`, `${k.label} SD (${k.unit})`])],
    ...t.repeats.map((rp) => [rp.name, rp.substrateLabel, rp.dwellS, rp.included ? '' : 'yes', rp.runs.filter((r) => r.m.ok).length, ...TACK_METRICS.flatMap((k) => { const s = t.repeatStats.get(rp.fileId)![k.key]; return [s.mean, s.sd]; })]),
    [],
    ['Per condition (substrate × dwell): mean ± SD over the Repeat means of included Repeats'],
    ['Substrate', 'Dwell (s)', 'Repeats', 'Runs', ...TACK_METRICS.flatMap((k) => [`${k.label} mean (${k.unit})`, `${k.label} SD (${k.unit})`])],
    ...t.conditions.map((c) => [c.substrate, c.dwellS, c.nRepeats, c.nRuns, ...TACK_METRICS.flatMap((k) => [c.stats[k.key].mean, c.stats[k.key].sd])]),
    [],
    ['Probe diameter (mm)', d, 'A (mm²)', area],
    ['Excluded Repeats'], ...excludedRepeats.map((r) => [r.name, r.excluded!.reason]),
    ['Excluded sessions'], ...excludedSessions.map((s) => [s, t.tm.excludedSessions[s].reason]),
  ];
  const base = `${project.name || 'tack'}_CR${t.ex.chargeRatio}_${t.ex.concentrationM}M`.replace(/[^\w.-]+/g, '_');

  return (
    <div className="ls-results tack-metrics">
      <p className="note">
        Charge ratio <strong>{t.ex.chargeRatio}</strong>, <strong>{t.ex.concentrationM} M</strong> (chosen on the left): every substrate and dwell time. Metrics use the tensile part of
        each pull. Exclusion is per whole Repeat (file) or test session only; single runs and points are never excluded here.
      </p>

      <h3 className="ls-h">Inputs</h3>
      <div className="table-actions">
        <NumberField label="Probe diameter d (mm)" value={d > 0 ? d : null} positive onCommit={(v) => v !== null && setDiameter(v)} title="A = π d² / 4" />
        <span className="note">A = π d²/4 = {fmt(area, 3)} mm²</span>
        <NumberField label="Set h₀ for all Repeats (mm)" value={allH0} positive allowEmpty placeholder="mm" onCommit={setAllH0} />
        <button className="small" disabled={allH0 === null} onClick={() => t.setH0(t.repeats.map((r) => r.fileId), allH0)}>Apply to all</button>
      </div>
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr><th>Exclude</th><th>Repeat (file)</th><th>Session</th><th>Substrate</th><th className="num">Dwell (s)</th><th>h₀ (mm)</th><th className="num">Runs</th><th>Reason (if excluded)</th></tr>
          </thead>
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
                <td>{rp.excluded && <input className="reason" value={rp.excluded.reason} placeholder="reason (required)" onChange={(e) => t.excludeRepeat(rp.fileId, true, e.target.value)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sessions.length > 0 && (
        <div className="table-actions">
          <span>Exclude a whole test session:</span>
          {sessions.map((s) => (
            <label key={s} className="check">
              <input type="checkbox" checked={!!t.tm.excludedSessions[s]} onChange={(e) => t.excludeSession(s, e.target.checked, t.tm.excludedSessions[s]?.reason ?? '')} /> {s}
            </label>
          ))}
        </div>
      )}

      <div className="excluded-list">
        <strong>Excluded data sets</strong>
        {!excludedRepeats.length && !excludedSessions.length ? (
          <span className="note"> none</span>
        ) : (
          <ul>
            {excludedSessions.map((s) => (
              <li key={s}>Session {s}: <input className="reason" value={t.tm.excludedSessions[s].reason} placeholder="reason (required)" onChange={(e) => t.excludeSession(s, true, e.target.value)} /></li>
            ))}
            {excludedRepeats.map((r) => (
              <li key={r.fileId}>Repeat {r.name}: <input className="reason" value={r.excluded!.reason} placeholder="reason (required)" onChange={(e) => t.excludeRepeat(r.fileId, true, e.target.value)} /></li>
            ))}
          </ul>
        )}
      </div>

      <h3 className="ls-h">F vs δ</h3>
      <label className="field inline">
        <span>Repeat</span>
        <select value={plotRepeat.fileId} onChange={(e) => setPlotId(e.target.value)}>
          {t.repeats.map((r) => <option key={r.fileId} value={r.fileId}>{r.substrateLabel} · {r.dwellS ?? '—'} s · {r.name}</option>)}
        </select>
      </label>
      <TackPlot repeat={plotRepeat} />

      <div className="table-actions">
        <h3 className="ls-h">Per run</h3>
        <button className="small" onClick={() => saveCsv(runRows(), `${base}_tack_runs.csv`)}>Export CSV</button>
      </div>
      <div className="table-scroll">
        <table className="grid">
          <thead>
            <tr>
              <th>Repeat</th><th>Run</th><th>Substrate</th><th className="num">Dwell (s)</th>
              {TACK_METRICS.map((k) => <th key={k.key} className="num">{k.label} ({k.unit})</th>)}
              <th>Detachment</th><th>Flags</th>
            </tr>
          </thead>
          <tbody>
            {t.repeats.flatMap((rp) =>
              rp.runs.map((r) => (
                <tr key={r.id} className={rp.included ? '' : 'excluded-row'}>
                  <td title={rp.file.path}>{rp.name}{rp.included ? '' : ' (excluded)'}</td>
                  <td>{r.cycle.cycleNumber}</td>
                  <td>{rp.substrateLabel}</td>
                  <td className="num">{rp.dwellS ?? '—'}</td>
                  {TACK_METRICS.map((k) => <td key={k.key} className="num">{r.m.ok ? fmt(k.get(r.m), k.digits) : '—'}</td>)}
                  <td>{r.m.ok ? r.m.detachment : '—'}</td>
                  <td className={r.m.incomplete || !r.m.ok ? 'warn-text' : ''}>{flagsOf(r.m).slice(r.m.ok ? 1 : 0).join('; ')}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>

      <div className="table-actions">
        <h3 className="ls-h">Mean ± SD per Repeat (over its runs)</h3>
        <button className="small" onClick={() => saveCsv(summaryRows(), `${base}_tack_summary.csv`)}>Export CSV</button>
      </div>
      <div className="table-scroll">
        <table className="grid">
          <thead><tr><th>Repeat</th><th>Substrate</th><th className="num">Dwell (s)</th><th className="num">Runs</th>{TACK_METRICS.map((k) => <th key={k.key} className="num">{k.label} ({k.unit})</th>)}</tr></thead>
          <tbody>
            {t.repeats.map((rp) => (
              <tr key={rp.fileId} className={rp.included ? '' : 'excluded-row'}>
                <td>{rp.name}{rp.included ? '' : ' (excluded)'}</td><td>{rp.substrateLabel}</td><td className="num">{rp.dwellS ?? '—'}</td><td className="num">{rp.runs.filter((r) => r.m.ok).length}</td>
                {TACK_METRICS.map((k) => <td key={k.key} className="num">{ms(t.repeatStats.get(rp.fileId)![k.key], k.digits)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="ls-h">Mean ± SD per condition (substrate × dwell; over the means of the included Repeats)</h3>
      <div className="table-scroll">
        <table className="grid">
          <thead><tr><th>Condition</th><th className="num">Repeats</th><th className="num">Runs</th>{TACK_METRICS.map((k) => <th key={k.key} className="num">{k.label} ({k.unit})</th>)}</tr></thead>
          <tbody>
            {t.conditions.map((c: GroupStat) => (
              <tr key={c.key}>
                <td className="strong">{c.label}</td><td className="num">{c.nRepeats}</td><td className="num">{c.nRuns}</td>
                {TACK_METRICS.map((k) => <td key={k.key} className="num">{ms(c.stats[k.key], k.digits)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <TackMethods />
    </div>
  );
}
