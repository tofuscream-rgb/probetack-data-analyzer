import { useApp } from '../state/AppContext';

/** Import status of every file: OK, with warnings, or without usable data. Nothing is skipped silently. */
export function ImportStatus() {
  const { files, skipped, pending, project } = useApp();
  const off = new Set(project.disabledFiles);
  const ok = files.filter((f) => f.parsed.status === 'ok').length;
  const warn = files.filter((f) => f.parsed.status === 'warning').length;
  const err = files.filter((f) => f.parsed.status === 'error').length;
  if (!files.length && !skipped.length && !pending.length) return <p className="note">No files imported yet.</p>;
  return (
    <div className="import-status">
      <p className="summary-line">
        <span className="pill ok">{ok} imported</span> <span className="pill warning">{warn} with warnings</span>{' '}
        <span className="pill error">{err} unreadable or empty</span> <span className="pill">{files.reduce((s, f) => s + f.cycles.length, 0)} runs</span>
        {skipped.length > 0 && <span className="pill">{skipped.length} non-TXT files skipped</span>}
      </p>
      <table className="grid">
        <thead>
          <tr><th>Status</th><th>File</th><th>Runs</th><th>Blocks</th><th>Recorded</th><th>Messages</th></tr>
        </thead>
        <tbody>
          {files.map((l) => (
            <tr key={l.parsed.fileId} className={l.parsed.status}>
              <td><span className={`status ${l.parsed.status}`}>{l.parsed.status === 'ok' ? 'OK' : l.parsed.status === 'warning' ? 'Warning' : 'No data'}</span></td>
              <td title={l.parsed.sha256}>{l.parsed.path}{off.has(l.parsed.fileId) && <span className="tag"> not used (unticked)</span>}</td>
              <td className="num">{l.cycles.length}</td>
              <td className="num">{l.parsed.blocks.length}</td>
              <td>{l.parsed.header['Date'] ?? '—'}</td>
              <td className="msgs">{l.parsed.issues.length ? l.parsed.issues.map((i, k) => <div key={k} className={i.severity}>{i.message}</div>) : '—'}</td>
            </tr>
          ))}
          {pending.map((p) => (
            <tr key={p.fileId} className="warning">
              <td><span className="status warning">Missing</span></td>
              <td>{p.path}</td>
              <td colSpan={4}>Listed in the project but not selected yet.</td>
            </tr>
          ))}
          {skipped.map((s, i) => (
            <tr key={`s${i}`} className="muted">
              <td>Skipped</td>
              <td>{s.path}</td>
              <td colSpan={4}>{s.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
