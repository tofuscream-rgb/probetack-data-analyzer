import { useApp } from '../../state/AppContext';
import { useLapShear } from '../../state/lapShear';
import type { LapShearState } from '../../types';
import { ImportStatus } from '../FilesTab';
import { LapShearGraph } from './LapShearGraph';
import { LapShearResults } from './LapShearResults';
import { LapShearSettings } from './LapShearSettings';

const TABS: { id: LapShearState['tab']; label: string; minor?: boolean }[] = [
  { id: 'graph', label: 'Graph' },
  { id: 'results', label: 'Results' },
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
        {ls.tab === 'results' && <LapShearResults />}
        {ls.tab === 'settings' && <LapShearSettings />}
        {ls.tab === 'files' && <ImportStatus />}
      </div>
    </section>
  );
}
