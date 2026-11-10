import { useState } from 'react';
import { useLapShear, type LapShearRun } from '../../state/lapShear';
import { FAILURE_MODE_LABEL, SUMMARY_PROPERTIES, describe } from '../../analysis/lapShear';
import type { FailureMode, LapShearDims } from '../../types';
import { fmt } from '../common';
import { CURVE_COLORS } from '../../plotting/colors';
import { NumberField } from './NumberField';

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
    <p className="note">Primary result: apparent nominal lap-shear strength τ = F<sub>max</sub>/A with A = overlap length × width. Gel thickness does not enter τ. Automatic failure is the first post-peak force below {(ls.settings.failure.fraction*100).toFixed(1)}% of F<sub>max</sub> for {ls.settings.failure.consecutive} consecutive valid points; a manual failure displacement overrides it. The optional energy result is ∫F dδ/A to that failure point and is not fracture toughness.</p>
    <div className="table-scroll ls-table-wrap"><table className="grid ls-table"><thead><tr><th className="sticky-col">Run</th><th>Overlap length (mm)</th><th>Overlap width (mm)</th><th>Area (mm²)</th><th>F<sub>max</sub> (N)</th><th>τ<sub>max</sub> (kPa)</th><th>δ at peak (mm)</th><th>Failure δ (mm)</th><th>Apparent work to failure / area (J/m²)</th><th>Failure locus</th><th>Valid points</th></tr></thead>
    <tbody>{selected.map((r)=>r.result.ok?<Row key={r.id} r={r} color={CURVE_COLORS[ok.indexOf(r)%CURVE_COLORS.length]}/>:<tr key={r.id}><td>{r.label}</td><td colSpan={10}>{r.result.error}</td></tr>)}</tbody></table></div>
    <h3 className="ls-h">Mean ± SD per Repeat/file</h3><div className="table-scroll"><table className="grid ls-summary"><thead><tr><th>Repeat/file</th><th>Condition</th><th>Runs</th>{SUMMARY_PROPERTIES.map((p)=><th key={p.key}>{p.label}<br/><small>({p.unit})</small></th>)}</tr></thead><tbody>
      {repeats.map((rp)=><tr key={rp.fileId}><td>{rp.label}</td><td>{rp.condition}</td><td>{rp.runs.length}</td>{SUMMARY_PROPERTIES.map((p)=><td key={p.key}>{ms(rp.runs.map((r)=>p.get(r.result)),digits(p.unit))}</td>)}</tr>)}
    </tbody></table></div>
    <h3 className="ls-h">Mean ± SD per condition (over Repeat/file means)</h3><div className="table-scroll"><table className="grid ls-summary"><thead><tr><th>Condition</th><th>Repeats</th><th>Runs</th>{SUMMARY_PROPERTIES.map((p)=><th key={p.key}>{p.label}<br/><small>({p.unit})</small></th>)}</tr></thead><tbody>
      {conditions.map((c)=>{const reps=repeats.filter((r)=>r.condition===c);return <tr key={c}><td>{c}</td><td>{reps.length}</td><td>{reps.reduce((n,r)=>n+r.runs.length,0)}</td>{SUMMARY_PROPERTIES.map((p)=><td key={p.key}>{ms(reps.map((r)=>r.props[p.key]),digits(p.unit))}</td>)}</tr>})}
    </tbody></table></div><p className="note">Each file/Repeat counts once at condition level.</p></div>;
}
