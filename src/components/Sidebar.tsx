import { useRef, useState } from 'react';
import { useApp } from '../state/AppContext';
import { useExperiment, type ExperimentFile } from '../state/experiment';
import { isIncluded, STATUS_LABEL, type CycleResult } from '../analysis/engine';
import { QC_LABEL } from '../analysis/pointOutliers';
import { QC_COLORS } from '../plotting/colors';

type ImportMode = 'folder' | 'files' | 'zip';

/** One tick per run: colour = flag, filled = used in averages, hollow = left out. */
export function QcRibbon({ cycles }: { cycles: CycleResult[] }) {
  return (
    <span className="ribbon" aria-label="Runs: colour = flag; filled = used in averages, hollow = left out">
      {cycles.map((c) => (
        <i
          key={c.cycle.cycleId}
          style={{ background: isIncluded(c) ? QC_COLORS[c.qc] : 'transparent', borderColor: QC_COLORS[c.qc] }}
          title={`Run ${c.cycle.cycleNumber}: ${QC_LABEL[c.qc]}. ${STATUS_LABEL[c.status]}.`}
        />
      ))}
    </span>
  );
}

const sizeLabel = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`);
const holdLabel = (e: ExperimentFile) => (e.holdTimeS !== null ? `${e.holdTimeS} s` : '');

export function Sidebar() {
  const { files, pending, importFiles, loadExample, update } = useApp();
  const ex = useExperiment();
  const [mode, setMode] = useState<ImportMode>('folder');
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const browse = () => (mode === 'folder' ? folderInput : mode === 'files' ? fileInput : zipInput).current?.click();
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) importFiles(e.target.files);
    e.target.value = '';
  };
  const others = ex.files.filter((e) => e !== ex.main);
  const overlayIds = ex.overlayFiles.map((e) => e.file.fileId);
  const setOverlay = (ids: string[]) => ex.set({ overlayFileIds: ids });

  return (
    <nav className="sidebar" aria-label="Open and choose experiments">
      <section className="step">
        <h2>1. Open your experiments</h2>
        <fieldset className="radio-group">
          <legend>Import</legend>
          {([
            ['folder', 'Choose folder'],
            ['files', 'Choose TXT file(s)'],
            ['zip', 'ZIP file'],
          ] as [ImportMode, string][]).map(([m, label]) => (
            <label key={m} className="radio">
              <input type="radio" name="import-mode" checked={mode === m} onChange={() => setMode(m)} /> {label}
            </label>
          ))}
        </fieldset>
        <button className="primary browse" onClick={browse}>
          {mode === 'folder' ? 'Browse for experiment folder' : mode === 'files' ? 'Browse for TXT files' : 'Browse for ZIP file'}
        </button>
        <input ref={folderInput} type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={onPick} />
        <input ref={fileInput} type="file" hidden multiple accept=".txt,text/plain" onChange={onPick} />
        <input ref={zipInput} type="file" hidden accept=".zip,application/zip" onChange={onPick} />
        {files.length > 0 && (
          <ul className="file-list" aria-label="Imported files">
            {files.map((l) => (
              <li key={l.parsed.fileId} title={l.parsed.path}>
                <span className="file-icon" aria-hidden="true" />
                <span className="fl-name">{l.parsed.path}</span>
                <small>{sizeLabel(l.parsed.sizeBytes)}{l.parsed.status !== 'ok' ? ' · see Files tab' : ''}</small>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          {files.length > 0 ? `${files.length} TXT file(s) loaded; subfolders are preserved. ` : 'You can also drag a folder onto the page. '}
          Files are read on this computer only.
        </p>
        {pending.length > 0 && (
          <div className="banner warn">
            <strong>{pending.length} project file(s) not connected.</strong> Select the original folder or files; they are matched by content, so moved files are found too.
          </div>
        )}
        {!files.length && (
          <button className="link" onClick={loadExample}>
            Try it with example data
          </button>
        )}
      </section>

      <section className="step">
        <h2>2. Choose your experiment</h2>
        {!ex.hasData ? (
          <p className="hint">Open a folder first. Sub-folders such as <em>0.25 (2.5M)/Glass/</em> are read as charge ratio, concentration and substrate.</p>
        ) : (
          <>
            <label className="field">
              <span>Charge ratio</span>
              <select value={ex.chargeRatio ?? ''} onChange={(e) => ex.set({ chargeRatio: e.target.value, fileId: null })}>
                {ex.crOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Total monomer concentration</span>
              <select value={ex.concentrationM ?? ''} onChange={(e) => ex.set({ concentrationM: e.target.value, fileId: null })}>
                {ex.concOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Substrate</span>
              <select value={ex.substrate ?? ''} onChange={(e) => ex.set({ substrate: e.target.value, fileId: null })}>
                {ex.substrateOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="field">
              <span>TXT file to view</span>
              <select value={ex.main?.file.fileId ?? ''} onChange={(e) => ex.set({ fileId: e.target.value })}>
                {ex.files.map((e) => (
                  <option key={e.file.fileId} value={e.file.fileId}>
                    {e.file.name}{holdLabel(e) ? ` (${holdLabel(e)} hold)` : ''}
                  </option>
                ))}
              </select>
            </label>
            {ex.main && (
              <p className="file-summary">
                {ex.main.runs.length} run(s) <QcRibbon cycles={ex.main.runs} />
              </p>
            )}
            <label className="check-row">
              <input type="checkbox" checked={ex.overlay} disabled={!others.length} onChange={(e) => ex.set({ overlay: e.target.checked })} /> Overlay additional TXT files
            </label>
            {ex.overlay && others.length > 0 && (
              <div className="overlay-list">
                <div className="overlay-actions">
                  <button className="link small" onClick={() => setOverlay(others.map((e) => e.file.fileId))}>Select all</button>
                  <button className="link small" onClick={() => setOverlay([])}>None</button>
                </div>
                {others.map((e) => (
                  <label key={e.file.fileId} className="check-row">
                    <input
                      type="checkbox"
                      checked={overlayIds.includes(e.file.fileId)}
                      onChange={(ev) => setOverlay(ev.target.checked ? [...overlayIds, e.file.fileId] : overlayIds.filter((x) => x !== e.file.fileId))}
                    />
                    <span className="ol-name">{e.file.name}</span>
                    <QcRibbon cycles={e.runs} />
                  </label>
                ))}
              </div>
            )}
            <p className="hint ribbon-legend">
              <span className="ribbon"><i style={{ background: QC_COLORS.green, borderColor: QC_COLORS.green }} /><i style={{ background: 'transparent', borderColor: QC_COLORS.red }} /></span>
              One tick per run, coloured by flag. Hollow = outlier left out of averages.
            </p>
            {ex.concOptions.find((o) => o.value === ex.concentrationM)?.label.includes('default') && (
              <p className="hint warn">
                No concentration was found in the folder names, so 2.1 M is assumed. Correct it in a run’s details (Data analysis tab).{' '}
                <button className="link small" onClick={() => update((p) => ({ ...p, mainTab: 'analysis' }))}>Open</button>
              </p>
            )}
          </>
        )}
      </section>
    </nav>
  );
}

