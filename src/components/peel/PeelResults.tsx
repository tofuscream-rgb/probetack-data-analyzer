import { usePeel, type PeelRun } from '../../state/peel';
import { FAILURE_MODE_LABEL, describe } from '../../analysis/lapShear';
import { PEEL_DEFINITIONS, PEEL_PROPERTIES } from '../../analysis/peel';
import type { FailureMode, PeelMorphology } from '../../types';
import { CURVE_COLORS } from '../../plotting/colors';
import { fmt } from '../common';
import { NumberField } from '../lapShear/NumberField';

const LOCI=Object.keys(FAILURE_MODE_LABEL) as FailureMode[];
const MORPH:{value:PeelMorphology;label:string}[]=[
{value:'unspecified',label:'—'},{value:'no-fibrils',label:'No fibrils'},{value:'transient-fibrils',label:'Transient fibrils'},
{value:'persistent-fibrils',label:'Persistent fibrils'},{value:'cavitation',label:'Cavitation'},{value:'cavitation+fibrillation',label:'Cavitation + fibrillation'},{value:'other',label:'Other'}];
const ms=(v:number[],d:number)=>{const s=describe(v);return s.n?`${fmt(s.mean,d)} ± ${s.n>1?fmt(s.sd,d):'—'} (n = ${s.n})`:'—';};
function Row({r,color}:{r:PeelRun;color:string}){const{setMeta}=usePeel();const x=r.result,m=r.meta;return <tr>
<td className="sticky-col"><span className="run-dot" style={{background:color}}/>{r.label}<div className="cond">{r.condition}</div></td>
<td><NumberField compact value={m.widthMm} positive label="Gel width" onCommit={(v)=>v!==null&&setMeta([r.id],{widthMm:v})}/></td>
<td className="num strong">{fmt(x.plateau.meanN,4)}</td><td className="num strong">{fmt(x.toughnessJm2,2)}</td><td className="num">{fmt(x.plateau.cv*100,1)}</td>
<td className="num">{fmt(x.initiationPeak?.forceN,4)}</td><td className="num">{fmt(x.peelRateMmS,3)}</td><td>{fmt(x.window.fromMm,1)}–{fmt(x.window.toMm,1)} ({x.window.n})</td>
<td><select value={m.failureMode} onChange={(e)=>setMeta([r.id],{failureMode:e.target.value as FailureMode})}>{LOCI.map((k)=><option key={k} value={k}>{FAILURE_MODE_LABEL[k]}</option>)}</select></td>
<td><select value={m.peelMorphology ?? 'unspecified'} onChange={(e)=>setMeta([r.id],{peelMorphology:e.target.value as PeelMorphology})}>{MORPH.map((k)=><option key={k.value} value={k.value}>{k.label}</option>)}</select></td>
<td><input className="obs-note" value={m.observation ?? ''} placeholder="observation" onChange={(e)=>setMeta([r.id],{observation:e.target.value})}/></td>
<td><NumberField compact allowEmpty min={0} value={m.fibrilZoneMm ?? null} placeholder="—" label="Fibrillated-zone length S" onCommit={(v)=>setMeta([r.id],{fibrilZoneMm:v})}/></td>
<td><NumberField compact allowEmpty min={0} value={m.maxFibrilMm ?? null} placeholder="—" label="Maximum fibril length a_f" onCommit={(v)=>setMeta([r.id],{maxFibrilMm:v})}/></td></tr>}
export function PeelResults(){const{selected}=usePeel();const ok=selected.filter((r)=>r.result.ok);if(!selected.length)return <p className="note pad">Tick runs in step 2 on the left to see their results.</p>;
const byFile=new Map<string,typeof ok>();for(const r of ok)byFile.set(r.file.fileId,[...(byFile.get(r.file.fileId)??[]),r]);
const repeats=[...byFile.entries()].map(([fileId,runs])=>({fileId,runs,label:runs[0].file.name,condition:runs[0].condition,props:Object.fromEntries(PEEL_PROPERTIES.map((p)=>[p.key,describe(runs.map((r)=>p.get(r.result))).mean]))}));
const conditions=[...new Set(repeats.map((r)=>r.condition))];
return <div className="ls-results"><p className="note">Primary normalized result: measured peel energy G<sub>peel</sub> = F̄<sub>ss</sub>/w at 90°. The automatic pre-steady-state maximum is not automatically a crack-initiation force. Failure locus and peel-front morphology are recorded separately.</p>
<div className="table-scroll ls-table-wrap"><table className="grid ls-table"><thead><tr><th>Run</th><th>Width (mm)</th><th>F̄<sub>ss</sub> (N)</th><th>G<sub>peel</sub> (J/m²)</th><th>CV (%)</th><th>Pre-SS max (N)</th><th>Rate (mm/s)</th><th>Window mm (n)</th><th>Failure locus</th><th>Morphology</th><th>Observation</th><th>S (mm)</th><th>a<sub>f</sub> (mm)</th></tr></thead><tbody>
{selected.map((r)=>r.result.ok?<Row key={r.id} r={r} color={CURVE_COLORS[ok.indexOf(r)%CURVE_COLORS.length]}/>:<tr key={r.id}><td>{r.label}</td><td colSpan={12}>{r.result.error}</td></tr>)}</tbody></table></div>
<h3 className="ls-h">Mean ± SD per Repeat/file</h3><div className="table-scroll"><table className="grid ls-summary"><thead><tr><th>Repeat/file</th><th>Condition</th><th>Runs</th>{PEEL_PROPERTIES.map((p)=><th key={p.key}>{p.label}<br/><small>({p.unit})</small></th>)}</tr></thead><tbody>
{repeats.map((rp)=><tr key={rp.fileId}><td>{rp.label}</td><td>{rp.condition}</td><td>{rp.runs.length}</td>{PEEL_PROPERTIES.map((p)=><td key={p.key}>{ms(rp.runs.map((r)=>p.get(r.result)),p.digits)}</td>)}</tr>)}</tbody></table></div>
<h3 className="ls-h">Mean ± SD per condition (over Repeat/file means)</h3><div className="table-scroll"><table className="grid ls-summary"><thead><tr><th>Condition</th><th>Repeats</th><th>Runs</th>{PEEL_PROPERTIES.map((p)=><th key={p.key}>{p.label}<br/><small>({p.unit})</small></th>)}</tr></thead><tbody>
{conditions.map((c)=>{const reps=repeats.filter((r)=>r.condition===c);return <tr key={c}><td>{c}</td><td>{reps.length}</td><td>{reps.reduce((n,r)=>n+r.runs.length,0)}</td>{PEEL_PROPERTIES.map((p)=><td key={p.key}>{ms(reps.map((r)=>r.props[p.key]),p.digits)}</td>)}</tr>})}</tbody></table></div><p className="note">Each file/Repeat counts once at condition level.</p>
<h3 className="ls-h">Definitions</h3><dl className="ls-definitions note">{PEEL_DEFINITIONS.map(([a,b])=><div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl></div>}
