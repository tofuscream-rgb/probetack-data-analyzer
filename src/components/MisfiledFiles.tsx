import { useState } from 'react';
import { MODE_LABEL, useApp } from '../state/AppContext';
import type { Misfiled } from '../state/misfiled';
import { EXPERIMENT_MODES, type ExperimentMode } from '../types';
import { Dialog } from './Dialog';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Groups of misfiled files by the test they are in and the test their data belong to. */
function groups(list: Misfiled[]) {
  const out = new Map<string, { from: ExperimentMode; to: ExperimentMode; files: Misfiled[] }>();
  for (const m of list) {
    const k = `${m.inMode}>${m.detected}`;
    out.set(k, { from: m.inMode, to: m.detected, files: [...(out.get(k)?.files ?? []), m] });
  }
  return [...out.values()];
}

/**
 * Shown on every test when loaded files look like another test's data (e.g. 90° peel files
 * imported while Probe Tack was open): move them to their test, review them, or keep them.
 */
export function MisfiledBanner() {
  const { misfiled, moveFiles, keepInTest, update } = useApp();
  const [review, setReview] = useState(false);
  if (!misfiled.length) return <>{review && <MisfiledDialog onClose={() => setReview(false)} />}</>;
  const g = groups(misfiled);
  return (
    <div className="tare-banner misfiled-banner" role="status">
      <span>
        <strong>{plural(misfiled.length, 'file')} may be in the wrong test:</strong>{' '}
        {g.map((x, i) => (
          <span key={`${x.from}${x.to}`}>
            {i > 0 && '; '}
            {plural(x.files.length, 'file')} in {MODE_LABEL[x.from]} look{x.files.length === 1 ? 's' : ''} like {MODE_LABEL[x.to]} data
          </span>
        ))}
        .
      </span>
      {g.map((x) => (
        <button
          key={`${x.from}${x.to}`}
          className="small primary"
          onClick={() => {
            moveFiles(x.files.map((m) => ({ fileId: m.file.parsed.fileId, from: m.inMode, to: m.detected })));
            if (g.length === 1) update((p) => ({ ...p, mode: x.to }));
          }}
        >
          Move {g.length > 1 ? `${x.files.length} ` : ''}to {MODE_LABEL[x.to]}
        </button>
      ))}
      <button className="small" onClick={() => setReview(true)}>Review</button>
      <button className="small" onClick={() => keepInTest(misfiled.map((m) => ({ sha256: m.file.parsed.sha256, mode: m.inMode })))}>Keep where they are</button>
      {review && <MisfiledDialog onClose={() => setReview(false)} />}
    </div>
  );
}

/** Every misfiled file with why it looks like another test, to move or keep one by one. */
function MisfiledDialog({ onClose }: { onClose: () => void }) {
  const { misfiled, moveFiles, keepInTest } = useApp();
  const [target, setTarget] = useState<Record<string, ExperimentMode>>({});
  const to = (m: Misfiled) => target[m.file.parsed.fileId] ?? m.detected;
  return (
    <Dialog title="Files that may be in the wrong test" onClose={onClose}>
      <p className="note">
        Each file is recognised by its data: a Script block means 90° Peel; otherwise a test named in its folder or file name; otherwise
        holding (Wait) blocks or moves of 1 mm/s or faster mean Probe Tack, and slower pulls mean Lap Shear. Moving a file keeps its data
        unchanged; its runs are then analysed in the other test. Choose <em>Keep</em> if a file is in the right test.
      </p>
      {!misfiled.length ? <p className="note">No files left to review.</p> : (
        <table className="grid misfiled-table">
          <thead><tr><th>File</th><th>Now in</th><th>Looks like</th><th>Move to</th><th /></tr></thead>
          <tbody>
            {misfiled.map((m) => (
              <tr key={m.file.parsed.fileId}>
                <td>{m.file.parsed.path}<div className="note">{m.file.cycles.length} run(s)</div></td>
                <td>{MODE_LABEL[m.inMode]}</td>
                <td>{MODE_LABEL[m.detected]}<div className="note">{m.why}</div></td>
                <td>
                  <select aria-label={`Move ${m.file.parsed.name} to`} value={to(m)} onChange={(e) => setTarget((t) => ({ ...t, [m.file.parsed.fileId]: e.target.value as ExperimentMode }))}>
                    {EXPERIMENT_MODES.filter((x) => x !== m.inMode).map((x) => <option key={x} value={x}>{MODE_LABEL[x]}</option>)}
                  </select>
                </td>
                <td className="nowrap">
                  <button className="small primary" onClick={() => moveFiles([{ fileId: m.file.parsed.fileId, from: m.inMode, to: to(m) }])}>Move</button>{' '}
                  <button className="small" onClick={() => keepInTest([{ sha256: m.file.parsed.sha256, mode: m.inMode }])}>Keep</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="dialog-actions">
        {misfiled.length > 1 && <button className="primary" onClick={() => moveFiles(misfiled.map((m) => ({ fileId: m.file.parsed.fileId, from: m.inMode, to: to(m) })))}>Move all</button>}
        <button onClick={onClose}>Close</button>
      </div>
    </Dialog>
  );
}

/** "Move to" control of a file in the Files tab: any loaded file can be moved to another test by hand. */
export function MoveToTest({ fileId, from, name }: { fileId: string; from: ExperimentMode; name: string }) {
  const { moveFiles } = useApp();
  return (
    <select
      aria-label={`Move ${name} to another test`}
      value=""
      onChange={(e) => { if (e.target.value) moveFiles([{ fileId, from, to: e.target.value as ExperimentMode }]); }}
    >
      <option value="">Move to…</option>
      {EXPERIMENT_MODES.filter((x) => x !== from).map((x) => <option key={x} value={x}>{MODE_LABEL[x]}</option>)}
    </select>
  );
}
