import { useState } from 'react';
import { MODE_LABEL, useApp, type ImportReportItem } from '../state/AppContext';
import { Dialog } from './Dialog';

/** One summary after an upload that refused files or skipped runs: imported, partly imported and refused files. */
export function ImportReportDialog() {
  const { importReport: r, closeImportReport, moveFiles } = useApp();
  const [moved, setMoved] = useState<Set<string>>(new Set());
  if (!r) return null;
  const section = (title: string, cls: string, items: ImportReportItem[], note: string) =>
    items.length > 0 && (
      <section className={`import-report-section ${cls}`}>
        <h3>{title} ({items.length})</h3>
        <p className="note">{note}</p>
        <ul>{items.map((x) => <li key={x.path}>
          <strong>{x.path}</strong>{x.test && <small> ({x.test})</small>} — {x.message}
          {x.moveLoaded && (moved.has(x.moveLoaded.fileId)
            ? <div className="note">Moved to {MODE_LABEL[x.moveLoaded.to]}.</div>
            : <div className="note warn">
                The loaded copy is in {MODE_LABEL[x.moveLoaded.from]} but its data look like {MODE_LABEL[x.moveLoaded.to]} data.{' '}
                <button className="small" onClick={() => { moveFiles([x.moveLoaded!]); setMoved((s) => new Set(s).add(x.moveLoaded!.fileId)); }}>Move it to {MODE_LABEL[x.moveLoaded.to]}</button>
              </div>)}
        </li>)}</ul>
      </section>
    );
  return (
    <Dialog title={`Import summary (${r.test})`} onClose={closeImportReport}>
      <p className="note">Nothing already loaded was changed or removed. Runs are compared by their data and recording date and time, not by file name.</p>
      {section('Imported', 'imported', r.imported, 'All runs of these files were new.')}
      {section('Partly imported', 'partial', r.partial, 'Only the runs that were not loaded yet were added.')}
      {section('Refused', 'refused', r.refused, 'Nothing was added from these files: the file or every run in it is already loaded.')}
      <div className="dialog-actions">
        <button className="primary" onClick={closeImportReport}>OK</button>
      </div>
    </Dialog>
  );
}
