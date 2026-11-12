import { useApp } from '../../state/AppContext';
import { useLapShear } from '../../state/lapShear';
import type { LapShearState } from '../../types';
import { ImportStatus } from '../FilesTab';
import { LapShearGraph } from './LapShearGraph';
import { LapShearResults } from './LapShearResults';
import { LapShearSettings } from './LapShearSettings';
import { RunCompare } from '../RunCompare';
import { AdhesionDataAnalysis } from '../AdhesionDataAnalysis';
import { SUMMARY_PROPERTIES } from '../../analysis/lapShear';

const DIGITS: Record<string, number> = { gf: 2, N: 4, kPa: 3, MPa: 6, mm: 3, s: 2, mJ: 3, 'J/m²': 2 };
const METRICS = SUMMARY_PROPERTIES.map((p) => ({ key: p.key, label: p.label, unit: p.unit, digits: DIGITS[p.unit] ?? 3 }));

function LapShearAnalysis() {
  const { meta, update } = useApp();
  const { ls, picked, selected } = useLapShear();
  return (
    <AdhesionDataAnalysis
      mode="lapShear"
      rows={picked.map((r) => ({
        id: r.id, fileId: r.file.fileId, path: r.file.path, name: r.file.name, number: r.cycle.cycleNumber,
        cond: r.cond.hold === '—' && r.cycle.holdTimeS !== null ? { ...r.cond, hold: String(r.cycle.holdTimeS) } : r.cond,
        gel: meta.get(r.file.fileId)?.gel.value ?? null,
        primary: r.result.peak?.forceN ?? NaN,
        peakN: r.result.peak?.forceN ?? NaN,
        normalized: r.result.strengthKPa,
        workMJ: r.result.work.toFailureMJ ?? r.result.work.fullMJ,
        incomplete: r.result.ok && r.result.work.toFailureMJ === null,
        note: [r.result.error, ...r.result.warnings].filter(Boolean).join(' · '),
      }))}
      graphed={selected.filter((r) => r.result.ok).map((r) => r.id)}
      inclusion={ls.analysisInclusion ?? {}}
      setInclusion={(id, value) => update((p) => {
        const analysisInclusion = { ...p.lapShear.analysisInclusion };
        if (value === null) delete analysisInclusion[id];
        else analysisInclusion[id] = value;
        return { ...p, lapShear: { ...p.lapShear, analysisInclusion } };
      })}
    />
  );
}

function LapShearCompare() {
  const { ls, selectedAll, set } = useLapShear();
  const items = selectedAll.filter((r) => r.result.ok).map((r) => ({ id: r.id, cond: r.cond, values: Object.fromEntries(SUMMARY_PROPERTIES.map((p) => [p.key, p.get(r.result)])) }));
  return (
    <RunCompare
      items={items}
      metrics={METRICS}
      sel={ls.compare}
      setSel={(patch) => set({ compare: { ...ls.compare, ...patch } })}
      fileName="lap_shear_comparison"
      note="Strength and work per area are computed per run with its own bonded area before averaging."
    />
  );
}

const TABS: { id: LapShearState['tab']; label: string; minor?: boolean }[] = [
  { id: 'graph', label: 'Graph' },
  { id: 'analysis', label: 'Data analysis' },
  { id: 'results', label: 'Lap Shear metrics' },
  { id: 'compare', label: 'Compare charge ratios' },
  { id: 'settings', label: 'Settings' },
  { id: 'files', label: 'Files', minor: true },
];

/** Main area in Lap Shear mode. */
export function LapShearWorkspace() {
  const { files } = useApp();
  const { ls, set, selected } = useLapShear();
  const problems = files.filter((f) => f.parsed.status !== 'ok').length;
  return (
    <section className="main-area">
      <div className="main-tabs" role="tablist" aria-label="Lap-shear views">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={ls.tab === t.id} className={`tab ${ls.tab === t.id ? 'active' : ''} ${t.minor ? 'minor' : ''}`} onClick={() => set({ tab: t.id })}>
            {t.label}
            {t.id === 'results' && selected.length > 0 && <span className="count">{selected.length}</span>}
            {t.id === 'files' && files.length > 0 && <span className={`count ${problems ? 'warn' : ''}`}>{problems || files.length}</span>}
          </button>
        ))}
      </div>
      <div className={`main-body tab-${ls.tab === 'graph' ? 'graph' : ls.tab === 'files' ? 'files' : 'summary'}`} role="tabpanel">
        {ls.tab === 'graph' && <LapShearGraph />}
        {ls.tab === 'analysis' && <LapShearAnalysis />}
        {ls.tab === 'results' && <LapShearResults />}
        {ls.tab === 'compare' && <LapShearCompare />}
        {ls.tab === 'settings' && <LapShearSettings />}
        {ls.tab === 'files' && <ImportStatus />}
      </div>
    </section>
  );
}
