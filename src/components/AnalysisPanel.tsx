import { useMemo, useState, type ReactNode } from 'react';
import { useApp } from '../state/AppContext';
import { GROUP_LABEL, type CycleResult } from '../analysis/engine';
import { DISPLACEMENT_LABEL, PEAK_LABEL, unitFactor, type Metrics } from '../analysis/cycleMetrics';
import { QC_LABEL, QC_ORDER, explainPoint } from '../analysis/pointOutliers';
import type { AnalysisSettings, GroupKey, MetaOverride, PeakMetric } from '../types';
import { defaultSettings } from '../state/defaults';

const fmt = (v: number | null | undefined, d = 3) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));

function Num({ label, value, onChange, step = 0.1, min, max, help }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; help?: string }) {
  return (
    <label className="field" title={help}>
      <span>{label}</span>
      <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </label>
  );
}

function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="section" open={open}>
      <summary>{title}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function MetricsTable({ raw, proc, u }: { raw: Metrics; proc: Metrics; u: 'gf' | 'N' }) {
  const f = unitFactor(u);
  const rows: [string, number | null, number | null, number?][] = [
    [`Minimum (${u})`, raw.min * f, proc.min * f],
    [`Maximum (${u})`, raw.max * f, proc.max * f],
    [`Peak magnitude (${u})`, raw.absPeak * f, proc.absPeak * f],
    [`Mean (${u})`, raw.mean * f, proc.mean * f],
    [`SD (${u})`, raw.sd * f, proc.sd * f],
    ['Points', raw.n, proc.n, 0],
    ['Time at min (s)', raw.tAtMin, proc.tAtMin],
    ['Time at max (s)', raw.tAtMax, proc.tAtMax],
    ['Z at min (mm)', raw.zAtMin, proc.zAtMin, 4],
    ['Displacement at min (mm)', raw.dispAtMin, proc.dispAtMin, 4],
    [`Baseline (${u})`, raw.baseline === null ? null : raw.baseline * f, proc.baseline === null ? null : proc.baseline * f],
    [`Baseline-corrected min (${u})`, raw.baselineMin === null ? null : raw.baselineMin * f, proc.baselineMin === null ? null : proc.baselineMin * f],
  ];
  return (
    <table className="metrics">
      <thead>
        <tr><th /><th>Raw</th><th>Processed</th></tr>
      </thead>
      <tbody>
        {rows.map(([l, a, b, d]) => (
          <tr key={l} className={a !== b && Number.isFinite(a) ? 'diff' : ''}>
            <th>{l}</th>
            <td>{fmt(a, d ?? (u === 'N' ? 5 : 3))}</td>
            <td>{fmt(b, d ?? (u === 'N' ? 5 : 3))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CycleTab({ r }: { r: CycleResult }) {
  const { project, update } = useApp();
  const [reason, setReason] = useState('');
  const s = project.settings;
  const id = r.cycle.cycleId;
  const manual = project.excludedPoints[id] ?? {};
  const flaggedPts = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < r.points.cls.length; i++) if (r.points.cls[i] > 0 || manual[String(i)]) out.push(i);
    return out;
  }, [r, manual]);
  const m = r.meta;
  const h = r.file.header;

  const toggleCycle = () =>
    update((p) => {
      const ec = { ...p.excludedCycles };
      if (ec[id]) delete ec[id];
      else ec[id] = { reason: reason.trim() || 'Excluded after review', at: new Date().toISOString() };
      return { ...p, excludedCycles: ec };
    });
  const togglePoint = (i: number) =>
    update((p) => {
      const cur = { ...(p.excludedPoints[id] ?? {}) };
      if (cur[String(i)]) delete cur[String(i)];
      else cur[String(i)] = { reason: `Manual review (${QC_ORDER[r.points.cls[i]]} flag)`, at: new Date().toISOString() };
      const ep = { ...p.excludedPoints, [id]: cur };
      if (Object.keys(cur).length === 0) delete ep[id];
      return { ...p, excludedPoints: ep };
    });

  return (
    <div className="cycle-tab">
      <h3 className="cycle-title">
        {r.file.name} <span>cycle {r.cycle.cycleNumber}</span> <span className={`qc-pill ${r.qc}`}>{QC_LABEL[r.qc]}</span>
      </h3>
      <p className="path">{r.file.path}</p>
      <dl className="meta-grid">
        <dt>Charge ratio</dt><dd>{m.chargeRatio.value ?? '—'} <small>{m.chargeRatio.source}</small></dd>
        <dt>Concentration</dt><dd>{m.concentrationM.value} M <small className={m.concentrationM.source === 'default' ? 'warn' : ''}>{m.concentrationM.source}</small></dd>
        <dt>Gel</dt><dd>{m.gel.value ?? '—'}</dd>
        <dt>Substrate</dt><dd>{m.substrate.value ?? '—'} <small>{m.substrate.source}</small></dd>
        <dt>Holding time</dt><dd>{r.holdTimeS ?? '—'} s <small>{r.cycle.holdTimeS !== null ? 'from Wait block' : 'from file name'}</small></dd>
        <dt>Repeat file</dt><dd>{m.repeat.value}</dd>
        <dt>Movement</dt><dd>{r.cycle.operation}, {r.cycle.amplitudeMm ?? '—'} mm at {r.cycle.velocityMmS ?? '—'} mm/s</dd>
        <dt>Recorded</dt><dd>{r.cycle.date}, {r.cycle.time}</dd>
        <dt>Load cell</dt><dd>{h['Load Cell Name'] ?? '—'}, calibration factor {h['Load Cell Calibration Factor'] ?? '—'}</dd>
        <dt>Instrument filter</dt><dd>{h['Load Cell Low-pass filter'] === 'Yes' ? `Low-pass, order ${h['Load Cell Low-pass filter Order']}, ${h['Load Cell Low-pass filter Cutoff frequency (Hz)']} Hz` : h['Load Cell Low-pass filter'] ?? '—'}</dd>
      </dl>
      {m.concentrationM.source === 'default' && <p className="note warn">Concentration is the default 2.1 M. If this dataset differs (for example 2.5 M), correct it under Metadata.</p>}

      <h4>Peak ({PEAK_LABEL[s.peakMetric]})</h4>
      <p className="big-number">
        {fmt(r.peakProcessed * unitFactor(s.forceUnit), s.forceUnit === 'N' ? 5 : 2)} <span>{s.forceUnit}</span>
        {r.peakProcessed !== r.peakRaw && Number.isFinite(r.peakRaw) && <small> raw {fmt(r.peakRaw * unitFactor(s.forceUnit), 2)}</small>}
      </p>
      <MetricsTable raw={r.raw} proc={r.processed} u={s.forceUnit} />
      <p className="note">{r.baselineNote}</p>

      <h4>Quality checks</h4>
      {r.flags.filter((f) => f.cls !== 'green').length === 0 && <p className="note ok">No issues found for this cycle.{r.flags.length ? ' Notes:' : ''}</p>}
      <ul className="flags">
        {r.flags.map((f, i) => (
          <li key={i} className={f.cls}>
            <span className={`qc-dot ${f.cls}`} /> {f.message}
          </li>
        ))}
      </ul>

      <div className="exclude-box">
        {r.cycleExcluded ? (
          <>
            <p>Excluded from statistics: <em>{r.cycleExcluded.reason}</em></p>
            <button onClick={toggleCycle}>Include this cycle again</button>
          </>
        ) : (
          <>
            <input placeholder="Reason (recorded in exports)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Exclusion reason" />
            <button onClick={toggleCycle}>Exclude this cycle</button>
          </>
        )}
      </div>

      <h4>Flagged and excluded points ({flaggedPts.length})</h4>
      {flaggedPts.length === 0 ? (
        <p className="note">No points were flagged by Level A screening.</p>
      ) : (
        <ul className="point-list">
          {flaggedPts.slice(0, 200).map((i) => {
            const cls = QC_ORDER[r.points.cls[i]];
            const out = !!manual[String(i)];
            return (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={out} onChange={() => togglePoint(i)} /> exclude
                </label>
                <span className={`qc-dot ${cls}`} />
                <strong>#{i}</strong> t = {fmt(r.cycle.time_s[i], 2)} s
                <p>{explainPoint(r.points, i, r.cycle.force_gf, s.point)}</p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="note">Level A floor (force resolution) used: {fmt(r.points.floorUsed, 4)} gf.</p>
    </div>
  );
}

const COMPARE_KEYS: GroupKey[] = ['chargeRatio', 'concentrationM', 'gel', 'substrate', 'holdTimeS', 'amplitudeMm', 'velocityMmS'];

function SettingsTab() {
  const { project, update } = useApp();
  const s = project.settings;
  const set = (patch: Partial<AnalysisSettings>) => update((p) => ({ ...p, settings: { ...p.settings, ...patch } }));
  const setP = (patch: Partial<AnalysisSettings['point']>) => set({ point: { ...s.point, ...patch } });
  const setC = (patch: Partial<AnalysisSettings['cycle']>) => set({ cycle: { ...s.cycle, ...patch } });
  return (
    <div className="settings-tab">
      <Section title="Peak force and units">
        <label className="field">
          <span>Peak metric</span>
          <select value={s.peakMetric} onChange={(e) => set({ peakMetric: e.target.value as PeakMetric })}>
            {(Object.keys(PEAK_LABEL) as PeakMetric[]).map((k) => <option key={k} value={k}>{PEAK_LABEL[k]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Force unit</span>
          <select value={s.forceUnit} onChange={(e) => set({ forceUnit: e.target.value as 'gf' | 'N' })}>
            <option value="gf">gram-force (gf)</option>
            <option value="N">newton (N)</option>
          </select>
        </label>
        <p className="note">1 gf = 0.00980665 N. This is a unit conversion only; the load-cell calibration factor is already applied by the instrument.</p>
        <label className="field">
          <span>Relative displacement</span>
          <select value={s.displacementMode} onChange={(e) => set({ displacementMode: e.target.value as AnalysisSettings['displacementMode'] })}>
            {Object.entries(DISPLACEMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <p className="note">z₀ is the first recorded z of each movement. Check against Mach-1 Analysis before relying on equivalence.</p>
      </Section>
      <Section title="Baseline correction">
        <label className="field">
          <span>Baseline</span>
          <select value={s.baselineMode} onChange={(e) => set({ baselineMode: e.target.value as AnalysisSettings['baselineMode'] })}>
            <option value="none">Off (raw force)</option>
            <option value="holdMean">Mean of the end of the preceding hold</option>
            <option value="moveInterval">Mean of a time interval in the movement</option>
          </select>
        </label>
        {s.baselineMode === 'holdMean' && <Num label="Last seconds of hold" value={s.baselineHoldLastS} step={0.1} min={0.01} onChange={(v) => set({ baselineHoldLastS: v })} />}
        {s.baselineMode === 'moveInterval' && (
          <div className="pair">
            <Num label="From (s)" value={s.baselineInterval[0]} step={0.01} onChange={(v) => set({ baselineInterval: [v, s.baselineInterval[1]] })} />
            <Num label="To (s)" value={s.baselineInterval[1]} step={0.01} onChange={(v) => set({ baselineInterval: [s.baselineInterval[0], v] })} />
          </div>
        )}
        <p className="note">The baseline region is never chosen automatically. You can also use “Pick baseline” on a force-vs-time graph. Raw forces are kept; corrected values appear separately.</p>
      </Section>
      <Section title="Point screening (Level A)">
        <p className="note">Hampel-type rolling median with an isolation check. Scores are a 0–1 severity index for review, not probabilities. No smoothing or extra filtering is applied.</p>
        <div className="pair">
          <Num label="Half-window (points)" value={s.point.halfWindow} step={1} min={1} max={50} onChange={(v) => setP({ halfWindow: Math.round(v) })} />
          <Num label="Scale floor (gf, 0 = auto)" value={s.point.scaleFloorGf} step={0.05} min={0} onChange={(v) => setP({ scaleFloorGf: v })} />
        </div>
        <Num label="z at score 0.5 (zHalf)" value={s.point.zHalf} step={0.5} min={0.5} onChange={(v) => setP({ zHalf: v })} />
        <div className="pair three">
          <Num label="Yellow ≥" value={s.point.yellow} step={0.05} min={0} max={1} onChange={(v) => setP({ yellow: v })} />
          <Num label="Orange ≥" value={s.point.orange} step={0.05} min={0} max={1} onChange={(v) => setP({ orange: v })} />
          <Num label="Red ≥" value={s.point.red} step={0.05} min={0} max={1} onChange={(v) => setP({ red: v })} />
        </div>
      </Section>
      <Section title="Cycle screening (Level B)">
        <p className="note">Cycles are compared with others that share these conditions:</p>
        <div className="chips">
          {COMPARE_KEYS.map((k) => (
            <button key={k} className={`chip ${s.cycle.compareBy.includes(k) ? 'on' : ''}`} onClick={() => setC({ compareBy: s.cycle.compareBy.includes(k) ? s.cycle.compareBy.filter((x) => x !== k) : [...s.cycle.compareBy, k] })}>
              {GROUP_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="pair three">
          <Num label="|mod. Z| yellow" value={s.cycle.modZYellow} step={0.5} onChange={(v) => setC({ modZYellow: v })} />
          <Num label="orange" value={s.cycle.modZOrange} step={0.5} onChange={(v) => setC({ modZOrange: v })} />
          <Num label="red" value={s.cycle.modZRed} step={0.5} onChange={(v) => setC({ modZRed: v })} />
        </div>
        <div className="pair">
          <Num label="Min. cycles for mod. Z" value={s.cycle.minGroupSize} step={1} min={3} onChange={(v) => setC({ minGroupSize: Math.round(v) })} />
          <Num label="Weak if below (fraction)" value={s.cycle.weakFraction} step={0.05} min={0} max={1} onChange={(v) => setC({ weakFraction: v })} />
        </div>
        <div className="pair">
          <Num label="Missing peak (steps)" value={s.cycle.noPeakSteps} step={1} min={0} onChange={(v) => setC({ noPeakSteps: v })} />
          <Num label="Repeat difference" value={s.cycle.repeatDiffFraction} step={0.05} min={0} onChange={(v) => setC({ repeatDiffFraction: v })} />
        </div>
        <Num label="Start-position difference (mm, 0 = off)" value={s.cycle.startOffsetMm} step={0.1} min={0} onChange={(v) => setC({ startOffsetMm: v })} />
        <Num label="Incomplete if travel below (fraction)" value={s.cycle.completeFraction} step={0.01} min={0} max={1} onChange={(v) => setC({ completeFraction: v })} />
      </Section>
      <Section title="Processed data">
        <label className="field">
          <span>Automatic point exclusion</span>
          <select value={s.exclusionRule} onChange={(e) => set({ exclusionRule: e.target.value as AnalysisSettings['exclusionRule'] })}>
            <option value="keepAll">Keep all points</option>
            <option value="excludeRed">Exclude red points only</option>
            <option value="excludeYellowUp">Exclude yellow, orange and red points</option>
          </select>
        </label>
        <p className="note">Manual exclusions are added on top. Nothing is deleted; switch back any time.</p>
      </Section>
      <button className="link" onClick={() => update((p) => ({ ...p, settings: defaultSettings() }))}>
        Reset all settings to defaults
      </button>
    </div>
  );
}

function MetadataTab({ r }: { r: CycleResult | null }) {
  const { project, update, files, meta } = useApp();
  const [scope, setScope] = useState<'file' | 'folder'>('file');
  if (!r) return <p className="note">Select a cycle to edit the metadata of its file.</p>;
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
    ['gel', 'Gel / formulation', false],
    ['substrate', 'Substrate', false],
    ['nominalHoldS', 'Nominal holding time (s)', true],
    ['repeat', 'Repeat number', true],
  ];
  const ov = project.overrides[r.file.fileId] ?? {};
  return (
    <div className="metadata-tab">
      <p className="path">{r.file.path}</p>
      <div className="segmented small">
        <button className={scope === 'file' ? 'on' : ''} onClick={() => setScope('file')}>This file</button>
        <button className={scope === 'folder' ? 'on' : ''} onClick={() => setScope('folder')}>All {targets.length} file(s) in “{folder || '(top level)'}”</button>
      </div>
      {rows.map(([k, label, numeric]) => {
        const f = m[k] as { value: unknown; source: string };
        return (
          <label key={`${r.file.fileId}-${k}-${scope}`} className="field">
            <span>
              {label} <small className={f.source === 'default' ? 'warn' : ''}>{f.source}</small>
            </span>
            <input
              defaultValue={ov[k] !== undefined ? String(ov[k]) : ''}
              placeholder={f.value === null ? 'unknown' : String(f.value)}
              onBlur={(e) => setField(k, e.target.value, numeric)}
              inputMode={numeric ? 'decimal' : 'text'}
            />
          </label>
        );
      })}
      <p className="note">Leave a field empty to use the value read from the folder or file name (shown in grey). Corrections are saved with the project and listed in exports.</p>
      {m.notes.map((n, i) => <p key={i} className="note warn">{n}</p>)}
    </div>
  );
}

export function AnalysisPanel() {
  const { ui, setUi, derived } = useApp();
  const r = ui.focusId ? derived.results.get(ui.focusId) ?? null : null;
  return (
    <aside className="analysis-panel" aria-label="Analysis">
      <div className="panel-tabs" role="tablist">
        {(['cycle', 'settings', 'metadata'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={ui.rightTab === t} className={ui.rightTab === t ? 'tab active' : 'tab'} onClick={() => setUi({ rightTab: t })}>
            {t === 'cycle' ? 'Cycle' : t === 'settings' ? 'Settings' : 'Metadata'}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {ui.rightTab === 'cycle' && (r ? <CycleTab r={r} /> : <p className="note">Click a cycle in the navigator, the graph or the cycle table to see its values and quality checks.</p>)}
        {ui.rightTab === 'settings' && <SettingsTab />}
        {ui.rightTab === 'metadata' && <MetadataTab r={r} />}
      </div>
    </aside>
  );
}
