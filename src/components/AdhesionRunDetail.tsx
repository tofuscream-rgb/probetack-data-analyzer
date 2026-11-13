import { useMemo, useState, type ReactNode } from 'react';
import type { Data, Layout } from 'plotly.js';
import { useApp } from '../state/AppContext';
import { PlotlyChart } from '../plotting/PlotlyChart';
import type { LapShearResult } from '../analysis/lapShear';
import { conditionTitle, type AnalysisRow } from '../analysis/adhesionReview';
import { GF_TO_N, type Cycle, type ParsedFile } from '../types';
import { fmt } from './common';
import { MetadataEditor } from './DataAnalysis';

export interface DetailRun {
  file: ParsedFile;
  cycle: Cycle;
  /** Shared force–displacement analysis of the run (series, peak, warnings). */
  curve: LapShearResult;
  /** Displacement where the run failed or detached, if known. */
  endMm: number | null;
  endLabel: string;
  /** Test-specific facts (dimensions, window, …) shown under Metadata. */
  facts: [string, ReactNode][];
}

/**
 * Details of one Lap Shear or 90° Peel run, opened by clicking a row in Data analysis — the same
 * panel as Probe Tack: status, the curve, notes, metadata read from the file (date, load cell,
 * filter, movement), metadata corrections and the point data.
 */
export function AdhesionRunDetail({ row, run, included, overridden, onInclude, onReset, primary, onClose }: {
  row: AnalysisRow;
  run: DetailRun;
  included: boolean;
  overridden: boolean;
  onInclude: (on: boolean) => void;
  onReset: () => void;
  primary: { label: string; digits: number };
  onClose: () => void;
}) {
  const { meta } = useApp();
  const m = meta.get(run.file.fileId);
  const h = run.file.header;
  const c = run.cycle;
  const notes = row.note ? row.note.split(' · ') : [];
  return (
    <aside className="run-detail" aria-label="Run details">
      <div className="detail-head">
        <h3 className="cycle-title">{run.file.name} <span>Repeat {m?.repeat.value ?? '—'}, Run {c.cycleNumber}</span></h3>
        <button className="icon" onClick={onClose} aria-label="Close details">×</button>
      </div>
      <p className="path">{run.file.path} · {conditionTitle(row)}</p>
      <div className="detail-status">
        <span className={`status-label ${included ? 'in' : 'out'}`}>{included ? 'Included in average' : 'Left out of the average'}</span>
        <label className="check-row">
          <input type="checkbox" checked={included} disabled={!Number.isFinite(row.primary)} onChange={(e) => onInclude(e.target.checked)} /> In average
        </label>
        {overridden && <button className="link small" onClick={onReset}>Reset</button>}
        <p className="note">{!Number.isFinite(row.primary) ? 'No valid measurement: this run cannot be averaged.' : overridden ? 'Your choice in Data analysis.' : 'Every valid run is included until you untick it.'}</p>
      </div>
      <p className="big-number">{fmt(row.primary, primary.digits)} <span>N</span> <small>{primary.label}</small> <small>{fmt(row.primary / GF_TO_N, 2)} gf</small></p>
      <DetailCurve run={run} />

      <h4>Notes</h4>
      {notes.length === 0 ? <p className="note ok">No issues found for this run.</p> : <ul className="flags">{notes.map((n) => <li key={n}><span className="qc-dot yellow" /> {n}</li>)}</ul>}
      {row.incomplete && <p className="note warn">No separation was detected: work is integrated to the end of the recording.</p>}

      <h4>Metadata</h4>
      <dl className="meta-grid">
        <dt>Charge ratio</dt><dd>{m?.chargeRatio.value ?? '—'} <small>{m?.chargeRatio.source}</small></dd>
        <dt>Concentration</dt><dd>{m?.concentrationM.value ?? '—'} M <small className={m?.concentrationM.source === 'default' ? 'warn' : ''}>{m?.concentrationM.source}</small></dd>
        <dt>Substrate</dt><dd>{m?.substrate.value ?? '—'} <small>{m?.substrate.source}</small></dd>
        {m?.gel.value && <><dt>Gel</dt><dd>{m.gel.value} <small>{m.gel.source}</small></dd></>}
        <dt>Dwell time</dt><dd>{row.cond.hold === '—' ? '—' : `${row.cond.hold} s`} <small>{c.holdTimeS !== null ? 'from Wait block' : row.cond.hold !== '—' ? 'from file name' : ''}</small></dd>
        <dt>Repeat</dt><dd>{m?.repeat.value ?? '—'}</dd>
        {run.facts.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}
        <dt>Movement</dt><dd>{c.operation}, {c.amplitudeMm ?? '—'} mm at {c.velocityMmS ?? '—'} mm/s{c.stageAxis ? ` (${c.stageAxis})` : ''}</dd>
        <dt>Recorded</dt><dd>{c.date ?? '—'}{c.time ? `, ${c.time}` : ''}</dd>
        <dt>Instrument</dt><dd>{[h['Mach-1 System Model'], h['Mach-1 System S/N'] && `S/N ${h['Mach-1 System S/N']}`, h['Mach-1 Motion Software Version'] && `software ${h['Mach-1 Motion Software Version']}`].filter(Boolean).join(', ') || '—'}</dd>
        <dt>Load cell</dt><dd>{h['Load Cell Name'] ?? '—'}{h['Load Cell Type'] ? ` (${h['Load Cell Type']})` : ''}, calibration factor {h['Load Cell Calibration Factor'] ?? '—'}{h['Load Cell Calibration Date'] ? `, calibrated ${h['Load Cell Calibration Date']}` : ''}</dd>
        <dt>Instrument filter</dt><dd>{h['Load Cell Low-pass filter'] === 'Yes' ? `Low-pass, order ${h['Load Cell Low-pass filter Order']}, ${h['Load Cell Low-pass filter Cutoff frequency (Hz)']} Hz` : h['Load Cell Low-pass filter'] ?? '—'}</dd>
        <dt>Points</dt><dd>{run.curve.nValid.toLocaleString()} valid of {run.curve.nPoints.toLocaleString()}</dd>
      </dl>
      {m?.concentrationM.source === 'default' && <p className="note warn">Concentration is the default 2.1 M. If this dataset differs, correct it below.</p>}
      <details className="section" open={m?.concentrationM.source === 'default'}>
        <summary>Correct metadata</summary>
        <MetadataEditor r={run} />
      </details>
      <details className="section">
        <summary>Point data</summary>
        <SimplePointTable run={run} />
      </details>
    </aside>
  );
}

function FactRow({ k, v }: { k: string; v: ReactNode }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

/** Loading force (N) vs displacement with the peak and the failure / detachment point. */
function DetailCurve({ run }: { run: DetailRun }) {
  const { data, layout } = useMemo(() => {
    const s = run.curve.series;
    const x: number[] = [];
    const y: number[] = [];
    const step = Math.max(1, Math.floor(s.dispMm.length / 3000));
    for (let i = 0; i < s.dispMm.length; i += step) { x.push(s.dispMm[i]); y.push(s.loadGf[i] * GF_TO_N); }
    const traces: Data[] = [{ type: 'scatter', mode: 'lines', x, y, line: { color: '#1F4E9C', width: 1.6 }, hovertemplate: 'δ = %{x:.3f} mm<br>F = %{y:.4f} N<extra></extra>' } as unknown as Data];
    const pk = run.curve.peak;
    if (pk) traces.push({ type: 'scatter', mode: 'markers', x: [pk.dispMm], y: [pk.forceN], marker: { symbol: 'triangle-up', size: 11, color: '#1F4E9C', line: { color: '#18263A', width: 1 } }, hovertemplate: 'Peak %{y:.4f} N<extra></extra>' } as unknown as Data);
    const shapes = run.endMm !== null ? [{ type: 'line', xref: 'x', yref: 'paper', x0: run.endMm, x1: run.endMm, y0: 0, y1: 1, line: { color: '#C62828', width: 1.2, dash: 'dash' } }] : [];
    const lay: Partial<Layout> = {
      margin: { l: 56, r: 8, t: 8, b: 40 },
      font: { family: 'IBM Plex Sans, system-ui, sans-serif', size: 11, color: '#18263A' },
      showlegend: false,
      xaxis: { title: { text: 'Displacement δ (mm)' }, zerolinecolor: '#C9D2DD', gridcolor: '#EEF2F6' },
      yaxis: { title: { text: 'Loading force (N)' }, zerolinecolor: '#C9D2DD', gridcolor: '#EEF2F6' },
      shapes: shapes as Layout['shapes'],
      annotations: run.endMm !== null ? [{ x: run.endMm, y: 1, xref: 'x', yref: 'paper', text: run.endLabel, showarrow: false, xanchor: 'left', yanchor: 'top', font: { size: 10, color: '#C62828' } }] : [],
      hovermode: 'closest',
    };
    return { data: traces, layout: lay };
  }, [run]);
  return <PlotlyChart data={data} layout={layout} className="plot detail" config={{ displayModeBar: false }} />;
}

/** The recorded values of the run (first 3000 points; the Excel export holds the analysis). */
function SimplePointTable({ run }: { run: DetailRun }) {
  const [limit, setLimit] = useState(500);
  const c = run.cycle;
  const s = run.curve.series;
  const n = c.force_gf.length;
  const rows = Array.from({ length: Math.min(n, limit) }, (_, i) => i);
  return (
    <>
      <div className="table-scroll point-scroll">
        <table className="grid dense">
          <thead><tr><th>#</th><th>Time (s)</th><th>z (mm)</th><th title="Exactly as in the TXT file">Fz as recorded (gf)</th><th>δ (mm)</th><th>Loading force (N)</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i}>
                <td className="num">{i}</td>
                <td className="num">{c.time_s[i]?.toFixed(3)}</td>
                <td className="num">{c.z_mm[i]?.toFixed(5)}</td>
                <td className="num">{c.force_gf[i]?.toFixed(3)}</td>
                <td className="num">{Number.isFinite(s.dispMm[i]) ? s.dispMm[i].toFixed(4) : '—'}</td>
                <td className="num">{Number.isFinite(s.loadGf[i]) ? (s.loadGf[i] * GF_TO_N).toFixed(5) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">
        {rows.length} of {n} points.{' '}
        {rows.length < n && <button className="link small" onClick={() => setLimit((l) => Math.min(n, l + 2000))}>Show more</button>}
      </p>
    </>
  );
}
