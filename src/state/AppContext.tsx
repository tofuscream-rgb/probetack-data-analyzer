import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ExperimentMeta, GroupKey, ProjectState, SourceFileRecord } from '../types';
import type { LoadedFile, SkippedEntry, SourceFile } from '../parser/loader';
import { collectFromFileList } from '../parser/loader';
import { parseInBackground } from '../parser/workerClient';
import { applyOverride, inferMetadata } from '../parser/pathMetadata';
import { computeDerived, groupValue, type CycleResult, type Derived } from '../analysis/engine';
import { defaultProject, newGraph } from './defaults';
import { loadProjectZip, matchSources, migrateState, remapState, saveProjectZip } from '../storage/project';
import { clearSession, isQuotaError, loadSession, saveSessionFiles, saveSessionState, type StoredSession } from '../storage/idb';
import { buildWorkbook } from '../export/workbook';

export type FilterKey = GroupKey | 'repeat' | 'date' | 'qc';
export type Filters = Partial<Record<FilterKey, string[]>>;

export interface Notice {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

export interface UiState {
  filters: Filters;
  search: string;
  focusId: string | null;
  bottomTab: 'import' | 'cycles' | 'stats' | 'data';
  rightTab: 'cycle' | 'settings' | 'metadata';
  bottomOpen: boolean;
  plotTool: 'zoom' | 'excludePoints' | 'baseline';
  dataView: 'raw' | 'flagged' | 'processed';
}

interface Ctx {
  files: LoadedFile[];
  skipped: SkippedEntry[];
  project: ProjectState;
  update: (fn: (p: ProjectState) => ProjectState) => void;
  meta: Map<string, ExperimentMeta>;
  derived: Derived;
  visible: CycleResult[];
  ui: UiState;
  setUi: (patch: Partial<UiState> | ((u: UiState) => Partial<UiState>)) => void;
  busy: string | null;
  notices: Notice[];
  notify: (kind: Notice['kind'], text: string) => void;
  dismiss: (id: number) => void;
  pending: SourceFileRecord[];
  restorable: StoredSession | null;
  storageNote: string | null;
  importFiles: (list: ArrayLike<File>) => Promise<void>;
  importSources: (sources: SourceFile[], skipped?: SkippedEntry[]) => Promise<void>;
  loadExample: () => Promise<void>;
  removeAllData: () => Promise<void>;
  restoreSession: () => Promise<void>;
  discardSession: () => Promise<void>;
  saveProject: (mode: 'settings' | 'complete') => void;
  loadProject: (file: File) => Promise<void>;
  exportExcel: (cycleIds: string[], graphIds: string[], processed: boolean) => void;
}

const AppContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

export function download(bytes: Uint8Array | Blob, filename: string, type = 'application/octet-stream') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as unknown as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function filterValue(r: CycleResult, k: FilterKey): string {
  if (k === 'repeat') return String(r.meta.repeat.value ?? '—');
  if (k === 'date') return r.cycle.timestamp?.slice(0, 10) ?? '—';
  if (k === 'qc') return r.qc;
  return groupValue(r, k);
}

const toRecord = (l: LoadedFile): SourceFileRecord => ({
  fileId: l.parsed.fileId,
  path: l.parsed.path,
  name: l.parsed.name,
  sha256: l.parsed.sha256,
  sizeBytes: l.parsed.sizeBytes,
});

export function AppProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [skipped, setSkipped] = useState<SkippedEntry[]>([]);
  const [project, setProject] = useState<ProjectState>(defaultProject);
  const [pending, setPending] = useState<SourceFileRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [restorable, setRestorable] = useState<StoredSession | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const [ui, setUiState] = useState<UiState>({
    filters: {},
    search: '',
    focusId: null,
    bottomTab: 'import',
    rightTab: 'cycle',
    bottomOpen: true,
    plotTool: 'zoom',
    dataView: 'raw',
  });
  const noticeId = useRef(1);
  const filesRef = useRef<LoadedFile[]>([]);
  filesRef.current = files;
  const autosaveReady = useRef(false);

  const notify = useCallback((kind: Notice['kind'], text: string) => {
    const id = noticeId.current++;
    setNotices((n) => [...n.slice(-3), { id, kind, text }]);
    if (kind === 'success' || kind === 'info') setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), 6000);
  }, []);
  const dismiss = useCallback((id: number) => setNotices((n) => n.filter((x) => x.id !== id)), []);
  const setUi = useCallback(
    (patch: Partial<UiState> | ((u: UiState) => Partial<UiState>)) =>
      setUiState((u) => ({ ...u, ...(typeof patch === 'function' ? patch(u) : patch) })),
    [],
  );
  const update = useCallback((fn: (p: ProjectState) => ProjectState) => setProject((p) => fn(p)), []);

  const meta = useMemo(
    () => new Map(files.map((l) => [l.parsed.fileId, applyOverride(inferMetadata(l.parsed.path), project.overrides[l.parsed.fileId])])),
    [files, project.overrides],
  );

  const derived = useMemo(
    () =>
      computeDerived(
        files.map((l) => l.parsed),
        new Map(files.map((l) => [l.parsed.fileId, l.cycles])),
        meta,
        project,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, meta, project.settings, project.excludedCycles, project.excludedPoints, project.groupBy],
  );

  const visible = useMemo(() => {
    const q = ui.search.trim().toLowerCase();
    return derived.ordered.filter((r) => {
      for (const [k, vals] of Object.entries(ui.filters) as [FilterKey, string[]][]) {
        if (vals && vals.length && !vals.includes(filterValue(r, k))) return false;
      }
      if (q && !`${r.file.path} c${r.cycle.cycleNumber}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [derived, ui.filters, ui.search]);

  // ---- autosave -------------------------------------------------------------------
  useEffect(() => {
    loadSession()
      .then(({ session }) => {
        if (session && session.sources.length > 0) setRestorable(session);
        else autosaveReady.current = true;
      })
      .catch(() => {
        autosaveReady.current = true;
        setStorageNote('Browser storage is unavailable (private browsing or blocked). Use Save project to keep your work.');
      });
  }, []);

  useEffect(() => {
    if (!autosaveReady.current) return;
    const t = setTimeout(() => {
      saveSessionState({ savedAt: new Date().toISOString(), state: project, sources: files.map(toRecord), hasFiles: true }).catch((e) => {
        setStorageNote(isQuotaError(e) ? 'Browser storage is full; autosave paused. Use Save project.' : 'Autosave failed. Use Save project to keep your work.');
      });
    }, 800);
    return () => clearTimeout(t);
  }, [project, files]);

  const persistFiles = useCallback(async (all: LoadedFile[]) => {
    if (!autosaveReady.current) return;
    try {
      await saveSessionFiles(all.map((l) => ({ path: l.parsed.path, bytes: l.bytes })));
      setStorageNote(null);
    } catch (e) {
      setStorageNote(
        isQuotaError(e)
          ? 'These files are too large for browser storage. Settings are still autosaved, but files will need re-importing next time. Use Save project (complete) to keep everything together.'
          : 'Files could not be stored in the browser. Use Save project to keep your work.',
      );
    }
  }, []);

  // ---- import ----------------------------------------------------------------------
  const importSources = useCallback(
    async (sources: SourceFile[], skippedEntries: SkippedEntry[] = []) => {
      if (sources.length === 0) {
        notify('warning', skippedEntries.length ? 'No .txt files were found in the selection.' : 'Nothing was selected.');
        return;
      }
      setBusy(`Reading ${sources.length} file(s)…`);
      const out: LoadedFile[] = [];
      for (let i = 0; i < sources.length; i++) {
        setBusy(`Reading ${i + 1} of ${sources.length}: ${sources[i].path}`);
        out.push(await parseInBackground(sources[i]));
      }
      const map = new Map(filesRef.current.map((l) => [l.parsed.fileId, l]));
      let dup = 0;
      for (const l of out) {
        if (map.has(l.parsed.fileId)) dup++;
        map.set(l.parsed.fileId, l);
      }
      if (dup) notify('info', `${dup} file(s) were already imported and were refreshed.`);
      const merged = [...map.values()].sort((a, b) => a.parsed.path.localeCompare(b.parsed.path, undefined, { numeric: true }));
      filesRef.current = merged;
      setFiles(merged);
      setSkipped((s) => [...s, ...skippedEntries]);

      // Reconnect a settings-only project if one is waiting for its files.
      if (pending.length) {
        const m = matchSources(pending, out.map(toRecord));
        if (m.idMap.size) setProject((p) => remapState(p, m.idMap));
        const stillMissing = pending.filter((s) => !m.idMap.has(s.fileId));
        setPending(stillMissing);
        notify(
          stillMissing.length ? 'warning' : 'success',
          `Reconnected ${m.idMap.size} of ${pending.length} project file(s).` +
            (m.changed.length ? ` ${m.changed.length} file(s) have the same name but different content and were not reconnected.` : '') +
            (stillMissing.length ? ` Still missing: ${stillMissing.slice(0, 4).map((s) => s.path).join(', ')}${stillMissing.length > 4 ? '…' : ''}` : ''),
        );
      }

      const nCycles = out.reduce((s, l) => s + l.cycles.length, 0);
      const bad = out.filter((l) => l.parsed.status === 'error').length;
      const warn = out.filter((l) => l.parsed.status === 'warning').length;
      notify(
        bad || warn ? 'warning' : 'success',
        `Imported ${out.length} file(s) with ${nCycles} run(s).` +
          (bad ? ` ${bad} file(s) had no usable data.` : '') +
          (warn ? ` ${warn} file(s) have warnings.` : '') +
          ' See Import status.',
      );
      setUi((u) => ({ bottomTab: 'import', bottomOpen: true, focusId: u.focusId ?? out.find((l) => l.cycles.length)?.cycles[0]?.cycleId ?? null }));
      setBusy(null);
      setTimeout(() => persistFiles(merged), 0);
    },
    [notify, pending, persistFiles, setUi],
  );

  const importFiles = useCallback(
    async (list: ArrayLike<File>) => {
      setBusy('Collecting files…');
      try {
        const { files: src, skipped: sk } = await collectFromFileList(list);
        await importSources(src, sk);
      } catch (e) {
        notify('error', `Import failed: ${(e as Error).message}`);
      } finally {
        setBusy(null);
      }
    },
    [importSources, notify],
  );

  const loadExample = useCallback(async () => {
    setBusy('Loading synthetic example…');
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}synthetic-example.zip`);
      const blob = await res.blob();
      await importFiles([new File([blob], 'synthetic-example.zip')]);
    } catch (e) {
      notify('error', `Could not load the example: ${(e as Error).message}`);
      setBusy(null);
    }
  }, [importFiles, notify]);

  const removeAllData = useCallback(async () => {
    filesRef.current = [];
    setFiles([]);
    setSkipped([]);
    setPending([]);
    setProject(defaultProject());
    setUi({ focusId: null, filters: {}, search: '' });
    await clearSession().catch(() => undefined);
    autosaveReady.current = true;
    notify('success', 'All data were removed from this page and from browser storage.');
  }, [notify, setUi]);

  const restoreSession = useCallback(async () => {
    setBusy('Restoring previous session…');
    try {
      const { session, files: stored } = await loadSession();
      if (!session) return;
      setRestorable(null);
      autosaveReady.current = true;
      setProject(migrateState(session.state));
      if (stored.length) {
        const out: LoadedFile[] = [];
        for (const f of stored) out.push(await parseInBackground({ path: f.path, bytes: f.bytes }));
        setFiles(out);
        notify('success', `Restored ${out.length} file(s) and your analysis from ${new Date(session.savedAt).toLocaleString()}.`);
      } else {
        setPending(session.sources);
        notify('warning', 'Settings were restored, but the files were not kept in browser storage. Select the original files or folder to reconnect.');
      }
    } catch (e) {
      notify('error', `Could not restore: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [notify]);

  const discardSession = useCallback(async () => {
    setRestorable(null);
    await clearSession().catch(() => undefined);
    autosaveReady.current = true;
  }, []);

  const saveProject = useCallback(
    (mode: 'settings' | 'complete') => {
      const sources = [...files.map(toRecord), ...pending];
      const bytes = new Map(files.map((l) => [l.parsed.fileId, l.bytes]));
      const zip = saveProjectZip(project, sources, mode, bytes);
      const safe = project.name.replace(/[^\w.-]+/g, '_') || 'Hydrogel_Analysis_Project';
      download(zip, `${safe}${mode === 'complete' ? '' : '_settings'}.zip`, 'application/zip');
      notify('success', mode === 'complete' ? 'Project saved, including the original data files.' : 'Project settings saved (no measurement data).');
    },
    [files, pending, project, notify],
  );

  const loadProject = useCallback(
    async (file: File) => {
      setBusy('Opening project…');
      try {
        const lp = loadProjectZip(new Uint8Array(await file.arrayBuffer()));
        lp.warnings.forEach((w) => notify('warning', w));
        setFiles([]);
        setSkipped([]);
        setProject(lp.json.state);
        if (lp.files.length) {
          const out: LoadedFile[] = [];
          for (const f of lp.files) out.push(await parseInBackground(f));
          const m = matchSources(lp.json.sources, out.map(toRecord));
          if (m.idMap.size) setProject(remapState(lp.json.state, m.idMap));
          setFiles(out.sort((a, b) => a.parsed.path.localeCompare(b.parsed.path, undefined, { numeric: true })));
          setPending([]);
          setTimeout(() => persistFiles(out), 0);
          notify('success', `Project "${lp.json.state.name}" opened with ${out.length} data file(s).`);
        } else {
          setPending(lp.json.sources);
          notify('info', `Project "${lp.json.state.name}" opened. Now select the original folder or files (${lp.json.sources.length}) to reconnect the data.`);
        }
        setUi({ focusId: lp.json.state.selection[0] ?? null });
      } catch (e) {
        notify('error', (e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [notify, persistFiles, setUi],
  );

  const exportExcel = useCallback(
    (cycleIds: string[], graphIds: string[], processed: boolean) => {
      setBusy('Building Excel workbook…');
      setTimeout(() => {
        try {
          const graphs = project.graphs.filter((g) => graphIds.includes(g.id));
          const bytes = buildWorkbook(derived, project, { cycleIds, graphs, useProcessedForCharts: processed });
          const safe = project.name.replace(/[^\w.-]+/g, '_') || 'Mach1_Analysis';
          download(bytes, `${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          notify('success', `Excel workbook created with ${cycleIds.length} run(s) and ${graphs.length} chart(s).`);
        } catch (e) {
          notify('error', `Excel export failed: ${(e as Error).message}`);
        } finally {
          setBusy(null);
        }
      }, 30);
    },
    [derived, project, notify],
  );

  const value: Ctx = {
    files, skipped, project, update, meta, derived, visible, ui, setUi, busy, notices, notify, dismiss, pending,
    restorable, storageNote, importFiles, importSources, loadExample, removeAllData, restoreSession, discardSession,
    saveProject, loadProject, exportExcel,
  };
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useGraphActions() {
  const { update, project } = useApp();
  const active = project.graphs.find((g) => g.id === project.activeGraphId) ?? project.graphs[0];
  return {
    active,
    addToActive: (ids: string[]) =>
      update((p) => ({
        ...p,
        graphs: p.graphs.map((g) => (g.id === active.id ? { ...g, cycleIds: [...new Set([...g.cycleIds, ...ids])] } : g)),
      })),
    removeFromActive: (ids: string[]) =>
      update((p) => ({
        ...p,
        graphs: p.graphs.map((g) => (g.id === active.id ? { ...g, cycleIds: g.cycleIds.filter((x) => !ids.includes(x)) } : g)),
      })),
    newGraphWith: (ids: string[]) =>
      update((p) => {
        const g = newGraph(p.graphs.length + 1, ids);
        return { ...p, graphs: [...p.graphs, g], activeGraphId: g.id };
      }),
  };
}
