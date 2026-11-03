import { useApp } from '../../state/AppContext';
import { usePeel } from '../../state/peel';
import type { PeelState } from '../../types';
import { ImportStatus } from '../FilesTab';
import { PeelGraph } from './PeelGraph';
import { PeelResults } from './PeelResults';
import { PeelSettings } from './PeelSettings';

const TABS: { id: PeelState['tab']; label: string; minor?: boolean }[] = [
  { id: 'graph', label: 'Graph' },
  { id: 'results', label: 'Results' },
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
        {ps.tab === 'settings' && <PeelSettings />}
        {ps.tab === 'files' && <ImportStatus />}
      </div>
    </section>
  );
}
