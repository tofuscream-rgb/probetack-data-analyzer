import { usePeel, type PeelRun } from '../../state/peel';
import { FAILURE_MODE_LABEL, INTEGRATION_LABEL, describe } from '../../analysis/lapShear';
import { PEEL_DEFINITIONS, PEEL_PROPERTIES } from '../../analysis/peel';
import type { FailureMode } from '../../types';
import { CURVE_COLORS } from '../../plotting/colors';
import { fmt } from '../common';
import { NumberField } from '../lapShear/NumberField';

const MODES = Object.keys(FAILURE_MODE_LABEL) as FailureMode[];

function ms(values: number[], d: number): string {
  const s = describe(values);
  if (!s.n) return '—';
  return `${fmt(s.mean, d)} ± ${s.n > 1 ? fmt(s.sd, d) : '—'} (n = ${s.n})`;
}

function Row({ r, color }: { r: PeelRun; color: string }) {
  const { setMeta } = usePeel();
  const x = r.result;
  const m = r.meta;
  const note = [x.window.note, x.detach.note, x.curve.directionNote, x.curve.baseline.requested ? x.curve.baseline.note : '', ...x.warnings].filter(Boolean).join('\n');
  return (
    <tr>
      <td className="sticky-col" title={r.file.path}>
        <span className="run-dot" style={{ background: color }} />
        {r.label}
        {x.warnings.length > 0 && <span className="warn-mark" title={note}> ⚠</span>}
        <div className="cond">{r.condition}</div>
      </td>
      <td><NumberField compact value={m.lengthMm} positive label="Gel length (mm)" onCommit={(v) => v !== null && setMeta([r.id], { lengthMm: v })} /></td>
      <td><NumberField compact value={m.widthMm} positive label="Gel width (mm)" onCommit={(v) => v !== null && setMeta([r.id], { widthMm: v })} /></td>
      <td><NumberField compact value={m.thicknessMm} positive label="Gel thickness (mm)" onCommit={(v) => v !== null && setMeta([r.id], { thicknessMm: v })} /></td>
      <td><NumberField compact value={m.angleDeg} positive label="Peel angle (°)" onCommit={(v) => v !== null && setMeta([r.id], { angleDeg: v })} /></td>
      <td className="num strong">{fmt(x.plateau.meanN, 4)}</td>
      <td className="num">{fmt(x.plateau.meanGf, 2)}</td>
      <td className="num">{fmt(x.plateau.sdN, 4)}</td>
      <td className="num">{fmt(x.plateau.cv * 100, 1)}</td>
      <td className="num">{fmt(x.plateau.minN, 3)}–{fmt(x.plateau.maxN, 3)}</td>
      <td className="num strong">{fmt(x.peelStrengthNm, 2)}</td>
      <td className="num">{fmt(x.peelStrengthNmm, 4)}</td>
      <td className="num strong">{fmt(x.toughnessJm2, 2)}</td>
      <td className="num">{fmt(x.peak?.forceN, 4)}</td>
      <td className="num">{fmt(x.peak?.forceGf, 2)}</td>
      <td className="num">{fmt(x.peak?.perWidthNm, 2)}</td>
      <td className="num">{fmt(x.peak?.dispMm, 2)}</td>
      <td className="num">{fmt(x.initiationPeak?.forceN, 4)}</td>
      <td className="num">{fmt(x.window.fromMm, 1)}–{fmt(x.window.toMm, 1)}</td>
      <td className="num">{fmt(x.peeledLengthMm, 2)}</td>
      <td className="num">{fmt(x.work.fullMJ, 3)}</td>
      <td className="num">{fmt(x.work.toDetachMJ, 3)}</td>
      <td className="num">{fmt(x.work.selectedMJ, 3)}</td>
      <td className="num">{fmt(x.work.perPeeledAreaJm2, 2)}</td>
      <td className="num">{fmt(x.peelRateMmS, 3)}</td>
      <td>
        <select value={m.failureMode} onChange={(e) => setMeta([r.id], { failureMode: e.target.value as FailureMode })} aria-label={`Failure mode of ${r.label}`}>
          {MODES.map((k) => <option key={k} value={k}>{FAILURE_MODE_LABEL[k]}</option>)}
        </select>
      </td>
      <td title={x.detach.note}>
        <NumberField
          compact
          allowEmpty
          min={0}
          value={m.manualDetachMm}
          placeholder={x.detach.source === 'auto' && x.detach.dispMm !== null ? `${fmt(x.detach.dispMm, 2)} auto` : 'not found'}
          label="Detachment displacement (mm), empty = automatic"
          onCommit={(v) => setMeta([r.id], { manualDetachMm: v })}
        />
      </td>
      <td className="num">{x.curve.nValid.toLocaleString()}</td>
    </tr>
  );
}

export function PeelResults() {
  const { ps, selected } = usePeel();
  const ok = selected.filter((r) => r.result.ok);
  const s = ps.settings;
  const conditions = [...new Set(ok.map((r) => r.condition))];
  const counts = (list: typeof ok) => `${new Set(list.map((r) => r.file.fileId)).size} file(s), ${list.length} run(s)`;
  // Rows grouped by condition (files of one group together), keeping each run's graph colour.
  const rows = [...selected].sort((a, b) => conditions.indexOf(a.condition) - conditions.indexOf(b.condition));
  if (!selected.length) return <p className="note pad">Tick runs in step 2 on the left to see their results.</p>;
  return (
    <div className="ls-results">
      <p className="note">
        Steady-state window: <strong>{s.plateau.mode === 'auto' ? `${(s.plateau.startFrac * 100).toFixed(0)}–${(s.plateau.endFrac * 100).toFixed(0)}% of each run's peeled length` : `${s.plateau.fromMm}–${s.plateau.toMm} mm`}</strong> ·
        area under graph, chosen range: <strong>{INTEGRATION_LABEL[s.integration.mode]}</strong> · baseline correction <strong>{s.baseline.enabled ? 'ON' : 'off'}</strong> · detachment{' '}
        {s.detach.auto ? `when force < ${(s.detach.fraction * 100).toFixed(1)}% of peak for ${s.detach.consecutive} points` : 'only when typed'}. Type a detachment displacement to set it by hand; clear the box for automatic. Hover ⚠ for notes.
      </p>
      <div className="table-scroll ls-table-wrap">
        <table className="grid ls-table">
          <thead>
            <tr>
              <th className="sticky-col">Run</th>
              <th>Gel length (mm)</th><th>Gel width (mm)</th><th>Gel thickness (mm)</th><th>Peel angle (°)</th>
              <th className="num" title="Mean force in the steady-state window">Average peel force F̄, steady state (N)</th><th className="num">F̄ (gf)</th><th className="num">Steady-state SD (N)</th><th className="num" title="SD / F̄ × 100: how steady the peel was">Steady-state CV (%)</th><th className="num">Steady-state min–max (N)</th>
              <th className="num" title="F̄ / width">Peel strength (N/m)</th><th className="num">Peel strength (N/mm)</th>
              <th className="num" title="G = F̄/w · (1 − cos θ); = F̄/w at 90°">Peel energy G (J/m²)</th>
              <th className="num" title="Highest force anywhere in the run">Peak force, max (N)</th><th className="num">Peak force, max (gf)</th><th className="num">Peak / width (N/m)</th><th className="num">Displ. at peak (mm)</th>
              <th className="num" title="Highest force before the steady-state window">Initiation peak force (N)</th><th className="num">Steady-state window (mm)</th><th className="num">Peeled length (mm)</th>
              <th className="num">Area under graph, full curve (mJ)</th><th className="num">Area under graph to detachment (mJ)</th><th className="num" title={`Chosen under Settings › Work: ${INTEGRATION_LABEL[s.integration.mode]}`}>Area under graph, chosen range (mJ)</th><th className="num" title="Work to detachment / (width × peeled length)">Work / peeled area (J/m²)</th>
              <th className="num">Peel rate (mm/s)</th><th>Failure mode</th><th>Detachment (mm)</th><th className="num">Valid points</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              r.result.ok ? (
                <Row key={r.id} r={r} color={CURVE_COLORS[ok.indexOf(r) % CURVE_COLORS.length]} />
              ) : (
                <tr key={r.id}><td className="sticky-col">{r.label}</td><td colSpan={27} className="run-error">{r.result.error}</td></tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <h3 className="ls-h">Summary of the selected runs (mean ± sample SD)</h3>
      <div className="table-scroll">
        <table className="grid ls-summary">
          <thead>
            <tr>
              <th>Property</th>
              <th className="num">All selected runs<br /><small>{counts(ok)}</small></th>
              {conditions.length > 1 && conditions.map((c) => <th key={c} className="num">{c}<br /><small>{counts(ok.filter((r) => r.condition === c))}</small></th>)}
            </tr>
          </thead>
          <tbody>
            {PEEL_PROPERTIES.map((p) => (
              <tr key={p.key}>
                <td>{p.label} ({p.unit})</td>
                <td className="num">{ms(ok.map((r) => p.get(r.result)), p.digits)}</td>
                {conditions.length > 1 && conditions.map((c) => <td key={c} className="num">{ms(ok.filter((r) => r.condition === c).map((r) => p.get(r.result)), p.digits)}</td>)}
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
      <h3 className="ls-h">Definitions</h3>
      <dl className="ls-definitions note">
        {PEEL_DEFINITIONS.map(([t, d]) => (
          <div key={t}><dt>{t}</dt><dd>{d}</dd></div>
        ))}
        <div><dt>Failure mode</dt><dd>Your observation of the specimen (adhesive, cohesive, mixed); it is never inferred from the curve.</dd></div>
      </dl>
    </div>
  );
}
