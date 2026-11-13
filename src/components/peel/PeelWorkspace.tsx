import { ContextBar } from '../ContextBar';
import { useApp } from '../../state/AppContext';
import { usePeel } from '../../state/peel';
import type { PeelState } from '../../types';
import { ImportStatus } from '../FilesTab';
import { PeelGraph } from './PeelGraph';
import { PeelResults } from './PeelResults';
import { PeelSettings } from './PeelSettings';
import { RunCompare } from '../RunCompare';
import { AdhesionDataAnalysis } from '../AdhesionDataAnalysis';
import { includedRuns, peelAnalysisRow } from '../../analysis/adhesionReview';
import { useMemo } from 'react';
import { PEEL_PROPERTIES } from '../../analysis/peel';
import { FAILURE_MODES } from '../../analysis/observations';
import { fmt } from '../common';

// Compare offers measured results only; the peel rate is a test setting (the same for every run), not an outcome.
const METRICS = PEEL_PROPERTIES.filter((p) => p.key !== 'rate').map((p) => ({ key: p.key, label: p.label, unit: p.unit, digits: p.digits }));

function PeelAnalysis() {
  const { meta, update } = useApp();
  const { ps, picked, selected } = usePeel();
  return (
    <AdhesionDataAnalysis
      mode="peel"
      rows={picked.map((r) => peelAnalysisRow(r, meta.get(r.file.fileId)?.gel.value ?? null))}
      graphed={selected.filter((r) => r.result.ok).map((r) => r.id)}
      inclusion={ps.analysisInclusion ?? {}}
      detailOf={(id) => {
        const r = picked.find((x) => x.id === id);
        if (!r) return null;
        const x = r.result;
        return {
          file: r.file, cycle: r.cycle, curve: x.curve, endMm: x.detach.dispMm, endLabel: x.detach.source === 'manual' ? 'detachment (typed)' : 'detachment',
          facts: [
            ['Gel', `${fmt(r.meta.lengthMm, 1)} × ${fmt(r.meta.widthMm, 2)} × ${fmt(r.meta.thicknessMm, 2)} mm (L × w × t), peel angle ${fmt(r.meta.angleDeg, 0)}°`],
            ['Steady-state window', `${fmt(x.window.fromMm, 1)}–${fmt(x.window.toMm, 1)} mm (${x.window.n} points), CV ${fmt(x.plateau.cv * 100, 1)} %`],
            ['Detachment', x.detach.dispMm !== null ? `${fmt(x.detach.dispMm, 2)} mm (${x.detach.source})` : x.detach.note || 'not detected'],
            ['Peel rate', `${fmt(x.peelRateMmS, 3)} mm/s`],
            ['Failure mode', FAILURE_MODES.find((k) => k.value === r.meta.failureMode)?.label ?? r.meta.failureMode],
            ...(r.meta.observation ? [['Observation', r.meta.observation] as [string, string]] : []),
          ],
        };
      }}
      setInclusion={(id, value) => update((p) => {
        const analysisInclusion = { ...p.peel.analysisInclusion };
        if (value === null) delete analysisInclusion[id];
        else analysisInclusion[id] = value;
        return { ...p, peel: { ...p.peel, analysisInclusion } };
      })}
    />
  );
}

function PeelCompare() {
  const { meta } = useApp();
  const { ps, runs, set } = usePeel();
  // Every enabled run, with the review decisions of Data analysis; the tab has its own filters.
  const included = useMemo(() => includedRuns(runs.map((r) => peelAnalysisRow(r, meta.get(r.file.fileId)?.gel.value ?? null)), ps.analysisInclusion ?? {}),
    [runs, meta, ps.analysisInclusion]);
  const items = runs.filter((r) => r.result.ok).map((r) => ({ id: r.id, cond: r.cond, included: included.has(r.id), values: Object.fromEntries(PEEL_PROPERTIES.map((p) => [p.key, p.get(r.result)])) }));
  return (
    <RunCompare
      items={items}
      metrics={METRICS}
      sel={ps.compare}
      setSel={(patch) => set({ compare: { ...ps.compare, ...patch } })}
      fileName="peel_90_comparison"
      note="Peel strength and peel energy are computed per run with its own gel width before averaging."
    />
  );
}

const TABS: { id: PeelState['tab']; label: string; minor?: boolean }[] = [
  { id: 'graph', label: 'Graph' },
  { id: 'analysis', label: 'Data analysis' },
  { id: 'results', label: 'Peel metrics' },
  { id: 'compare', label: 'Compare charge ratios' },
  { id: 'settings', label: 'Settings' },
  { id: 'files', label: 'Files', minor: true },
];

/** Main area in 90° peel mode. */
export function PeelWorkspace() {
  const { files } = useApp();
  const { ps, set } = usePeel();
  const problems = files.filter((f) => f.parsed.status !== 'ok').length;
  return (
    <section className="main-area">
      <ContextBar />
      <div className="main-tabs" role="tablist" aria-label="90° peel views">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={ps.tab === t.id} className={`tab ${ps.tab === t.id ? 'active' : ''} ${t.minor ? 'minor' : ''}`} onClick={() => set({ tab: t.id })}>
            {t.label}
            {t.id === 'files' && files.length > 0 && <span className={`count ${problems ? 'warn' : ''}`}>{problems || files.length}</span>}
          </button>
        ))}
      </div>
      <div className={`main-body tab-${ps.tab === 'graph' ? 'graph' : ps.tab === 'files' ? 'files' : 'summary'}`} role="tabpanel">
        {ps.tab === 'graph' && <PeelGraph />}
        {ps.tab === 'analysis' && <PeelAnalysis />}
        {ps.tab === 'results' && <PeelResults />}
        {ps.tab === 'compare' && <PeelCompare />}
        {ps.tab === 'settings' && <PeelSettings />}
        {ps.tab === 'files' && <ImportStatus />}
      </div>
    </section>
  );
}
