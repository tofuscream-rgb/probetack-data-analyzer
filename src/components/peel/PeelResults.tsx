import { usePeel, type PeelRun } from '../../state/peel';
import { describe } from '../../analysis/lapShear';
import { PEEL_DEFINITIONS, PEEL_PROPERTIES } from '../../analysis/peel';
import { FAILURE_MODES, PEEL_MORPHOLOGIES } from '../../analysis/observations';
import type { FailureMode, PeelMorphology, PeelRunMeta } from '../../types';
import { CURVE_COLORS } from '../../plotting/colors';
import { fmt } from '../common';
import { NumberField } from '../lapShear/NumberField';
import { BulkAssignBar, ObservationGlossary, useRunSelection, type SelectableRow } from '../ObservationTools';

const ms = (v: number[], d: number) => {
  const s = describe(v);
  return s.n ? `${fmt(s.mean, d)} ± ${s.n > 1 ? fmt(s.sd, d) : '—'} (n = ${s.n})` : '—';
};

function Row({ r, color, checked, onCheck, focus, onFocus }: { r: PeelRun; color: string; checked: boolean; onCheck: (on: boolean) => void; focus: boolean; onFocus: () => void }) {
  const { setMeta } = usePeel();
  const x = r.result;
  const m = r.meta;
  return (
    <tr className={focus ? 'focus' : ''} onClick={onFocus}>
      <td><input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${r.label}`} /></td>
      <td className="sticky-col"><span className="run-dot" style={{ background: color }} />{r.label}<div className="cond">{r.condition}</div></td>
      <td><NumberField compact value={m.widthMm} positive label="Gel width" onCommit={(v) => v !== null && setMeta([r.id], { widthMm: v })} /></td>
      <td className="num strong">{fmt(x.plateau.meanN, 4)}</td>
      <td className="num strong">{fmt(x.toughnessJm2, 2)}</td>
      <td className="num">{fmt(x.plateau.cv * 100, 1)}</td>
      <td className="num">{fmt(x.initiationPeak?.forceN, 4)}</td>
      <td className="num">{fmt(x.peelRateMmS, 3)}</td>
      <td>{fmt(x.window.fromMm, 1)}–{fmt(x.window.toMm, 1)} ({x.window.n})</td>
      <td>
        <select value={m.failureMode} onChange={(e) => setMeta([r.id], { failureMode: e.target.value as FailureMode })} aria-label={`Failure mode of ${r.label}`}>
          {FAILURE_MODES.map((k) => <option key={k.value} value={k.value} title={k.title}>{k.label}</option>)}
        </select>
      </td>
      <td>
        <select value={m.peelMorphology ?? 'unspecified'} onChange={(e) => setMeta([r.id], { peelMorphology: e.target.value as PeelMorphology })} aria-label={`Debonding morphology of ${r.label}`}>
          {PEEL_MORPHOLOGIES.map((k) => <option key={k.value} value={k.value} title={k.title}>{k.label}</option>)}
        </select>
      </td>
      <td><input className="obs-note" value={m.observation ?? ''} placeholder="observation" onChange={(e) => setMeta([r.id], { observation: e.target.value })} /></td>
      <td><NumberField compact allowEmpty min={0} value={m.fibrilZoneMm ?? null} placeholder="—" label="Fibrillated-zone length S" onCommit={(v) => setMeta([r.id], { fibrilZoneMm: v })} /></td>
      <td><NumberField compact allowEmpty min={0} value={m.maxFibrilMm ?? null} placeholder="—" label="Maximum fibril length a_f" onCommit={(v) => setMeta([r.id], { maxFibrilMm: v })} /></td>
    </tr>
  );
}

export function PeelResults() {
  const { selected, setMeta } = usePeel();
  const ok = selected.filter((r) => r.result.ok);
  const rows: SelectableRow[] = ok.map((r) => ({
    id: r.id, mode: r.meta.failureMode, morphology: r.meta.peelMorphology ?? 'unspecified',
    repeatKey: r.file.fileId, repeatLabel: r.file.name, conditionKey: r.condition, conditionLabel: r.condition,
  }));
  const runSel = useRunSelection(rows);
  if (!selected.length) return <p className="note pad">Tick runs in step 2 on the left to see their results.</p>;

  const byFile = new Map<string, typeof ok>();
  for (const r of ok) byFile.set(r.file.fileId, [...(byFile.get(r.file.fileId) ?? []), r]);
  const repeats = [...byFile.entries()].map(([fileId, runs]) => ({
    fileId, runs, label: runs[0].file.name, condition: runs[0].condition,
    props: Object.fromEntries(PEEL_PROPERTIES.map((p) => [p.key, describe(runs.map((r) => p.get(r.result))).mean])),
  }));
  const conditions = [...new Set(repeats.map((r) => r.condition))];
  const applyBulk = (patches: { id: string; mode?: FailureMode; morphology?: PeelMorphology }[]) => {
    // One update per distinct change (setMeta sets the same fields on several runs).
    const groups = new Map<string, { ids: string[]; patch: Partial<PeelRunMeta> }>();
    for (const p of patches) {
      const patch: Partial<PeelRunMeta> = { ...(p.mode !== undefined ? { failureMode: p.mode } : {}), ...(p.morphology !== undefined ? { peelMorphology: p.morphology } : {}) };
      const key = JSON.stringify(patch);
      groups.set(key, { ids: [...(groups.get(key)?.ids ?? []), p.id], patch });
    }
    for (const g of groups.values()) setMeta(g.ids, g.patch);
  };

  return (
    <div className="ls-results">
      <p className="note">
        Primary normalized result: measured peel energy G<sub>peel</sub> = F̄<sub>ss</sub>/w at 90°. The automatic pre-steady-state maximum is not automatically a crack-initiation force.
        Failure mode and debonding morphology are recorded separately (definitions below).
      </p>
      <BulkAssignBar rows={rows} selection={runSel} morphologies={PEEL_MORPHOLOGIES} onApply={applyBulk} />
      <div className="table-scroll ls-table-wrap">
        <table className="grid ls-table">
          <thead>
            <tr>
              <th title="Select for bulk assignment">Sel.</th><th className="sticky-col">Run</th><th>Width (mm)</th><th>F̄<sub>ss</sub> (N)</th><th>G<sub>peel</sub> (J/m²)</th><th>CV (%)</th>
              <th>Pre-SS max (N)</th><th>Rate (mm/s)</th><th>Window mm (n)</th><th>Failure mode</th><th>Debonding morphology</th><th>Observation</th><th>S (mm)</th><th>a<sub>f</sub> (mm)</th>
            </tr>
          </thead>
          <tbody>
            {selected.map((r) =>
              r.result.ok ? (
                <Row
                  key={r.id}
                  r={r}
                  color={CURVE_COLORS[ok.indexOf(r) % CURVE_COLORS.length]}
                  checked={runSel.selected.has(r.id)}
                  onCheck={(on) => runSel.toggle(r.id, on)}
                  focus={runSel.current?.id === r.id}
                  onFocus={() => runSel.setCurrentId(r.id)}
                />
              ) : (
                <tr key={r.id}><td /><td>{r.label}</td><td colSpan={12}>{r.result.error}</td></tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      <h3 className="ls-h">Mean ± SD per Repeat/file</h3>
      <div className="table-scroll">
        <table className="grid ls-summary">
          <thead><tr><th>Repeat/file</th><th>Condition</th><th>Runs</th>{PEEL_PROPERTIES.map((p) => <th key={p.key}>{p.label}<br /><small>({p.unit})</small></th>)}</tr></thead>
          <tbody>
            {repeats.map((rp) => (
              <tr key={rp.fileId}>
                <td>{rp.label}</td><td>{rp.condition}</td><td>{rp.runs.length}</td>
                {PEEL_PROPERTIES.map((p) => <td key={p.key}>{ms(rp.runs.map((r) => p.get(r.result)), p.digits)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="ls-h">Mean ± SD per condition (over Repeat/file means)</h3>
      <div className="table-scroll">
        <table className="grid ls-summary">
          <thead><tr><th>Condition</th><th>Repeats</th><th>Runs</th>{PEEL_PROPERTIES.map((p) => <th key={p.key}>{p.label}<br /><small>({p.unit})</small></th>)}</tr></thead>
          <tbody>
            {conditions.map((c) => {
              const reps = repeats.filter((r) => r.condition === c);
              return (
                <tr key={c}>
                  <td>{c}</td><td>{reps.length}</td><td>{reps.reduce((n, r) => n + r.runs.length, 0)}</td>
                  {PEEL_PROPERTIES.map((p) => <td key={p.key}>{ms(reps.map((r) => r.props[p.key]), p.digits)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">Each file/Repeat counts once at condition level.</p>

      <h3 className="ls-h">Definitions: peel results</h3>
      <dl className="ls-definitions note">{PEEL_DEFINITIONS.map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
      <ObservationGlossary test="peel" title="Definitions & References: failure mode and debonding morphology" />
    </div>
  );
}
