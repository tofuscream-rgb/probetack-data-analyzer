import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ExperimentMeta, ExperimentMode, GraphConfig, ProjectState, SourceFileRecord } from '../types';
import { EXPERIMENT_MODES } from '../types';
import type { LoadedFile, SkippedEntry, SourceFile } from '../parser/loader';
import { collectFromFileList, guessMode } from '../parser/loader';
import { parseInBackground } from '../parser/workerClient';
import { applyOverride, inferMetadata } from '../parser/pathMetadata';
import { computeDerived, type Derived } from '../analysis/engine';
import { defaultProject, newGraph } from './defaults';
import { loadProjectZip, matchSources, migrateState, remapState, saveProjectZip, sourceKey } from '../storage/project';
import { clearSession, isQuotaError, loadSession, saveSessionFiles, saveSessionState, type StoredSession } from '../storage/idb';
import { buildWorkbook, type SheetKey } from '../export/workbook';


export const MODE_LABEL: Record<ExperimentMode, string> = { tack: 'Probe Tack', lapShear: 'Lap Shear', peel: '90° Peel' };

export interface Notice {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

export interface UiState {
  /** Run shown in the detail pane of the Data analysis tab. */
  focusId: string | null;
}

interface Ctx {
  /** Files of the test that is shown (each test has its own files). */
  files: LoadedFile[];
  filesByMode: Record<ExperimentMode, LoadedFile[]>;
  /** Remove files from the shown test. */
  removeFiles: (fileIds: string[]) => void;
  skipped: SkippedEntry[];
  project: ProjectState;
  update: (fn: (p: ProjectState) => ProjectState) => void;
  meta: Map<string, ExperimentMeta>;
  derived: Derived;
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
  exportExcel: (cycleIds: string[], graphs: GraphConfig[], processed: boolean, sheets: SheetKey[]) => void;
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

const toRecord = (l: LoadedFile, mode?: ExperimentMode): SourceFileRecord => ({
  fileId: l.parsed.fileId,
  path: l.parsed.path,
  name: l.parsed.name,
  sha256: l.parsed.sha256,
  sizeBytes: l.parsed.sizeBytes,
  ...(mode ? { mode } : {}),
});

type ByMode<T> = Record<ExperimentMode, T>;
const emptyByMode = <T,>(make: () => T): ByMode<T> => ({ tack: make(), lapShear: make(), peel: make() });
const byPath = (a: LoadedFile, b: LoadedFile) => a.parsed.path.localeCompare(b.parsed.path, undefined, { numeric: true });
/** Pending (not yet reconnected) project files of one test; records from older projects have no test and match any. */
const pendingOf = (pending: SourceFileRecord[], mode: ExperimentMode) => pending.filter((r) => (r.mode ?? mode) === mode);

/** The list of deselected files of one test (probe tack keeps the original top-level list). */
export function disabledOf(p: ProjectState, mode: ExperimentMode): string[] {
  return mode === 'tack' ? p.disabledFiles : mode === 'lapShear' ? p.lapShear.disabledFiles : p.peel.disabledFiles;
}
export function withDisabled(p: ProjectState, mode: ExperimentMode, ids: string[]): ProjectState {
  if (mode === 'tack') return { ...p, disabledFiles: ids };
  if (mode === 'lapShear') return { ...p, lapShear: { ...p.lapShear, disabledFiles: ids } };
  return { ...p, peel: { ...p.peel, disabledFiles: ids } };
}

export function AppProvider({ children }: { children: ReactNode }) {
  // Every test has its own imported files: files opened for probe tack are not shown for lap shear or 90° peel.
  const [filesByMode, setFilesByMode] = useState<ByMode<LoadedFile[]>>(() => emptyByMode(() => []));
  const [skippedByMode, setSkippedByMode] = useState<ByMode<SkippedEntry[]>>(() => emptyByMode(() => []));
  const [project, setProject] = useState<ProjectState>(defaultProject);
  const [pendingAll, setPending] = useState<SourceFileRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [restorable, setRestorable] = useState<StoredSession | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const [ui, setUiState] = useState<UiState>({
    focusId: null,
  });
  const noticeId = useRef(1);
  const filesRef = useRef<ByMode<LoadedFile[]>>(filesByMode);
  filesRef.current = filesByMode;
  const modeRef = useRef<ExperimentMode>(project.mode);
  modeRef.current = project.mode;
  const autosaveReady = useRef(false);
  const files = filesByMode[project.mode];
  const skipped = skippedByMode[project.mode];
  const pending = useMemo(() => pendingOf(pendingAll, project.mode), [pendingAll, project.mode]);

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

  const allFiles = useMemo(() => [...filesByMode.tack, ...filesByMode.lapShear, ...filesByMode.peel], [filesByMode]);
  const meta = useMemo(
    () => new Map(allFiles.map((l) => [l.parsed.fileId, applyOverride(inferMetadata(l.parsed.path), project.overrides[l.parsed.fileId])])),
    [allFiles, project.overrides],
  );

  // Probe-tack analysis: only probe-tack files; deselected files stay listed but take no part.
  const used = useMemo(() => {
    const off = new Set(project.disabledFiles);
    return filesByMode.tack.filter((l) => !off.has(l.parsed.fileId));
  }, [filesByMode.tack, project.disabledFiles]);
  const derived = useMemo(
    () =>
      computeDerived(
        used.map((l) => l.parsed),
        new Map(used.map((l) => [l.parsed.fileId, l.cycles])),
        meta,
        project,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [used, meta, project.settings, project.runOverrides, project.excludedPoints, project.groupBy],
  );

  const records = useCallback(
    (by: ByMode<LoadedFile[]>) => EXPERIMENT_MODES.flatMap((m) => by[m].map((l) => toRecord(l, m))),
    [],
  );

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
      saveSessionState({ savedAt: new Date().toISOString(), state: project, sources: records(filesByMode), hasFiles: true }).catch((e) => {
        setStorageNote(isQuotaError(e) ? 'Browser storage is full; autosave paused. Use Save project.' : 'Autosave failed. Use Save project to keep your work.');
      });
    }, 800);
    return () => clearTimeout(t);
  }, [project, filesByMode, records]);

  const persistFiles = useCallback(async (by: ByMode<LoadedFile[]>) => {
    if (!autosaveReady.current) return;
    try {
      await saveSessionFiles(EXPERIMENT_MODES.flatMap((m) => by[m].map((l) => ({ path: l.parsed.path, bytes: l.bytes, mode: m }))));
      setStorageNote(null);
    } catch (e) {
      setStorageNote(
        isQuotaError(e)
          ? 'These files are too large for browser storage. Settings are still autosaved, but files will need re-importing next time. Use Save project (complete) to keep everything together.'
          : 'Files could not be stored in the browser. Use Save project to keep your work.',
      );
    }
  }, []);

  /** Put parsed files into the lists of their tests and remember them. */
  const storeFiles = useCallback(
    (next: ByMode<LoadedFile[]>) => {
      filesRef.current = next;
      setFilesByMode(next);
      setTimeout(() => persistFiles(next), 0);
    },
    [persistFiles],
  );

  // ---- import ----------------------------------------------------------------------
  const importSources = useCallback(
    async (sources: SourceFile[], skippedEntries: SkippedEntry[] = []) => {
      const mode = modeRef.current;
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
      const map = new Map(filesRef.current[mode].map((l) => [l.parsed.fileId, l]));
      let dup = 0;
      for (const l of out) {
        if (map.has(l.parsed.fileId)) dup++;
        map.set(l.parsed.fileId, l);
      }
      if (dup) notify('info', `${dup} file(s) were already imported and were refreshed.`);
      storeFiles({ ...filesRef.current, [mode]: [...map.values()].sort(byPath) });
      setSkippedByMode((s) => ({ ...s, [mode]: [...s[mode], ...skippedEntries] }));

      // Reconnect a settings-only project if one is waiting for its files.
      const waiting = pendingOf(pendingAll, mode);
      if (waiting.length) {
        const m = matchSources(waiting, out.map((l) => toRecord(l)));
        if (m.idMap.size) setProject((p) => remapState(p, m.idMap));
        const stillMissing = waiting.filter((s) => !m.idMap.has(s.fileId));
        setPending((all) => all.filter((r) => !waiting.includes(r) || stillMissing.includes(r)));
        notify(
          stillMissing.length ? 'warning' : 'success',
          `Reconnected ${m.idMap.size} of ${waiting.length} project file(s).` +
            (m.changed.length ? ` ${m.changed.length} file(s) have the same name but different content and were not reconnected.` : '') +
            (stillMissing.length ? ` Still missing: ${stillMissing.slice(0, 4).map((s) => s.path).join(', ')}${stillMissing.length > 4 ? '…' : ''}` : ''),
        );
      }

      const nCycles = out.reduce((s, l) => s + l.cycles.length, 0);
      const bad = out.filter((l) => l.parsed.status === 'error').length;
      const warn = out.filter((l) => l.parsed.status === 'warning').length;
      notify(
        bad || warn ? 'warning' : 'success',
        `Imported ${out.length} file(s) with ${nCycles} run(s) for ${MODE_LABEL[mode]}.` +
          (bad ? ` ${bad} file(s) had no usable data.` : '') +
          (warn ? ` ${warn} file(s) have warnings.` : '') +
          ' See the Files tab.',
      );
      if (bad || warn) {
        setProject((p) =>
          mode === 'tack' ? { ...p, mainTab: 'files' } : mode === 'lapShear' ? { ...p, lapShear: { ...p.lapShear, tab: 'files' } } : { ...p, peel: { ...p.peel, tab: 'files' } },
        );
      }
      setBusy(null);
    },
    [notify, pendingAll, storeFiles],
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

  /** Remove files from the current test (the original files on disk are not touched). */
  const removeFiles = useCallback(
    (fileIds: string[]) => {
      const mode = modeRef.current;
      const ids = new Set(fileIds);
      storeFiles({ ...filesRef.current, [mode]: filesRef.current[mode].filter((l) => !ids.has(l.parsed.fileId)) });
      setProject((p) => withDisabled(p, mode, disabledOf(p, mode).filter((id) => !ids.has(id))));
      if (!filesRef.current[mode].length) setSkippedByMode((s) => ({ ...s, [mode]: [] }));
    },
    [storeFiles],
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
    const empty = emptyByMode<LoadedFile[]>(() => []);
    filesRef.current = empty;
    setFilesByMode(empty);
    setSkippedByMode(emptyByMode(() => []));
    setPending([]);
    setProject(defaultProject());
    setUi({ focusId: null });
    await clearSession().catch(() => undefined);
    autosaveReady.current = true;
    notify('success', 'All data were removed from this page and from browser storage.');
  }, [notify, setUi]);

  /** Parse stored files into their tests; files saved before files were kept per test are sorted by their content. */
  const parseIntoModes = useCallback(async (stored: { path: string; bytes: Uint8Array; mode?: ExperimentMode }[]) => {
    const by = emptyByMode<LoadedFile[]>(() => []);
    let guessed = 0;
    for (const f of stored) {
      const l = await parseInBackground({ path: f.path, bytes: f.bytes });
      const m = f.mode ?? guessMode(l);
      if (!f.mode) guessed++;
      if (!by[m].some((x) => x.parsed.fileId === l.parsed.fileId)) by[m].push(l);
    }
    for (const m of EXPERIMENT_MODES) by[m].sort(byPath);
    return { by, guessed };
  }, []);

  const restoreSession = useCallback(async () => {
    setBusy('Restoring previous session…');
    try {
      const { session, files: stored } = await loadSession();
      if (!session) return;
      setRestorable(null);
      autosaveReady.current = true;
      setProject(migrateState(session.state));
      if (stored.length) {
        const { by, guessed } = await parseIntoModes(stored);
        storeFiles(by);
        notify(
          'success',
          `Restored ${stored.length} file(s) and your analysis from ${new Date(session.savedAt).toLocaleString()}.` +
            (guessed ? ' Files from before each test kept its own files were sorted into Probe Tack, Lap Shear or 90° Peel by their content.' : ''),
        );
      } else {
        setPending(session.sources);
        notify('warning', 'Settings were restored, but the files were not kept in browser storage. Select the original files or folder to reconnect.');
      }
    } catch (e) {
      notify('error', `Could not restore: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }, [notify, parseIntoModes, storeFiles]);

  const discardSession = useCallback(async () => {
    setRestorable(null);
    await clearSession().catch(() => undefined);
    autosaveReady.current = true;
  }, []);

  const saveProject = useCallback(
    (mode: 'settings' | 'complete') => {
      const sources = [...records(filesByMode), ...pendingAll];
      const bytes = new Map(EXPERIMENT_MODES.flatMap((m) => filesByMode[m].map((l) => [sourceKey({ fileId: l.parsed.fileId, mode: m }), l.bytes] as const)));
      const zip = saveProjectZip(project, sources, mode, bytes);
      const safe = project.name.replace(/[^\w.-]+/g, '_') || 'Hydrogel_Analysis_Project';
      download(zip, `${safe}${mode === 'complete' ? '' : '_settings'}.zip`, 'application/zip');
      notify('success', mode === 'complete' ? 'Project saved, including the original data files.' : 'Project settings saved (no measurement data).');
    },
    [filesByMode, pendingAll, project, notify, records],
  );

  const loadProject = useCallback(
    async (file: File) => {
      setBusy('Opening project…');
      try {
        const lp = loadProjectZip(new Uint8Array(await file.arrayBuffer()));
        lp.warnings.forEach((w) => notify('warning', w));
        storeFiles(emptyByMode(() => []));
        setSkippedByMode(emptyByMode(() => []));
        setProject(lp.json.state);
        if (lp.files.length) {
          // Files stored per test keep their test; tack-layout files take the test of their source record, else are sorted by content.
          const recMode = new Map(lp.json.sources.map((r) => [r.path, r.mode]));
          const { by } = await parseIntoModes(lp.files.map((f) => ({ ...f, mode: f.mode ?? recMode.get(f.path) })));
          const all = EXPERIMENT_MODES.flatMap((m) => by[m]);
          const m = matchSources(lp.json.sources, all.map((l) => toRecord(l)));
          if (m.idMap.size) setProject(remapState(lp.json.state, m.idMap));
          storeFiles(by);
          setPending([]);
          notify('success', `Project "${lp.json.state.name}" opened with ${lp.files.length} data file(s).`);
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
    [notify, parseIntoModes, setUi, storeFiles],
  );

  const exportExcel = useCallback(
    (cycleIds: string[], graphs: GraphConfig[], processed: boolean, sheets: SheetKey[]) => {
      setBusy('Building Excel workbook…');
      setTimeout(() => {
        try {
          const off = new Set(project.disabledFiles);
          const deselectedFiles = filesByMode.tack.filter((l) => off.has(l.parsed.fileId)).map((l) => ({ path: l.parsed.path, sha256: l.parsed.sha256 }));
          const bytes = buildWorkbook(derived, project, { cycleIds, graphs, useProcessedForCharts: processed, sheets, deselectedFiles });
          const safe = project.name.replace(/[^\w.-]+/g, '_') || 'Mach1_Analysis';
          download(bytes, `${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
          notify('success', `Excel workbook created with ${sheets.length} part(s) and ${cycleIds.length} run(s).`);
        } catch (e) {
          notify('error', `Excel export failed: ${(e as Error).message}`);
        } finally {
          setBusy(null);
        }
      }, 30);
    },
    [derived, project, notify, filesByMode],
  );

  const value: Ctx = {
    files, filesByMode, removeFiles, skipped, project, update, meta, derived, ui, setUi, busy, notices, notify, dismiss, pending,
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
