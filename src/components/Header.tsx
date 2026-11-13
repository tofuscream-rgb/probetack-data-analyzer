import { useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { ProcessedExport } from './ProcessedExport';
import { useApp } from '../state/AppContext';
import { APP_VERSION, ALGORITHM_VERSION } from '../types';

function SaveDialog({ onClose }: { onClose: () => void }) {
  const { saveProject, filesByMode, pending } = useApp();
  const [mode, setMode] = useState<'settings' | 'complete'>('settings');
  const size = [...filesByMode.tack, ...filesByMode.lapShear, ...filesByMode.peel].reduce((s, f) => s + f.parsed.sizeBytes, 0);
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

function PrivacyDialog({ onClose }: { onClose: () => void }) {
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
  const { project, update, files, filesByMode, loadProject, storageNote } = useApp();
  const anyFiles = filesByMode.tack.length + filesByMode.lapShear.length + filesByMode.peel.length > 0;
  const [dialog, setDialog] = useState<'save' | 'export' | 'privacy' | null>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const tackChoices = Object.keys(project.runOverrides).length + Object.keys(project.excludedPoints).length + Object.keys(project.tackMetrics.excludedRepeats).length + Object.keys(project.tackMetrics.excludedSessions).length > 0 || project.settings.exclusionRule !== 'keepAll';
  const runMode = project.mode === 'lapShear' || project.mode === 'peel' ? project.mode : null;
  const hasExclusions = runMode ? Object.keys(project[runMode].analysisInclusion ?? {}).length > 0 : tackChoices;
  return (
    <header className="app-header">
      <div className="brand">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <path d="M2 6 H8 C10 6 10.5 7 11 9 C12 16 14 21 16 21 C18 21 19 15 20 11 C20.5 9 21 6 24 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span className="brand-name">Mach-1 Analyzer</span>
      </div>
      <input className="project-name" value={project.name} onChange={(e) => update((p) => ({ ...p, name: e.target.value }))} aria-label="Project name" />
      <div className="mode-switch" role="group" aria-label="Experiment type">
        <span>Experiment type</span>
        <div className="segmented">
          <button className={project.mode === 'tack' ? 'on' : ''} aria-pressed={project.mode === 'tack'} onClick={() => update((p) => ({ ...p, mode: 'tack' }))}>Probe Tack</button>
          <button className={project.mode === 'lapShear' ? 'on' : ''} aria-pressed={project.mode === 'lapShear'} onClick={() => update((p) => ({ ...p, mode: 'lapShear' }))}>Lap Shear</button>
          <button className={project.mode === 'peel' ? 'on' : ''} aria-pressed={project.mode === 'peel'} onClick={() => update((p) => ({ ...p, mode: 'peel' }))}>90° Peel</button>
        </div>
      </div>
      {storageNote && <span className="storage-note" title={storageNote}>Autosave limited</span>}
      <div className="spacer" />
      <button onClick={() => projectInput.current?.click()}>Load project</button>
      <input ref={projectInput} type="file" hidden accept=".zip" onChange={(e) => { const f = e.target.files?.[0]; if (f) loadProject(f); e.target.value = ''; }} />
      <button onClick={() => setDialog('save')} disabled={!anyFiles && !Object.keys(project.overrides).length}>Save project</button>
      <button className="primary" onClick={() => setDialog('export')} disabled={!files.length}>Export Excel</button>
      <button
        disabled={!hasExclusions}
        title={runMode ? 'Clear every In average choice of this test: every valid run counts again' : 'Clear every manual exclusion and set the automatic rule to Keep all points'}
        onClick={() => {
          if (runMode) {
            if (window.confirm(`Restore original data? Every In average choice of ${runMode === 'lapShear' ? 'Lap Shear' : '90° Peel'} is cleared, so every valid run counts again. Raw data were never changed.`)) {
              update((p) => (runMode === 'lapShear' ? { ...p, lapShear: { ...p.lapShear, analysisInclusion: {} } } : { ...p, peel: { ...p.peel, analysisInclusion: {} } }));
            }
            return;
          }
          if (window.confirm('Restore original data? All manual exclusions (runs, Repeats and sessions) are cleared and the automatic rule is set to “Keep all points”. Raw data were never changed.')) {
            update((p) => ({ ...p, runOverrides: {}, excludedPoints: {}, settings: { ...p.settings, exclusionRule: 'keepAll' }, tackMetrics: { ...p.tackMetrics, excludedRepeats: {}, excludedSessions: {} } }));
          }
        }}
      >
        Restore original data
      </button>
      <button className="link privacy" onClick={() => setDialog('privacy')}>Privacy</button>
      {dialog === 'save' && <SaveDialog onClose={() => setDialog(null)} />}
      {dialog === 'export' && <ProcessedExport mode={project.mode} onClose={() => setDialog(null)} />}
      {dialog === 'privacy' && <PrivacyDialog onClose={() => setDialog(null)} />}
    </header>
  );
}
