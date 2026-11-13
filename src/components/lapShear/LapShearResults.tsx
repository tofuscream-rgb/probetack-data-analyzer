import { useMemo, useState } from 'react';
import { useApp } from '../../state/AppContext';
import { withAnalysisInclusion } from '../../state/inclusion';
import { conditionTitle, groupKey, includedRuns, lapShearAnalysisRow } from '../../analysis/adhesionReview';
import { ReviewSummaries, Section, SectionToggles, saveCsv, summaryCsv, type SummaryRun } from '../MetricsSections';
import { useLapShear, type LapShearRun } from '../../state/lapShear';
import { FAILURE_MODE_LABEL, SUMMARY_PROPERTIES } from '../../analysis/lapShear';
import type { FailureMode, LapShearDims } from '../../types';
import { fmt } from '../common';
import { CURVE_COLORS } from '../../plotting/colors';
import { NumberField } from './NumberField';
import { BulkAssignBar, ObservationGlossary, useRunSelection } from '../ObservationTools';
import { EquationList, type EquationItem } from '../EquationList';

/** Lap-shear equations with their sources (refs empty = defined by this analyzer or not adhesion-specific). */
export function lapEquations(fraction: number, consecutive: number): EquationItem[] {
  return [
    {
      title: 'Bonded overlap area',
      tex: String.raw`A = L \times W`,
      text: 'L = overlap length, W = overlap width (mm); A in mm². Gel thickness is recorded but does not enter the strength.',
      refs: ['astmD1002'],
      note: 'shear (overlap) area of a single-lap joint (ASTM D1002).',
    },
    {
      title: 'Displacement and loading force',
      tex: String.raw`\delta = \lvert z - z_0 \rvert,\qquad F = \lvert F_z \rvert\ \text{in the loading direction}`,
      text: 'z₀ = first valid position of the run. The force sign with the larger magnitude is the loading direction (or set in Settings).',
      refs: [],
      note: 'data processing defined by this analyzer.',
    },
    {
      title: 'Apparent nominal lap-shear strength',
      tex: String.raw`\tau_{\max} = \frac{F_{\max}}{A}`,
      text: 'In kPa (N/mm² × 1000). Average stress over the original bonded area at peak load, not the maximum local stress in the joint.',
      refs: ['astmD1002'],
      note: 'apparent shear strength of a single-lap joint = maximum load / shear area (ASTM D1002), applied by analogy to gel joints.',
    },
    {
      title: 'Failure point',
      tex: String.raw`F < ${fraction}\,F_{\max}\ \text{for}\ ${consecutive}\ \text{consecutive points}\;\Rightarrow\;\delta_{\text{failure}}`,
      text: `First point after the peak where the force stays below ${(fraction * 100).toFixed(1)}% of F_max for ${consecutive} consecutive valid points (adjustable in Settings); a typed failure displacement overrides it.`,
      refs: [],
      note: 'defined by this analyzer.',
    },
    {
      title: 'Apparent work to failure per bonded area',
      tex: String.raw`\frac{W_{\text{fail}}}{A} = \frac{1}{A}\int_{0}^{\delta_{\text{failure}}} F\,\mathrm{d}\delta`,
      text: 'Trapezoidal rule over forward displacement, N·mm / mm² × 1000 = J/m². An apparent quantity that may include elastic, viscoelastic, cohesive, interfacial and frictional contributions; not fracture toughness.',
      refs: [],
      note: 'defined by this analyzer (no literature source).',
    },
    {
      title: 'Custom area under the curve (additional tool)',
      tex: String.raw`W_{\text{selected}} = \int_{\delta_1}^{\delta_2} F\,\mathrm{d}\delta,\qquad \frac{W_{\text{selected}}}{A}`,
      text: 'Boundaries δ₁, δ₂ set on the Graph tab (draggable or typed); trapezoidal rule with the force interpolated at the exact boundaries; mJ and apparent J/m² (A = overlap area of each run). It does not change any automatic result.',
      refs: [],
      note: 'numerical integration (trapezoidal rule), defined by this analyzer; the limits are chosen by you.',
    },
    {
      title: 'Statistics',
      tex: String.raw`\bar{x} = \frac{1}{n}\sum x_j,\qquad s = \sqrt{\frac{\sum (x_j - \bar{x})^2}{n - 1}}`,
      text: 'Per Repeat/file over its runs; per condition over the Repeat/file means (each Repeat counts once).',
      refs: [],
      note: 'standard sample statistics; not adhesion-specific.',
    },
  ];
}

const MODES = Object.keys(FAILURE_MODE_LABEL) as FailureMode[];
const digits = (u: string) => ({ N: 4, kPa: 2, mm: 3, 'J/m²': 2 }[u] ?? 3);

function ApplyAll({ ids }: { ids: string[] }) {
  const { ls, setMeta } = useLapShear();
  const [d, setD] = useState<LapShearDims>(ls.settings.defaults);
  return <div className="apply-all"><strong>Set dimensions for all {ids.length} selected run(s):</strong>
    <NumberField label="Length (mm)" value={d.lengthMm} positive onCommit={(v)=>setD({...d,lengthMm:v??d.lengthMm})}/>
    <NumberField label="Width (mm)" value={d.widthMm} positive onCommit={(v)=>setD({...d,widthMm:v??d.widthMm})}/>
    <NumberField label="Thickness (mm, optional metadata)" value={d.thicknessMm} positive onCommit={(v)=>setD({...d,thicknessMm:v??d.thicknessMm})}/>
    <button className="small" disabled={!ids.length} onClick={()=>setMeta(ids,d)}>Apply</button></div>;
}
function Row({ r, color, setMeta, selection, included, onInclude }: { r: LapShearRun; color: string; setMeta: ReturnType<typeof useLapShear>['setMeta']; selection: ReturnType<typeof useRunSelection>; included: boolean; onInclude: (on: boolean) => void }) {
  const x = r.result, m = r.meta, p = x.peak;
  return <tr className={`${selection.current?.id === r.id ? 'focus' : ''} ${included ? '' : 'excluded'}`} onClick={() => selection.setCurrentId(r.id)}>
    <td><input type="checkbox" checked={selection.selected.has(r.id)} onChange={(e) => selection.toggle(r.id, e.target.checked)} aria-label={`Select ${r.label}`} /></td>
    <td className="center"><input type="checkbox" checked={included} onChange={(e) => onInclude(e.target.checked)} aria-label={`Use ${r.label} in the average`} title="Same choice as In average in Data analysis" /></td>
    <td className="sticky-col" title={r.file.path}><span className="run-dot" style={{background:color}}/>{r.label}<div className="cond">{r.condition}</div></td>
    <td><NumberField compact value={m.lengthMm} positive label="Overlap length" onCommit={(v)=>v!==null&&setMeta([r.id],{lengthMm:v})}/></td>
    <td><NumberField compact value={m.widthMm} positive label="Overlap width" onCommit={(v)=>v!==null&&setMeta([r.id],{widthMm:v})}/></td>
    <td><NumberField compact value={m.thicknessMm} positive label="Gel thickness" onCommit={(v) => v !== null && setMeta([r.id], { thicknessMm: v })} /></td>
    <td className="num">{fmt(x.areaMm2,1)}</td><td className="num">{fmt(p?.forceN,4)}</td><td className="num strong">{fmt(x.strengthKPa,2)}</td><td className="num">{fmt(p?.dispMm,3)}</td>
    <td><NumberField compact allowEmpty min={0} value={m.manualFailureMm} placeholder={x.failure.source==='auto'&&x.failure.dispMm!==null?`${fmt(x.failure.dispMm,3)} auto`:'not found'} label="Failure displacement" onCommit={(v)=>setMeta([r.id],{manualFailureMm:v})}/></td>
    <td className="num">{fmt(x.work.toFailurePerAreaJm2,2)}</td>
    <td><select value={m.failureMode} onChange={(e)=>setMeta([r.id],{failureMode:e.target.value as FailureMode})}>{MODES.map((k)=><option key={k} value={k}>{FAILURE_MODE_LABEL[k]}</option>)}</select></td>
    <td><input className="obs-note" aria-label={`Observation for ${r.label}`} value={m.observation ?? ''} onChange={(e) => setMeta([r.id], { observation: e.target.value })} /></td>
    <td className="num" title={x.warnings.join(' · ')}>{x.nValid.toLocaleString()}{x.warnings.length > 0 && <div className="note">{x.warnings.join(' · ')}</div>}</td>
  </tr>;
}
export function LapShearResults() {
  const { ls, picked, setMeta } = useLapShear();
  const { meta, update, project } = useApp();
  const ok = picked.filter((r) => r.result.ok);
  const rows = ok.map((r) => ({ id: r.id, mode: r.meta.failureMode, morphology: 'unspecified', repeatKey: r.file.fileId, repeatLabel: r.file.name, conditionKey: r.condition, conditionLabel: r.condition }));
  const selection = useRunSelection(rows);
  const inclusion = ls.analysisInclusion ?? {};
  const analysis = useMemo(() => new Map(picked.map((r) => [r.id, lapShearAnalysisRow(r, meta.get(r.file.fileId)?.gel.value ?? null)])), [picked, meta]);
  const included = useMemo(() => includedRuns([...analysis.values()], inclusion), [analysis, inclusion]);
  const setIncluded = (id: string, on: boolean) => update((p) => withAnalysisInclusion(p, 'lapShear', id, on ? null : false));
  if (!picked.length) return <p className="note pad">No runs in the chosen experiment. Open files in step 1 on the left, or set a dropdown in step 2 back to <em>All</em>.</p>;
  const props = SUMMARY_PROPERTIES.map((p) => ({ key: p.key, label: p.label, unit: p.unit, digits: digits(p.unit) }));
  const summaryRuns: SummaryRun[] = ok.map((r) => {
    const a = analysis.get(r.id)!;
    return { id: r.id, fileId: r.file.fileId, fileName: r.file.name, path: r.file.path, condKey: groupKey(a), condTitle: conditionTitle(a), included: included.has(r.id), values: Object.fromEntries(SUMMARY_PROPERTIES.map((p) => [p.key, p.get(r.result)])) };
  });
  const base = (project: string) => project.replace(/[^\w.-]+/g, '_') || 'lap_shear';
  const runCsv = () => [
    ['Repeat (file)', 'Path', 'Condition', 'Run', 'In average', 'Overlap length (mm)', 'Overlap width (mm)', 'Gel thickness (mm)', 'Area (mm²)', ...SUMMARY_PROPERTIES.map((p) => `${p.label} (${p.unit})`), 'Failure source', 'Failure mode', 'Observation', 'Notes'],
    ...ok.map((r) => [r.file.name, r.file.path, conditionTitle(analysis.get(r.id)!), r.cycle.cycleNumber, included.has(r.id) ? 'yes' : 'no', r.meta.lengthMm, r.meta.widthMm, r.meta.thicknessMm, r.result.areaMm2,
      ...SUMMARY_PROPERTIES.map((p) => p.get(r.result)), r.result.failure.source, FAILURE_MODE_LABEL[r.meta.failureMode], r.meta.observation ?? '', r.result.warnings.join(' · ')]),
  ];
  return <div className="ls-results metrics-tab">
    <p className="note">Primary result: apparent nominal lap-shear strength τ = F<sub>max</sub>/A with A = overlap length × width (apparent shear strength of a single-lap joint, ASTM D1002, applied by analogy to gel joints). Gel thickness does not enter τ. Automatic failure is the first post-peak force below {(ls.settings.failure.fraction*100).toFixed(1)}% of F<sub>max</sub> for {ls.settings.failure.consecutive} consecutive points. All runs of the chosen experiment are listed; <em>In average</em> is the same choice as in Data analysis.</p>
    <SectionToggles />
    <Section n={1} title="Dimensions"><ApplyAll ids={ok.map((r)=>r.id)}/></Section>
    <Section n={2} title="Per-run results">
    <BulkAssignBar rows={rows} selection={selection} onApply={(patches) => {
      for (const failureMode of MODES) {
        const ids = patches.filter((patch) => patch.mode === failureMode).map((patch) => patch.id);
        if (ids.length) setMeta(ids, { failureMode });
      }
    }} />
    <div className="table-scroll ls-table-wrap"><table className="grid ls-table"><thead><tr><th>Sel.</th><th title="Same choice as In average in Data analysis">In average</th><th className="sticky-col">Run</th><th>Overlap length (mm)</th><th>Overlap width (mm)</th><th>Gel thickness (mm)</th><th>Area (mm²)</th><th>F<sub>max</sub> (N)</th><th>τ<sub>max</sub> (kPa)</th><th>δ at peak (mm)</th><th>Failure δ (mm)</th><th>Apparent work to failure / area (J/m²)</th><th>Failure mode</th><th>Observation</th><th>Valid points / diagnostics</th></tr></thead>
    <tbody>{picked.map((r)=>r.result.ok?<Row key={r.id} r={r} color={CURVE_COLORS[ok.indexOf(r)%CURVE_COLORS.length]} setMeta={setMeta} selection={selection} included={included.has(r.id)} onInclude={(on) => setIncluded(r.id, on)}/>:<tr key={r.id}><td /><td /><td>{r.label}</td><td colSpan={12}>{r.result.error}</td></tr>)}</tbody></table></div>
    <p className="note">Excluded rows stay visible (struck through).</p>
    </Section>
    <ReviewSummaries runs={summaryRuns} props={props} first={3} />
    <Section n={5} title="Equations and sources"><EquationList items={lapEquations(ls.settings.failure.fraction, ls.settings.failure.consecutive)} title="Equations and sources: lap-shear results" /></Section>
    <Section n={6} title="Definitions & References: failure mode"><ObservationGlossary test="lapShear" title="Definitions & References: failure mode" hideTitle /></Section>
    <Section n={7} title="Export CSV">
      <div className="table-actions">
        <button className="small" onClick={() => saveCsv(runCsv(), `${base(project.name)}_lap_shear_runs.csv`)}>Per-run results</button>
        <button className="small" onClick={() => saveCsv(summaryCsv(summaryRuns, props), `${base(project.name)}_lap_shear_summary.csv`)}>Repeat and condition summaries</button>
        <span className="note">Per-run CSV includes dimensions, failure point, failure modes, observations and notes; summaries give included runs after review and all valid runs.</span>
      </div>
    </Section>
  </div>;
}
