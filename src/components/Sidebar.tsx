import { useRef, useState } from 'react';
import { MODE_LABEL, disabledOf, useApp, withDisabled } from '../state/AppContext';
import { uniqueFileNames, useExperiment, type ExperimentFile } from '../state/experiment';
import { ExperimentPicker } from './ExperimentPicker';
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

/** Tri-state checkbox (some files of a folder selected). */
function TriCheck({ on, some, onChange, label }: { on: boolean; some: boolean; onChange: () => void; label: string }) {
  return <input type="checkbox" checked={on} ref={(el) => { if (el) el.indeterminate = some && !on; }} onChange={onChange} aria-label={label} />;
}

/** The imported files, grouped by folder. Unticked files stay listed but are left out of every calculation. */
function FileSelector() {
  const { files, project, update, removeFiles } = useApp();
  const mode = project.mode;
  const off = new Set(disabledOf(project, mode));
  const setOff = (ids: string[], disable: boolean) =>
    update((p) => {
      const cur = new Set(disabledOf(p, mode));
      ids.forEach((id) => (disable ? cur.add(id) : cur.delete(id)));
      return withDisabled(p, mode, [...cur]);
    });
  const remove = (ids: string[], what: string) => {
    if (window.confirm(`Remove ${what} from ${MODE_LABEL[mode]}? The files on your computer are not changed; you can import them again.`)) removeFiles(ids);
  };
  const folders = new Map<string, typeof files>();
  for (const l of files) {
    const dir = l.parsed.path.split('/').slice(0, -1).join('/') || '(top level)';
    folders.set(dir, [...(folders.get(dir) ?? []), l]);
  }
  const used = files.filter((l) => !off.has(l.parsed.fileId)).length;
  const common = commonFolder([...folders.keys()]);
  return (
    <>
      <div className="file-select-bar">
        <span>{used} of {files.length} enabled</span>
        <button className="link small" onClick={() => setOff(files.map((l) => l.parsed.fileId), false)}>Select all</button>
        <button className="link small" onClick={() => setOff(files.map((l) => l.parsed.fileId), true)}>None</button>
        <button className="link small danger-link" onClick={() => remove(files.map((l) => l.parsed.fileId), `all ${files.length} file(s)`)} title="Remove every file from this test">Remove all</button>
      </div>
      <div className="file-list" aria-label="Imported files: untick a file to leave it out">
        {[...folders].sort(([a], [b]) => naturalPath(a, b)).map(([dir, list]) => {
          const ids = list.map((l) => l.parsed.fileId);
          const n = ids.filter((id) => !off.has(id)).length;
          return (
            <div key={dir} className="fl-folder">
              <label className="fl-folder-head" title={dir}>
                <TriCheck on={n === ids.length} some={n > 0} onChange={() => setOff(ids, n === ids.length)} label={`Use all files in ${dir}`} />
                <span className="fl-name">{dir.slice(common.length) || dir}</span>
                <small>{n}/{ids.length}</small>
                <button className="icon fl-remove" title={`Remove the ${ids.length} file(s) of this folder from ${MODE_LABEL[mode]}`} onClick={(e) => { e.preventDefault(); remove(ids, `the ${ids.length} file(s) in “${dir}”`); }}>×</button>
              </label>
              {list
                .slice()
                .sort((a, b) => naturalPath(a.parsed.name, b.parsed.name))
                .map((l) => (
                  <label key={l.parsed.fileId} className={`fl-file ${off.has(l.parsed.fileId) ? 'off' : ''}`} title={l.parsed.path}>
                    <input type="checkbox" checked={!off.has(l.parsed.fileId)} onChange={(e) => setOff([l.parsed.fileId], !e.target.checked)} />
                    <span className="fl-name">{l.parsed.name}</span>
                    <small>{sizeLabel(l.parsed.sizeBytes)}{l.parsed.status !== 'ok' ? ' · see Files tab' : ''}</small>
                    <button className="icon fl-remove" title={`Remove ${l.parsed.name} from ${MODE_LABEL[mode]}`} onClick={(e) => { e.preventDefault(); remove([l.parsed.fileId], l.parsed.name); }}>×</button>
                  </label>
                ))}
            </div>
          );
        })}
      </div>
      <p className="hint">{common ? <>Folders inside <em>{common.replace(/\/$/, '')}</em>. </> : null}Untick a file to leave it out of every graph, result and export ({MODE_LABEL[mode]} only); × removes it from the page. Your original files are never changed.</p>
    </>
  );
}

/** Natural order of paths: numbers by value in each folder name (0.25 before 0.5, 2 s before 10 s). */
export function naturalPath(a: string, b: string): number {
  const x = a.split('/');
  const y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const nx = /^\d+(?:[.,]\d+)?/.exec(x[i]);
    const ny = /^\d+(?:[.,]\d+)?/.exec(y[i]);
    if (nx && ny) {
      const d = parseFloat(nx[0].replace(',', '.')) - parseFloat(ny[0].replace(',', '.'));
      if (d) return d;
    }
    const c = x[i].localeCompare(y[i], undefined, { numeric: true, sensitivity: 'base' });
    if (c) return c;
  }
  return x.length - y.length;
}

/** Folder prefix shared by every folder ("Probe tack/Tack Nov/"), shown once instead of on every row. */
function commonFolder(dirs: string[]): string {
  if (dirs.length < 2) return '';
  const parts = dirs.map((d) => d.split('/'));
  let n = 0;
  while (parts.every((p) => p.length > n + 1 && p[n] === parts[0][n])) n++;
  return n ? parts[0].slice(0, n).join('/') + '/' : '';
}

const sizeLabel = (bytes: number) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`);

/** What the import gave: usable files and runs of the enabled files, and anything skipped. */
function ImportSummary() {
  const { files, skipped, project, update } = useApp();
  const off = new Set(disabledOf(project, project.mode));
  const enabled = files.filter((l) => !off.has(l.parsed.fileId));
  const usable = enabled.filter((l) => l.parsed.status !== 'error' && l.cycles.length > 0);
  const runs = usable.reduce((n, l) => n + l.cycles.length, 0);
  const unusable = files.filter((l) => l.parsed.status === 'error' || l.cycles.length === 0).length;
  const warnings = files.filter((l) => l.parsed.status === 'warning').length;
  const openFiles = () => update((p) => project.mode === 'tack' ? { ...p, mainTab: 'files' } : project.mode === 'lapShear' ? { ...p, lapShear: { ...p.lapShear, tab: 'files' } } : { ...p, peel: { ...p.peel, tab: 'files' } });
  const problems = unusable + skipped.length + warnings;
  return (
    <div className="import-summary" role="status">
      <strong>{usable.length} usable file{usable.length === 1 ? '' : 's'} · {runs} run{runs === 1 ? '' : 's'}</strong>
      <span className="note">{files.length} imported{off.size ? `, ${files.length - off.size} enabled` : ', all enabled'}</span>
      {problems > 0 && (
        <span className="note warn">
          {[unusable && `${unusable} without usable data`, warnings && `${warnings} with warnings`, skipped.length && `${skipped.length} non-TXT skipped`].filter(Boolean).join(' · ')}{' '}
          <button className="link small" onClick={openFiles}>Details</button>
        </span>
      )}
    </div>
  );
}

/** Step 1, shared by every test: import a folder, TXT files or a ZIP, and enable the files to use. */
export function ImportStep() {
  const { files, pending, importFiles, loadExample, project } = useApp();
  const [mode, setMode] = useState<ImportMode>('folder');
  const folderInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const inputOf = (m: ImportMode) => (m === 'folder' ? folderInput : m === 'files' ? fileInput : zipInput);
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) importFiles(e.target.files);
    e.target.value = '';
  };
  const testName = project.mode === 'tack' ? 'probe-tack' : project.mode === 'lapShear' ? 'lap-shear' : '90° peel';
  return (
    <section className="step">
      <h2>1. Open {files.length ? 'files' : `your ${testName} files`}</h2>
      <input ref={folderInput} type="file" hidden multiple {...({ webkitdirectory: '', directory: '' } as Record<string, string>)} onChange={onPick} />
      <input ref={fileInput} type="file" hidden multiple accept=".txt,text/plain" onChange={onPick} />
      <input ref={zipInput} type="file" hidden accept=".zip,application/zip" onChange={onPick} />
      {files.length > 0 ? (
        <>
          <ImportSummary />
          <div className="add-files" role="group" aria-label="Add more files">
            <span>Add:</span>
            <button className="small" onClick={() => folderInput.current?.click()}>Folder</button>
            <button className="small" onClick={() => fileInput.current?.click()}>TXT files</button>
            <button className="small" onClick={() => zipInput.current?.click()}>ZIP</button>
          </div>
          <details className="enabled-files">
            <summary>Imported files — enable or disable</summary>
            <FileSelector />
          </details>
        </>
      ) : (
        <>
          <fieldset className="radio-group">
            <legend>Import</legend>
            {([
              ['folder', 'Folder (with sub-folders)'],
              ['files', 'TXT file(s)'],
              ['zip', 'ZIP file'],
            ] as [ImportMode, string][]).map(([m, label]) => (
              <label key={m} className="radio">
                <input type="radio" name="import-mode" checked={mode === m} onChange={() => setMode(m)} /> {label}
              </label>
            ))}
          </fieldset>
          <button className="primary browse" onClick={() => inputOf(mode).current?.click()}>
            {mode === 'folder' ? 'Browse for experiment folder' : mode === 'files' ? 'Browse for TXT files' : 'Browse for ZIP file'}
          </button>
          <p className="hint">Files opened here are used for {MODE_LABEL[project.mode]} only. You can also drag a folder onto the page. Files are read on this computer and never uploaded.</p>
        </>
      )}
      {pending.length > 0 && (
        <div className="banner warn">
          <strong>{pending.length} project file(s) not connected.</strong> Select the original folder or files; they are matched by content, so moved files are found too.
        </div>
      )}
      {!files.length && project.mode === 'tack' && (
        <button className="link" onClick={loadExample}>
          Try it with example data
        </button>
      )}
    </section>
  );
}

/**
 * Probe Tack step 3: tick the files to draw. Files are grouped by condition when the choice spans
 * several; the name is the file name, with its folder path when two files share a name.
 */
function TackFilePicker() {
  const ex = useExperiment();
  const [query, setQuery] = useState('');
  const graphIds = ex.graphFiles.map((e) => e.file.fileId);
  const names = uniqueFileNames(ex.files.map((e) => e.file));
  const setGraph = (ids: string[]) => {
    const ordered = ex.files.map((e) => e.file.fileId).filter((id) => ids.includes(id));
    if (!ordered.length) return; // at least one file stays on the graph
    ex.set({ fileId: ordered[0], overlayFileIds: ordered.slice(1), overlay: ordered.length > 1 });
  };
  const groupKey = (e: ExperimentFile) => conditionLabel(e.runs[0]);
  const groups = new Map<string, ExperimentFile[]>();
  const q = query.trim().toLowerCase();
  for (const e of ex.files) {
    if (q && !e.file.path.toLowerCase().includes(q)) continue;
    groups.set(groupKey(e), [...(groups.get(groupKey(e)) ?? []), e]);
  }
  const nRuns = ex.graphRuns.length;
  return (
    <>
      {ex.files.length > 6 && <input type="search" className="run-search" placeholder="Find a file by name or folder" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a file" />}
      <div className="file-select-bar">
        <span>{graphIds.length} file{graphIds.length === 1 ? '' : 's'} · {nRuns} run{nRuns === 1 ? '' : 's'} on the graph</span>
        <button className="link small" onClick={() => setGraph(ex.files.map((e) => e.file.fileId))}>All</button>
        <button className="link small" onClick={() => ex.main && setGraph([ex.main.file.fileId])}>Only first</button>
      </div>
      <div className="file-list run-picker" aria-label="Files of the chosen experiment: tick the files to draw">
        {groups.size === 0 && <p className="hint pad-s">No file matches “{query}”.</p>}
        {[...groups].map(([g, list]) => (
          <div key={g} className="fl-group">
            {groups.size > 1 || ex.files.length !== list.length ? <div className="fl-group-title">{g}</div> : null}
            {list.map((e) => {
              const on = graphIds.includes(e.file.fileId);
              const name = e.file.name;
              const full = names.get(e.file.fileId) ?? name;
              const context = full !== name ? full.slice(0, -name.length).replace(/\/$/, '') : '';
              return (
                <div key={e.file.fileId} className={`fl-file tack-file ${on ? 'on' : ''}`} title={e.file.path}>
                  <input type="checkbox" checked={on} onChange={(ev) => setGraph(ev.target.checked ? [...graphIds, e.file.fileId] : graphIds.filter((x) => x !== e.file.fileId))} aria-label={`Draw ${name}`} />
                  <button className="link file-only" onClick={() => setGraph([e.file.fileId])} title={`Show only ${e.file.path}`}>
                    {name}{e.holdTimeS !== null ? <small> · {e.holdTimeS} s</small> : null}{context && <small className="fl-context"> · {context}</small>}
                  </button>
                  <QcRibbon cycles={e.runs} />
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="hint">Click a name to show only that file; tick to add files. Show, hide or highlight single runs in “Curves on this graph” above the plot — hiding a curve does not change the averages. To leave a run out of the analysis, untick <em>In average</em> in Data analysis.</p>
      <p className="hint ribbon-legend">
        <span className="ribbon"><i style={{ background: QC_COLORS.green, borderColor: QC_COLORS.green }} /><i style={{ background: 'transparent', borderColor: QC_COLORS.red }} /></span>
        One tick per run, coloured by flag. Hollow = left out of the average.
      </p>
    </>
  );
}

/** "CR 0.25 · 2.5 M · glass · Gel A" (dwell time is shown per file). */
function conditionLabel(r: CycleResult): string {
  const m = r.meta;
  return [
    m.chargeRatio.value !== null ? `CR ${m.chargeRatio.value}` : 'CR unknown',
    `${m.concentrationM.value} M${m.concentrationM.source === 'default' ? ' (assumed)' : ''}`,
    m.substrate.value ?? 'substrate unknown',
    m.gel.value,
  ].filter(Boolean).join(' · ');
}

export function Sidebar() {
  const ex = useExperiment();
  return (
    <nav className="sidebar" aria-label="Open and choose experiments">
      <ImportStep />
      <section className="step">
        <h2>2. Choose your experiment</h2>
        {!ex.hasData ? (
          <p className="hint">Open a folder first. Folder names such as <em>Gel A/0.25 2.5M/glass/</em> are read as gel, charge ratio, concentration and substrate; file names such as <em>10s.txt</em> as the dwell time.</p>
        ) : (
          <>
            <ExperimentPicker pick={ex.pick} options={ex.options} setPick={ex.setPick} />
            <p className="hint">{ex.files.length} file{ex.files.length === 1 ? '' : 's'}, {ex.experimentRuns.length} run{ex.experimentRuns.length === 1 ? '' : 's'} in this choice.</p>
          </>
        )}
      </section>
      {ex.files.length > 0 && (
        <section className="step">
          <h2>3. Runs on the graph</h2>
          <TackFilePicker />
        </section>
      )}
    </nav>
  );
}
