import { useState } from 'react';
import { useLapShear, type LapShearRun } from '../../state/lapShear';
import { FAILURE_MODE_LABEL, SUMMARY_PROPERTIES, describe } from '../../analysis/lapShear';
import type { FailureMode, LapShearDims } from '../../types';
import { fmt } from '../common';
import { CURVE_COLORS } from '../../plotting/colors';
import { NumberField } from './NumberField';
import { ObservationGlossary } from '../ObservationTools';
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
const ms = (values: number[], d: number) => { const s = describe(values); return s.n ? `${fmt(s.mean,d)} ± ${s.n>1?fmt(s.sd,d):'—'} (n = ${s.n})` : '—'; };

function ApplyAll({ ids }: { ids: string[] }) {
  const { ls, setMeta } = useLapShear();
  const [d, setD] = useState<LapShearDims>(ls.settings.defaults);
  return <div className="apply-all"><strong>Set dimensions for all {ids.length} selected run(s):</strong>
    <NumberField label="Length (mm)" value={d.lengthMm} positive onCommit={(v)=>setD({...d,lengthMm:v??d.lengthMm})}/>
    <NumberField label="Width (mm)" value={d.widthMm} positive onCommit={(v)=>setD({...d,widthMm:v??d.widthMm})}/>
    <NumberField label="Thickness (mm, optional metadata)" value={d.thicknessMm} positive onCommit={(v)=>setD({...d,thicknessMm:v??d.thicknessMm})}/>
    <button className="small" disabled={!ids.length} onClick={()=>setMeta(ids,d)}>Apply</button></div>;
}
function Row({ r, color }: { r: LapShearRun; color: string }) {
  const { setMeta } = useLapShear(); const x=r.result,m=r.meta,p=x.peak;
  return <tr>
    <td className="sticky-col" title={r.file.path}><span className="run-dot" style={{background:color}}/>{r.label}<div className="cond">{r.condition}</div></td>
    <td><NumberField compact value={m.lengthMm} positive label="Overlap length" onCommit={(v)=>v!==null&&setMeta([r.id],{lengthMm:v})}/></td>
    <td><NumberField compact value={m.widthMm} positive label="Overlap width" onCommit={(v)=>v!==null&&setMeta([r.id],{widthMm:v})}/></td>
    <td className="num">{fmt(x.areaMm2,1)}</td><td className="num">{fmt(p?.forceN,4)}</td><td className="num strong">{fmt(x.strengthKPa,2)}</td><td className="num">{fmt(p?.dispMm,3)}</td>
    <td><NumberField compact allowEmpty min={0} value={m.manualFailureMm} placeholder={x.failure.source==='auto'&&x.failure.dispMm!==null?`${fmt(x.failure.dispMm,3)} auto`:'not found'} label="Failure displacement" onCommit={(v)=>setMeta([r.id],{manualFailureMm:v})}/></td>
    <td className="num">{fmt(x.work.toFailurePerAreaJm2,2)}</td>
    <td><select value={m.failureMode} onChange={(e)=>setMeta([r.id],{failureMode:e.target.value as FailureMode})}>{MODES.map((k)=><option key={k} value={k}>{FAILURE_MODE_LABEL[k]}</option>)}</select></td>
    <td className="num">{x.nValid.toLocaleString()}</td>
  </tr>;
}
export function LapShearResults() {
  const { ls, selected } = useLapShear(); const ok=selected.filter((r)=>r.result.ok);
  if(!selected.length)return <p className="note pad">Tick runs in step 2 on the left to see their results.</p>;
  const byFile=new Map<string,typeof ok>(); for(const r of ok)byFile.set(r.file.fileId,[...(byFile.get(r.file.fileId)??[]),r]);
  const repeats=[...byFile.entries()].map(([fileId,runs])=>({fileId,runs,label:runs[0].file.name,condition:runs[0].condition,props:Object.fromEntries(SUMMARY_PROPERTIES.map((p)=>[p.key,describe(runs.map((r)=>p.get(r.result))).mean]))}));
  const conditions=[...new Set(repeats.map((r)=>r.condition))];
  return <div className="ls-results"><ApplyAll ids={ok.map((r)=>r.id)}/>
    <p className="note">Primary result: apparent nominal lap-shear strength τ = F<sub>max</sub>/A with A = overlap length × width (apparent shear strength of a single-lap joint, ASTM D1002, applied by analogy to gel joints). Gel thickness does not enter τ. Automatic failure is the first post-peak force below {(ls.settings.failure.fraction*100).toFixed(1)}% of F<sub>max</sub> for {ls.settings.failure.consecutive} consecutive valid points; a manual failure displacement overrides it. The optional energy result is ∫F dδ/A to that failure point (defined by this analyzer) and is not fracture toughness.</p>
    <div className="table-scroll ls-table-wrap"><table className="grid ls-table"><thead><tr><th className="sticky-col">Run</th><th>Overlap length (mm)</th><th>Overlap width (mm)</th><th>Area (mm²)</th><th>F<sub>max</sub> (N)</th><th>τ<sub>max</sub> (kPa)</th><th>δ at peak (mm)</th><th>Failure δ (mm)</th><th>Apparent work to failure / area (J/m²)</th><th>Failure mode</th><th>Valid points</th></tr></thead>
    <tbody>{selected.map((r)=>r.result.ok?<Row key={r.id} r={r} color={CURVE_COLORS[ok.indexOf(r)%CURVE_COLORS.length]}/>:<tr key={r.id}><td>{r.label}</td><td colSpan={10}>{r.result.error}</td></tr>)}</tbody></table></div>
    <h3 className="ls-h">Mean ± SD per Repeat/file</h3><div className="table-scroll"><table className="grid ls-summary"><thead><tr><th>Repeat/file</th><th>Condition</th><th>Runs</th>{SUMMARY_PROPERTIES.map((p)=><th key={p.key}>{p.label}<br/><small>({p.unit})</small></th>)}</tr></thead><tbody>
      {repeats.map((rp)=><tr key={rp.fileId}><td>{rp.label}</td><td>{rp.condition}</td><td>{rp.runs.length}</td>{SUMMARY_PROPERTIES.map((p)=><td key={p.key}>{ms(rp.runs.map((r)=>p.get(r.result)),digits(p.unit))}</td>)}</tr>)}
    </tbody></table></div>
    <h3 className="ls-h">Mean ± SD per condition (over Repeat/file means)</h3><div className="table-scroll"><table className="grid ls-summary"><thead><tr><th>Condition</th><th>Repeats</th><th>Runs</th>{SUMMARY_PROPERTIES.map((p)=><th key={p.key}>{p.label}<br/><small>({p.unit})</small></th>)}</tr></thead><tbody>
      {conditions.map((c)=>{const reps=repeats.filter((r)=>r.condition===c);return <tr key={c}><td>{c}</td><td>{reps.length}</td><td>{reps.reduce((n,r)=>n+r.runs.length,0)}</td>{SUMMARY_PROPERTIES.map((p)=><td key={p.key}>{ms(reps.map((r)=>r.props[p.key]),digits(p.unit))}</td>)}</tr>})}
    </tbody></table></div><p className="note">Each file/Repeat counts once at condition level.</p>
    <EquationList items={lapEquations(ls.settings.failure.fraction, ls.settings.failure.consecutive)} title="Equations and sources: lap-shear results" />
    <ObservationGlossary test="lapShear" title="Definitions & References: failure mode" /></div>;
}
