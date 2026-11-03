import { useState } from 'react';
import { useLapShear, type LapShearRun } from '../../state/lapShear';
import { FAILURE_MODE_LABEL, INTEGRATION_LABEL, SUMMARY_PROPERTIES, describe } from '../../analysis/lapShear';
import type { FailureMode, LapShearDims } from '../../types';
import { fmt } from '../common';
import { CURVE_COLORS } from '../../plotting/colors';
import { NumberField } from './NumberField';

const MODES = Object.keys(FAILURE_MODE_LABEL) as FailureMode[];

/** Mean ± SD (n) for display. */
function ms(values: number[], d: number): string {
  const s = describe(values);
  if (!s.n) return '—';
  return `${fmt(s.mean, d)} ± ${s.n > 1 ? fmt(s.sd, d) : '—'} (n = ${s.n})`;
}
const DIGITS: Record<string, number> = { gf: 2, N: 4, kPa: 3, MPa: 6, mm: 3, s: 2, mJ: 3, 'J/m²': 2 };

function ApplyAll({ ids }: { ids: string[] }) {
  const { ls, setMeta } = useLapShear();
  const [d, setD] = useState<LapShearDims>(ls.settings.defaults);
  return (
    <div className="apply-all">
      <strong>Set dimensions for all {ids.length} selected run(s):</strong>
      <NumberField label="Length (mm)" value={d.lengthMm} positive onCommit={(v) => setD({ ...d, lengthMm: v ?? d.lengthMm })} />
      <NumberField label="Width (mm)" value={d.widthMm} positive onCommit={(v) => setD({ ...d, widthMm: v ?? d.widthMm })} />
      <NumberField label="Thickness (mm)" value={d.thicknessMm} positive onCommit={(v) => setD({ ...d, thicknessMm: v ?? d.thicknessMm })} />
      <button className="small" disabled={!ids.length} onClick={() => setMeta(ids, d)}>Apply</button>
    </div>
  );
}

function RunRow({ r, color }: { r: LapShearRun; color: string }) {
  const { setMeta } = useLapShear();
  const res = r.result;
  const m = r.meta;
  const p = res.peak;
  const note = [res.directionNote, res.baseline.note, res.failure.note, ...res.warnings].filter(Boolean).join('\n');
  return (
    <tr>
      <td className="sticky-col" title={r.file.path}>
        <span className="run-dot" style={{ background: color }} />
        {r.label}
        {res.warnings.length > 0 && <span className="warn-mark" title={note}> ⚠</span>}
        <div className="cond">{r.condition}</div>
      </td>
      <td><NumberField compact value={m.lengthMm} positive label="Overlap length (mm)" onCommit={(v) => v !== null && setMeta([r.id], { lengthMm: v })} /></td>
      <td><NumberField compact value={m.widthMm} positive label="Overlap width (mm)" onCommit={(v) => v !== null && setMeta([r.id], { widthMm: v })} /></td>
      <td><NumberField compact value={m.thicknessMm} positive label="Gel thickness (mm)" onCommit={(v) => v !== null && setMeta([r.id], { thicknessMm: v })} /></td>
      <td className="num">{fmt(res.areaMm2, 1)}</td>
      <td className="num strong">{fmt(p?.forceGf, 2)}</td>
      <td className="num">{fmt(p?.forceN, 4)}</td>
      <td className="num strong">{fmt(res.strengthKPa, 3)}</td>
      <td className="num">{fmt(res.strengthMPa, 6)}</td>
      <td className="num">{fmt(p?.dispMm, 3)}</td>
      <td className="num">{fmt(p?.timeS, 2)}</td>
      <td className="num">{fmt(res.work.fullMJ, 3)}</td>
      <td className="num">{fmt(res.work.toPeakMJ, 3)}</td>
      <td className="num">{fmt(res.work.postPeakMJ, 3)}</td>
      <td className="num strong">{fmt(res.work.selectedMJ, 3)}</td>
      <td className="num">{fmt(res.work.selectedPerAreaJm2, 2)}</td>
      <td className="num">{fmt(res.work.fullPerAreaJm2, 2)}</td>
      <td>
        <select value={m.failureMode} onChange={(e) => setMeta([r.id], { failureMode: e.target.value as FailureMode })} aria-label={`Failure mode of ${r.label}`}>
          {MODES.map((k) => <option key={k} value={k}>{FAILURE_MODE_LABEL[k]}</option>)}
        </select>
      </td>
      <td title={res.failure.note}>
        <NumberField
          compact
          allowEmpty
          min={0}
          value={m.manualFailureMm}
          placeholder={res.failure.source === 'auto' && res.failure.dispMm !== null ? `${fmt(res.failure.dispMm, 3)} auto` : 'not found'}
          label="Failure displacement (mm), empty = automatic"
          onCommit={(v) => setMeta([r.id], { manualFailureMm: v })}
        />
      </td>
      <td className="num">{fmt(res.work.toFailureMJ, 3)}</td>
      <td className="num">{res.nValid.toLocaleString()}</td>
    </tr>
  );
}

export function LapShearResults() {
  const { ls, selected } = useLapShear();
  const ok = selected.filter((r) => r.result.ok);
  const s = ls.settings;
  const conditions = [...new Set(ok.map((r) => r.condition))];

  if (!selected.length) return <p className="note pad">Tick runs in step 2 on the left to see their results.</p>;

  return (
    <div className="ls-results">
      <ApplyAll ids={ok.map((r) => r.id)} />
      <p className="note">
        Selected integration: <strong>{INTEGRATION_LABEL[s.integration.mode]}</strong>
        {s.integration.mode === 'custom' ? ` (${s.integration.fromMm}–${s.integration.toMm} mm)` : ''} · baseline correction{' '}
        <strong>{s.baseline.enabled ? 'ON' : 'off'}</strong> · complete failure {s.failure.auto ? `when force < ${(s.failure.fraction * 100).toFixed(1)}% of peak for ${s.failure.consecutive} points` : 'only when picked by hand'}.
        Type a failure displacement to set it by hand; clear the box to go back to the automatic value. Hover ⚠ for data-quality notes.
      </p>
      <div className="table-scroll ls-table-wrap">
        <table className="grid ls-table">
          <thead>
            <tr>
              <th className="sticky-col">Run</th>
              <th>Overlap length (mm)</th><th>Overlap width (mm)</th><th>Gel thickness (mm)</th><th className="num">Bonded area (mm²)</th>
              <th className="num">Peak force (gf)</th><th className="num">Peak force (N)</th>
              <th className="num" title="Apparent nominal lap-shear strength = peak force / bonded area">τ app. (kPa)</th><th className="num">τ app. (MPa)</th>
              <th className="num">Displ. at peak (mm)</th><th className="num">Time at peak (s)</th>
              <th className="num">Full-curve work (mJ)</th><th className="num">Work to peak (mJ)</th><th className="num">Post-peak work (mJ)</th>
              <th className="num">Selected work (mJ)</th><th className="num">Selected work / area (J/m²)</th><th className="num">Full work / area (J/m²)</th>
              <th>Failure mode</th><th>Failure displ. (mm)</th><th className="num">Work to failure (mJ)</th><th className="num">Valid points</th>
            </tr>
          </thead>
          <tbody>
            {selected.map((r) =>
              r.result.ok ? (
                <RunRow key={r.id} r={r} color={CURVE_COLORS[ok.indexOf(r) % CURVE_COLORS.length]} />
              ) : (
                <tr key={r.id}><td className="sticky-col">{r.label}</td><td colSpan={20} className="run-error">{r.result.error}</td></tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <h3 className="ls-h">Summary of the selected runs (mean ± sample SD)</h3>
      <p className="note">
        Strength and work per area are calculated for each run with its own bonded area, then averaged. Runs on the same specimen are not independent replicates.
      </p>
      <div className="table-scroll">
        <table className="grid ls-summary">
          <thead>
            <tr>
              <th>Property</th>
              <th className="num">All selected runs</th>
              {conditions.length > 1 && conditions.map((c) => <th key={c} className="num">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {SUMMARY_PROPERTIES.map((p) => (
              <tr key={p.key}>
                <td>{p.label} ({p.unit})</td>
                <td className="num">{ms(ok.map((r) => p.get(r.result)), DIGITS[p.unit] ?? 3)}</td>
                {conditions.length > 1 && conditions.map((c) => <td key={c} className="num">{ms(ok.filter((r) => r.condition === c).map((r) => p.get(r.result)), DIGITS[p.unit] ?? 3)}</td>)}
              </tr>
            ))}
            <tr>
              <td>Failure modes</td>
              <td className="num">{MODES.map((k) => `${FAILURE_MODE_LABEL[k]}: ${ok.filter((r) => r.meta.failureMode === k).length}`).join(' · ')}</td>
              {conditions.length > 1 && conditions.map((c) => <td key={c} className="num">{MODES.filter((k) => k !== 'unspecified').map((k) => `${FAILURE_MODE_LABEL[k]} ${ok.filter((r) => r.condition === c && r.meta.failureMode === k).length}`).join(' · ')}</td>)}
            </tr>
          </tbody>
        </table>
      </div>

      <div className="ls-definitions note">
        <p><strong>Apparent nominal lap-shear strength</strong> τ = F<sub>max</sub> / A, with A = overlap length × width (gel thickness does not enter). It is the average stress at peak load over the original bonded area, not the maximum local stress in the joint.</p>
        <p><strong>Work</strong> W = ∫ F dδ by the trapezoidal rule (1 N·mm = 1 mJ), counted only where the stage moves beyond all earlier displacement, so small backward steps neither cancel nor double-count work. Full-curve work = work to peak + post-peak work.</p>
        <p><strong>Work per bonded area</strong> W / A (J/m²) is apparent mechanical work per bonded area. It can include elastic deformation, viscoelastic dissipation, cohesive damage, interfacial separation, frictional sliding after failure and fixture compliance, so it is not labelled adhesion energy or fracture toughness.</p>
        <p><strong>Failure mode</strong> is your observation of the specimen; it is never inferred from the curve.</p>
      </div>
    </div>
  );
}
