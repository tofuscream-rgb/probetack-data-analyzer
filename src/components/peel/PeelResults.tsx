import { useMemo } from 'react';
import { usePeel, type PeelRun } from '../../state/peel';
import { useApp } from '../../state/AppContext';
import { withAnalysisInclusion } from '../../state/inclusion';
import { conditionTitle, groupKey, includedRuns, peelAnalysisRow } from '../../analysis/adhesionReview';
import { ReviewSummaries, Section, SectionToggles, saveCsv, summaryCsv, type SummaryRun } from '../MetricsSections';
import { PEEL_EQUATIONS, PEEL_PROPERTIES } from '../../analysis/peel';
import { EquationList } from '../EquationList';
import { FAILURE_MODES, PEEL_MORPHOLOGIES } from '../../analysis/observations';
import type { FailureMode, PeelMorphology, PeelRunMeta } from '../../types';
import { CURVE_COLORS } from '../../plotting/colors';
import { fmt } from '../common';
import { NumberField } from '../lapShear/NumberField';
import { BulkAssignBar, ObservationGlossary, useRunSelection, type SelectableRow } from '../ObservationTools';

function Row({ r, color, checked, onCheck, focus, onFocus, included, onInclude }: { r: PeelRun; color: string; checked: boolean; onCheck: (on: boolean) => void; focus: boolean; onFocus: () => void; included: boolean; onInclude: (on: boolean) => void }) {
  const { setMeta } = usePeel();
  const x = r.result;
  const m = r.meta;
  return (
    <tr className={`${focus ? 'focus' : ''} ${included ? '' : 'excluded'}`} onClick={onFocus}>
      <td><input type="checkbox" checked={checked} onChange={(e) => onCheck(e.target.checked)} aria-label={`Select ${r.label}`} /></td>
      <td className="center"><input type="checkbox" checked={included} onChange={(e) => onInclude(e.target.checked)} aria-label={`Use ${r.label} in the average`} title="Same choice as In average in Data analysis" /></td>
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
  const { ps, picked, setMeta } = usePeel();
  const { meta, update, project } = useApp();
  const ok = picked.filter((r) => r.result.ok);
  const rows: SelectableRow[] = ok.map((r) => ({
    id: r.id, mode: r.meta.failureMode, morphology: r.meta.peelMorphology ?? 'unspecified',
    repeatKey: r.file.fileId, repeatLabel: r.file.name, conditionKey: r.condition, conditionLabel: r.condition,
  }));
  const runSel = useRunSelection(rows);
  const inclusion = ps.analysisInclusion ?? {};
  const analysis = useMemo(() => new Map(picked.map((r) => [r.id, peelAnalysisRow(r, meta.get(r.file.fileId)?.gel.value ?? null)])), [picked, meta]);
  const included = useMemo(() => includedRuns([...analysis.values()], inclusion), [analysis, inclusion]);
  const setIncluded = (id: string, on: boolean) => update((p) => withAnalysisInclusion(p, 'peel', id, on ? null : false));
  if (!picked.length) return <p className="note pad">No runs in the chosen experiment. Open files in step 1 on the left, or set a dropdown in step 2 back to <em>All</em>.</p>;

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
  const props = PEEL_PROPERTIES.map((p) => ({ key: p.key, label: p.label, unit: p.unit, digits: p.digits }));
  const summaryRuns: SummaryRun[] = ok.map((r) => {
    const a = analysis.get(r.id)!;
    return { id: r.id, fileId: r.file.fileId, fileName: r.file.name, path: r.file.path, condKey: groupKey(a), condTitle: conditionTitle(a), included: included.has(r.id), values: Object.fromEntries(PEEL_PROPERTIES.map((p) => [p.key, p.get(r.result)])) };
  });
  const base = (project.name.replace(/[^\w.-]+/g, '_') || 'peel') + '_90_peel';
  const label = (list: { value: string; label: string }[], v: string | undefined) => list.find((k) => k.value === v)?.label ?? v ?? '';
  const runCsv = () => [
    ['Repeat (file)', 'Path', 'Condition', 'Run', 'In average', 'Gel length (mm)', 'Gel width (mm)', 'Gel thickness (mm)', 'Peel angle (°)', ...PEEL_PROPERTIES.map((p) => `${p.label} (${p.unit})`), 'Window from (mm)', 'Window to (mm)', 'Detachment (mm)', 'Detachment source', 'Failure mode', 'Debonding morphology', 'Observation', 'S (mm)', 'a_f (mm)', 'Notes'],
    ...ok.map((r) => [r.file.name, r.file.path, conditionTitle(analysis.get(r.id)!), r.cycle.cycleNumber, included.has(r.id) ? 'yes' : 'no', r.meta.lengthMm, r.meta.widthMm, r.meta.thicknessMm, r.meta.angleDeg,
      ...PEEL_PROPERTIES.map((p) => p.get(r.result)), r.result.window.fromMm, r.result.window.toMm, r.result.detach.dispMm, r.result.detach.source,
      label(FAILURE_MODES, r.meta.failureMode), label(PEEL_MORPHOLOGIES, r.meta.peelMorphology), r.meta.observation ?? '', r.meta.fibrilZoneMm ?? null, r.meta.maxFibrilMm ?? null, r.result.warnings.join(' · ')]),
  ];

  return (
    <div className="ls-results metrics-tab">
      <p className="note">
        Primary normalized result: measured peel energy G<sub>peel</sub> = F̄<sub>ss</sub>/w at 90° (Kendall 1975; Creton &amp; Ciccotti 2016). The automatic pre-steady-state maximum is not automatically a crack-initiation force.
        Failure mode and debonding morphology are recorded separately (definitions below). All runs of the chosen experiment are listed; <em>In average</em> is the same choice as in Data analysis.
      </p>
      <SectionToggles />
      <Section n={1} title="Per-run results">
        <BulkAssignBar rows={rows} selection={runSel} morphologies={PEEL_MORPHOLOGIES} onApply={applyBulk} />
        <div className="table-scroll ls-table-wrap">
          <table className="grid ls-table">
            <thead>
              <tr>
                <th title="Select for bulk assignment">Sel.</th><th title="Same choice as In average in Data analysis">In average</th><th className="sticky-col">Run</th><th>Width (mm)</th><th>F̄<sub>ss</sub> (N)</th><th>G<sub>peel</sub> (J/m²)</th><th>CV (%)</th>
                <th>Pre-SS max (N)</th><th>Rate (mm/s)</th><th>Window mm (n)</th><th>Failure mode</th><th>Debonding morphology</th><th>Observation</th><th>S (mm)</th><th>a<sub>f</sub> (mm)</th>
              </tr>
            </thead>
            <tbody>
              {picked.map((r) =>
                r.result.ok ? (
                  <Row
                    key={r.id}
                    r={r}
                    color={CURVE_COLORS[ok.indexOf(r) % CURVE_COLORS.length]}
                    checked={runSel.selected.has(r.id)}
                    onCheck={(on) => runSel.toggle(r.id, on)}
                    focus={runSel.current?.id === r.id}
                    onFocus={() => runSel.setCurrentId(r.id)}
                    included={included.has(r.id)}
                    onInclude={(on) => setIncluded(r.id, on)}
                  />
                ) : (
                  <tr key={r.id}><td /><td /><td>{r.label}</td><td colSpan={12}>{r.result.error}</td></tr>
                ),
              )}
            </tbody>
          </table>
        </div>
        <p className="note">Excluded rows stay visible (struck through).</p>
      </Section>
      <ReviewSummaries runs={summaryRuns} props={props} first={2} />
      <Section n={4} title="Equations and sources"><EquationList items={PEEL_EQUATIONS} title="Equations and sources: peel results" /></Section>
      <Section n={5} title="Definitions & References: failure mode and debonding morphology"><ObservationGlossary test="peel" title="Definitions & References: failure mode and debonding morphology" hideTitle /></Section>
      <Section n={6} title="Export CSV">
        <div className="table-actions">
          <button className="small" onClick={() => saveCsv(runCsv(), `${base}_runs.csv`)}>Per-run results</button>
          <button className="small" onClick={() => saveCsv(summaryCsv(summaryRuns, props), `${base}_summary.csv`)}>Repeat and condition summaries</button>
          <span className="note">Per-run CSV includes dimensions, steady-state window, detachment, failure modes, morphologies, observations and notes; summaries give included runs after review and all valid runs.</span>
        </div>
      </Section>
    </div>
  );
}
