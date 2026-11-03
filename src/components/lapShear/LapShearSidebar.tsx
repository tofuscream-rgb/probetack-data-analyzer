import { useApp } from '../../state/AppContext';
import { useLapShear, type LapShearRun } from '../../state/lapShear';
import { ImportStep } from '../Sidebar';
import { fmt } from '../common';

const ALL = '__all__';

/** Lap Shear step 2: navigate the imported files and tick the runs to graph and analyse. */
export function LapShearSidebar() {
  const { files, project } = useApp();
  const { ls, runs, selectedIds, set, setSelected } = useLapShear();
  const off = new Set(project.disabledFiles);
  const used = files.filter((l) => !off.has(l.parsed.fileId));
  const fileFilter = ls.fileId && used.some((l) => l.parsed.fileId === ls.fileId) ? ls.fileId : ALL;
  const shownFiles = fileFilter === ALL ? used : used.filter((l) => l.parsed.fileId === fileFilter);
  const byFile = (fileId: string) => runs.filter((r) => r.file.fileId === fileId);
  const toggle = (ids: string[], on: boolean) => setSelected(on ? [...new Set([...selectedIds, ...ids])] : selectedIds.filter((x) => !ids.includes(x)));
  const okIds = (list: LapShearRun[]) => list.filter((r) => r.result.ok).map((r) => r.id);

  return (
    <nav className="sidebar" aria-label="Open lap-shear files and choose runs">
      <ImportStep />
      <section className="step">
        <h2>2. Choose runs</h2>
        {!runs.length ? (
          <p className="hint">
            Open your lap-shear TXT files first. Every <em>&lt;Move Relative&gt;</em> section of a file is one run; a file with three pulls gives Run 1, Run 2 and Run 3.
          </p>
        ) : (
          <>
            <label className="field">
              <span>TXT file</span>
              <select value={fileFilter} onChange={(e) => set({ fileId: e.target.value === ALL ? null : e.target.value })}>
                <option value={ALL}>All files ({used.length})</option>
                {used.map((l) => (
                  <option key={l.parsed.fileId} value={l.parsed.fileId}>
                    {l.parsed.path} ({l.cycles.length} run{l.cycles.length === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            </label>
            <div className="file-select-bar">
              <span>{selectedIds.length} of {runs.filter((r) => r.result.ok).length} run(s) selected</span>
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
                      <p className="run-error">No &lt;Move&gt; sections with data were found in this file, so it has no runs to analyse. {l.parsed.issues[0]?.message ?? ''}</p>
                    )}
                    {list.map((r) => (
                      <div key={r.id}>
                        <label className={`fl-file ${r.result.ok ? '' : 'off'}`}>
                          <input type="checkbox" checked={selectedIds.includes(r.id)} disabled={!r.result.ok} onChange={(e) => toggle([r.id], e.target.checked)} />
                          <span className="fl-name">Run {r.cycle.cycleNumber}</span>
                          <small>{r.result.peak ? `${fmt(r.result.peak.forceGf, 1)} gf` : '—'}</small>
                        </label>
                        {!r.result.ok && <p className="run-error">{r.result.error}</p>}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <p className="hint">
              Ticked runs are drawn on the graph and listed in the results. Each run keeps its own overlap dimensions and failure mode (Results tab).
            </p>
          </>
        )}
      </section>
    </nav>
  );
}
