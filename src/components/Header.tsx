import { useRef, useState, type ReactNode } from 'react';
import { useApp } from '../state/AppContext';
import { APP_VERSION, ALGORITHM_VERSION } from '../types';

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>{title}</h2>
          <button className="icon" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SaveDialog({ onClose }: { onClose: () => void }) {
  const { saveProject, files, pending } = useApp();
  const [mode, setMode] = useState<'settings' | 'complete'>('settings');
  const size = files.reduce((s, f) => s + f.parsed.sizeBytes, 0);
  return (
    <Dialog title="Save project" onClose={onClose}>
      <label className="choice">
        <input type="radio" checked={mode === 'settings'} onChange={() => setMode('settings')} />
        <div>
          <strong>Settings only</strong>
          <p>Analysis settings, metadata corrections, exclusions with reasons, graphs and file identifiers (names and SHA-256 fingerprints). No measurements. When you reopen it, you select the original TXT files again and they are matched automatically.</p>
        </div>
      </label>
      <label className="choice">
        <input type="radio" checked={mode === 'complete'} onChange={() => setMode('complete')} />
        <div>
          <strong>Complete portable project</strong>
          <p>Everything above plus copies of the original TXT files ({(size / 1e6).toFixed(1)} MB), so the project opens without re-selecting files.</p>
          {mode === 'complete' && (
            <p className="note warn">This file contains your unpublished experimental data. Store and share it as confidential research data. Do not upload it to the public GitHub repository.</p>
          )}
        </div>
      </label>
      {pending.length > 0 && mode === 'complete' && <p className="note warn">{pending.length} file(s) are not loaded and cannot be included.</p>}
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={() => { saveProject(mode); onClose(); }}>Download project (.zip)</button>
      </div>
    </Dialog>
  );
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const { project, visible, derived, exportExcel } = useApp();
  const [scope, setScope] = useState<'selected' | 'shown' | 'all'>(project.selection.length ? 'selected' : 'shown');
  const [graphIds, setGraphIds] = useState(project.graphs.filter((g) => g.cycleIds.length).map((g) => g.id));
  const [processed, setProcessed] = useState(project.settings.exclusionRule !== 'keepAll' || Object.keys(project.excludedPoints).length > 0);
  const ids =
    scope === 'selected' ? project.selection.filter((id) => derived.results.has(id)) : scope === 'shown' ? visible.map((r) => r.cycle.cycleId) : derived.ordered.map((r) => r.cycle.cycleId);
  const points = ids.reduce((s, id) => s + (derived.results.get(id)?.cycle.force_gf.length ?? 0), 0);
  return (
    <Dialog title="Export to Excel" onClose={onClose}>
      <fieldset>
        <legend>Runs for the data sheets</legend>
        <label className="radio"><input type="radio" checked={scope === 'selected'} onChange={() => setScope('selected')} /> Selected runs ({project.selection.length})</label>
        <label className="radio"><input type="radio" checked={scope === 'shown'} onChange={() => setScope('shown')} /> Runs matching the current filters ({visible.length})</label>
        <label className="radio"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> All imported runs ({derived.ordered.length})</label>
        <p className="note">{points.toLocaleString()} measurement points will be written to each of the Raw, Flagged and Processed sheets.</p>
      </fieldset>
      <fieldset>
        <legend>Graphs to include as native, editable Excel charts</legend>
        {project.graphs.map((g) => (
          <label key={g.id} className="radio">
            <input type="checkbox" checked={graphIds.includes(g.id)} disabled={!g.cycleIds.length} onChange={(e) => setGraphIds((x) => (e.target.checked ? [...x, g.id] : x.filter((y) => y !== g.id)))} />
            {g.title} ({g.cycleIds.length} curves)
          </label>
        ))}
        <label className="radio">
          <input type="checkbox" checked={processed} onChange={(e) => setProcessed(e.target.checked)} /> Chart the processed curves (excluded points left as gaps)
        </label>
      </fieldset>
      <p className="note">
        Sheets: Experiment Summary, Run Summary, Raw Data, Flagged Data, Processed Data, Statistical Summary, Charts, Analysis Settings. The file is
        built in this browser and downloaded directly.
      </p>
      <div className="dialog-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!ids.length} onClick={() => { exportExcel(ids, graphIds, processed); onClose(); }}>
          Download workbook
        </button>
      </div>
    </Dialog>
  );
}

export function PrivacyDialog({ onClose }: { onClose: () => void }) {
  const { removeAllData } = useApp();
  return (
    <Dialog title="Where your data goes" onClose={onClose}>
      <div className="prose">
        <p>
          This website is a set of static files. When you open TXT files, folders or ZIP archives, your browser reads them on this computer. Parsing,
          statistics, graphs, Excel files and project files are all made here. The page has no server to send data to, no accounts and no analytics.
          A Content-Security-Policy tells the browser to block any connection to other servers.
        </p>
        <p>
          <strong>Kept in this browser:</strong> your current session (settings and copies of imported files) is autosaved in this browser’s IndexedDB
          storage, so you can resume after closing the tab. It is not a backup. Clearing site data, private windows or low disk space can remove it.
          Anyone who uses this computer account and browser can see it. Use Save project for anything you want to keep.
        </p>
        <p>
          <strong>Limits:</strong> this protects your data only as long as the website code itself is trustworthy. A malicious code change to the
          repository or a compromised dependency could change that behaviour. Browser extensions can read pages you open. Other GitHub Pages sites
          published under the same account share this website’s browser storage area.
        </p>
        <p className="note">Version {APP_VERSION}, algorithm {ALGORITHM_VERSION}.</p>
      </div>
      <div className="dialog-actions">
        <button
          className="danger"
          onClick={async () => {
            if (window.confirm('Remove all imported data, settings and autosaved sessions from this page and this browser?')) {
              await removeAllData();
              onClose();
            }
          }}
        >
          Remove all data from this browser
        </button>
        <button className="primary" onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

export function Header() {
  const { project, update, files, loadProject, storageNote } = useApp();
  const [dialog, setDialog] = useState<'save' | 'export' | 'privacy' | null>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const hasExclusions = Object.keys(project.runOverrides).length + Object.keys(project.excludedPoints).length > 0 || project.settings.exclusionRule !== 'keepAll';
  return (
    <header className="app-header">
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <path d="M2 6 H8 C10 6 10.5 7 11 9 C12 16 14 21 16 21 C18 21 19 15 20 11 C20.5 9 21 6 24 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="brand-name">Mach-1 Analyzer</span>
      </div>
      <input className="project-name" value={project.name} onChange={(e) => update((p) => ({ ...p, name: e.target.value }))} aria-label="Project name" />
      {storageNote && <span className="storage-note" title={storageNote}>Autosave limited</span>}
      <div className="spacer" />
      <button onClick={() => projectInput.current?.click()}>Load project</button>
      <input ref={projectInput} type="file" hidden accept=".zip" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadProject(f); e.target.value = ''; }} />
      <button onClick={() => setDialog('save')} disabled={!files.length && !Object.keys(project.overrides).length}>Save project</button>
      <button className="primary" onClick={() => setDialog('export')} disabled={!files.length}>Export Excel</button>
      <button
        disabled={!hasExclusions}
        title="Clear every manual exclusion and set the automatic rule to Keep all points"
        onClick={() => {
          if (window.confirm('Restore original data? All manual exclusions are cleared and the automatic rule is set to “Keep all points”. Raw data were never changed.')) {
            update((p) => ({ ...p, runOverrides: {}, excludedPoints: {}, settings: { ...p.settings, exclusionRule: 'keepAll' } }));
          }
        }}
      >
        Restore original data
      </button>
      <button className="link privacy" onClick={() => setDialog('privacy')}>Privacy</button>
      {dialog === 'save' && <SaveDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === 'privacy' && <PrivacyDialog onClose={() => setDialog(null)} />}
    </header>
  );
}
