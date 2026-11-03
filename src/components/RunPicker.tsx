import { useState } from 'react';
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

/**
 * Step 2 of Lap Shear and 90° Peel: tick any number of files (all their runs) or
 * single runs to graph and analyse. Files can be filtered by name and expanded to their runs.
 */
export function RunPicker({ files, runs, selectedIds, setSelected, hint }: {
  files: LoadedFile[];
  runs: PickableRun[];
  selectedIds: string[];
  setSelected: (ids: string[]) => void;
  hint: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const shown = q ? files.filter((l) => l.parsed.path.toLowerCase().includes(q)) : files;
  const byFile = (id: string) => runs.filter((r) => r.fileId === id);
  const okIds = (list: PickableRun[]) => list.filter((r) => r.ok).map((r) => r.id);
  const shownIds = shown.flatMap((l) => okIds(byFile(l.parsed.fileId)));
  const toggle = (ids: string[], on: boolean) => setSelected(on ? [...new Set([...selectedIds, ...ids])] : selectedIds.filter((x) => !ids.includes(x)));
  const nFiles = files.filter((l) => byFile(l.parsed.fileId).some((r) => selectedIds.includes(r.id))).length;
  return (
    <>
      <input type="search" className="run-search" placeholder="Filter files by name or folder" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter files" />
      <div className="file-select-bar">
        <span>{nFiles} of {files.length} file(s), {selectedIds.length} run(s) selected</span>
        <button className="link small" onClick={() => toggle(shownIds, true)}>{q ? 'Select shown' : 'All'}</button>
        <button className="link small" onClick={() => (q ? toggle(shownIds, false) : setSelected([]))}>{q ? 'Clear shown' : 'None'}</button>
      </div>
      <div className="file-list run-picker" aria-label="Files and runs: tick what to analyse">
        {shown.length === 0 && <p className="hint pad-s">No file matches “{query}”.</p>}
        {shown.map((l) => {
          const list = byFile(l.parsed.fileId);
          const ids = okIds(list);
          const n = ids.filter((id) => selectedIds.includes(id)).length;
          const isOpen = open[l.parsed.fileId] ?? (list.length > 1 && files.length <= 3);
          return (
            <div key={l.parsed.fileId} className="fl-folder">
              <div className="fl-folder-head picker-head" title={l.parsed.path}>
                <input
                  type="checkbox"
                  checked={ids.length > 0 && n === ids.length}
                  disabled={!ids.length}
                  ref={(el) => { if (el) el.indeterminate = n > 0 && n < ids.length; }}
                  onChange={() => toggle(ids, n < ids.length)}
                  aria-label={`Analyse ${l.parsed.name}`}
                />
                <button className="disclose" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [l.parsed.fileId]: !isOpen }))}>
                  <span className="caret">{isOpen ? '▾' : '▸'}</span> <span className="fl-name">{l.parsed.path}</span>
                </button>
                <small>{n}/{ids.length} run{ids.length === 1 ? '' : 's'}</small>
              </div>
              {list.length === 0 && <p className="run-error">No &lt;Move&gt; or &lt;Scripts&gt; sections with data were found, so this file has no runs. {l.parsed.issues[0]?.message ?? ''}</p>}
              {isOpen && list.map((r) => (
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
