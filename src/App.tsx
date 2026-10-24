import { useEffect, useState, type DragEvent } from 'react';
import { loadPlotly } from './plotting/PlotlyChart';
import { warmUpWorker } from './parser/workerClient';
import { AppProvider, useApp } from './state/AppContext';
import { Header } from './components/Header';
import { Navigator } from './components/Navigator';
import { GraphPanel } from './components/GraphPanel';
import { AnalysisPanel } from './components/AnalysisPanel';
import { BottomPanel } from './components/BottomPanel';

/** Read dropped folders recursively (Chrome, Edge, Firefox, Safari). */
async function filesFromDrop(e: DragEvent): Promise<File[]> {
  const items = Array.from(e.dataTransfer.items ?? []);
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => !!x);
  if (!entries.length) return Array.from(e.dataTransfer.files);
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      // Preserve the folder path the same way a folder picker does.
      Object.defineProperty(file, 'webkitRelativePath', { value: prefix + file.name });
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[];
      do {
        batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      } while (batch.length);
    }
  };
  for (const en of entries) await walk(en, '');
  return out;
}

function Shell() {
  const { busy, notices, dismiss, restorable, restoreSession, discardSession, importFiles, ui } = useApp();
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    // Load all code up front: afterwards the page needs no network at all.
    warmUpWorker();
    loadPlotly().catch(() => undefined);
  }, []);
  return (
    <div
      className={`app ${ui.bottomOpen ? '' : 'bottom-closed'}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={async (e) => {
        e.preventDefault();
        setDragging(false);
        const files = await filesFromDrop(e);
        if (files.length) importFiles(files);
      }}
    >
      <Header />
      {restorable && (
        <div className="restore-banner" role="status">
          <span>
            A previous session from {new Date(restorable.savedAt).toLocaleString()} is stored in this browser ({restorable.sources.length} file(s)).
          </span>
          <button className="primary" onClick={restoreSession}>Restore it</button>
          <button onClick={discardSession}>Start fresh</button>
        </div>
      )}
      <main className="workspace">
        <Navigator />
        <div className="center">
          <GraphPanel />
          <BottomPanel />
        </div>
        <AnalysisPanel />
      </main>
      <div className="notices" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className={`notice ${n.kind}`}>
            <span>{n.text}</span>
            <button className="icon" onClick={() => dismiss(n.id)} aria-label="Dismiss">×</button>
          </div>
        ))}
      </div>
      {busy && (
        <div className="busy" role="status">
          <div className="spinner" /> {busy}
        </div>
      )}
      {dragging && <div className="drop-overlay">Drop folders, TXT files or a ZIP archive to import them. They stay on this computer.</div>}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
