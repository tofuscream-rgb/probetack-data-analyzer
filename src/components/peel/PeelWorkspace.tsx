import { useApp } from '../../state/AppContext';
import { usePeel } from '../../state/peel';
import type { PeelState } from '../../types';
import { ImportStatus } from '../FilesTab';
import { PeelGraph } from './PeelGraph';
import { PeelResults } from './PeelResults';
import { PeelSettings } from './PeelSettings';
import { RunCompare } from '../RunCompare';
import { PEEL_PROPERTIES } from '../../analysis/peel';

const METRICS = PEEL_PROPERTIES.map((p) => ({ key: p.key, label: p.label, unit: p.unit, digits: p.digits }));

function PeelCompare() {
  const { ps, selectedAll, set } = usePeel();
  // Compare uses the ticked runs of every experiment; it has its own substrate / charge ratio choices.
  const items = selectedAll.filter((r) => r.result.ok).map((r) => ({ id: r.id, cond: r.cond, values: Object.fromEntries(PEEL_PROPERTIES.map((p) => [p.key, p.get(r.result)])) }));
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
  { id: 'results', label: 'Results' },
  { id: 'compare', label: 'Compare charge ratios' },
  { id: 'settings', label: 'Settings' },
  { id: 'files', label: 'Files', minor: true },
];

/** Main area in 90° peel mode. */
export function PeelWorkspace() {
  const { files } = useApp();
  const { ps, set, selected } = usePeel();
  const problems = files.filter((f) => f.parsed.status !== 'ok').length;
  return (
    <section className="main-area">
      <div className="main-tabs" role="tablist" aria-label="90° peel views">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={ps.tab === t.id} className={`tab ${ps.tab === t.id ? 'active' : ''} ${t.minor ? 'minor' : ''}`} onClick={() => set({ tab: t.id })}>
            {t.label}
            {t.id === 'results' && selected.length > 0 && <span className="count">{selected.length}</span>}
            {t.id === 'files' && files.length > 0 && <span className={`count ${problems ? 'warn' : ''}`}>{problems || files.length}</span>}
          </button>
        ))}
      </div>
      <div className={`main-body tab-${ps.tab === 'graph' ? 'graph' : ps.tab === 'files' ? 'files' : 'summary'}`} role="tabpanel">
        {ps.tab === 'graph' && <PeelGraph />}
        {ps.tab === 'results' && <PeelResults />}
        {ps.tab === 'compare' && <PeelCompare />}
        {ps.tab === 'settings' && <PeelSettings />}
        {ps.tab === 'files' && <ImportStatus />}
      </div>
    </section>
  );
}
