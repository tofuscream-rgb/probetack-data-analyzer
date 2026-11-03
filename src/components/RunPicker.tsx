import type { LoadedFile } from '../parser/loader';
import { fmt } from './common';

export interface PickableRun {
  id: string;
  fileId: string;
  cycleNumber: number;
  ok: boolean;
  error: string | null;
  peakGf: number | null;
}

const ALL = '__all__';

/** Step 2 of Lap Shear and 90° Peel: navigate the test's files and tick the runs to graph and analyse. */
export function RunPicker({
  files,
  runs,
  fileId,
  onFile,
  selectedIds,
  setSelected,
  hint,
}: {
  files: LoadedFile[];
  runs: PickableRun[];
  fileId: string | null;
  onFile: (fileId: string | null) => void;
  selectedIds: string[];
  setSelected: (ids: string[]) => void;
  hint: string;
}) {
  const fileFilter = fileId && files.some((l) => l.parsed.fileId === fileId) ? fileId : ALL;
  const shownFiles = fileFilter === ALL ? files : files.filter((l) => l.parsed.fileId === fileFilter);
  const byFile = (id: string) => runs.filter((r) => r.fileId === id);
  const okIds = (list: PickableRun[]) => list.filter((r) => r.ok).map((r) => r.id);
  const toggle = (ids: string[], on: boolean) => setSelected(on ? [...new Set([...selectedIds, ...ids])] : selectedIds.filter((x) => !ids.includes(x)));
  return (
    <>
      <label className="field">
        <span>TXT file</span>
        <select value={fileFilter} onChange={(e) => onFile(e.target.value === ALL ? null : e.target.value)}>
          <option value={ALL}>All files ({files.length})</option>
          {files.map((l) => (
            <option key={l.parsed.fileId} value={l.parsed.fileId}>
              {l.parsed.path} ({l.cycles.length} run{l.cycles.length === 1 ? '' : 's'})
            </option>
          ))}
        </select>
      </label>
      <div className="file-select-bar">
        <span>{selectedIds.length} of {runs.filter((r) => r.ok).length} run(s) selected</span>
        <button className="link small" onClick={() => setSelected(okIds(runs))}>All</button>
        <button className="link small" onClick={() => setSelected([])}>None</button>
        {fileFilter !== ALL && <button className="link small" onClick={() => setSelected(okIds(byFile(fileFilter)))}>Only this file</button>}
      </div>
      <div className="file-list run-picker" aria-label="Runs: tick the runs to show and analyse">
        {shownFiles.map((l) => {
          const list = byFile(l.parsed.fileId);
          const ids = okIds(list);
          const n = ids.filter((id) => selectedIds.includes(id)).length;
          return (
            <div key={l.parsed.fileId} className="fl-folder">
              <label className="fl-folder-head" title={l.parsed.path}>
                <input
                  type="checkbox"
                  checked={ids.length > 0 && n === ids.length}
                  disabled={!ids.length}
                  ref={(el) => { if (el) el.indeterminate = n > 0 && n < ids.length; }}
                  onChange={() => toggle(ids, n < ids.length)}
                  aria-label={`Select all runs of ${l.parsed.name}`}
                />
                <span className="fl-name">{l.parsed.path}</span>
                <small>{n}/{ids.length}</small>
              </label>
              {list.length === 0 && (
                <p className="run-error">No &lt;Move&gt; or &lt;Scripts&gt; sections with data were found in this file, so it has no runs to analyse. {l.parsed.issues[0]?.message ?? ''}</p>
              )}
              {list.map((r) => (
                <div key={r.id}>
                  <label className={`fl-file ${r.ok ? '' : 'off'}`}>
                    <input type="checkbox" checked={selectedIds.includes(r.id)} disabled={!r.ok} onChange={(e) => toggle([r.id], e.target.checked)} />
                    <span className="fl-name">Run {r.cycleNumber}</span>
                    <small>{r.peakGf !== null ? `${fmt(r.peakGf, 1)} gf` : '—'}</small>
                  </label>
                  {!r.ok && <p className="run-error">{r.error}</p>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <p className="hint">{hint}</p>
    </>
  );
}
