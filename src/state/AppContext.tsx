import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ExperimentMeta, ExperimentMode, GraphConfig, ProjectState, SourceFileRecord } from '../types';
import { EXPERIMENT_MODES } from '../types';
import { dedupeByMode, duplicateReason, loadedDuplicateNotice, planImport } from './duplicates';
import { findMisfiled, moveBetweenTests, type Misfiled } from './misfiled';
import type { LoadedFile, SkippedEntry, SourceFile } from '../parser/loader';
import { collectFromFileList, detectMode, guessMode, unpackSavedProjects } from '../parser/loader';
import { parseInBackground } from '../parser/workerClient';
import { applyOverride, groupSubstrates, inferMetadata } from '../parser/pathMetadata';
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
  /** Loaded files whose data look like another test's than the one they are in (any test). */
  misfiled: Misfiled[];
  /** Move loaded files to another test, with a confirmation message. */
  moveFiles: (moves: FileMove[]) => void;
  /** Keep files in their test although their data look like another test's. */
  keepInTest: (files: { sha256: string; mode: ExperimentMode }[]) => void;
  skipped: SkippedEntry[];
  /** Summary of the last upload that refused files or skipped runs (shown in a dialog); null = none. */
  importReport: ImportReport | null;
  closeImportReport: () => void;
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

/** What an upload added: files imported whole, partly imported (some runs already loaded), or refused. */
export interface ImportReport {
  test: string;
  imported: ImportReportItem[];
  partial: ImportReportItem[];
  refused: ImportReportItem[];
}
/** One file of an import summary; `test` is set when the upload went to more than one test. */
export interface ImportReportItem {
  path: string;
  message: string;
  test?: string;
  /** Refused because the same file is loaded in another test, where it does not seem to belong: offer to move that copy. */
  moveLoaded?: FileMove & { path: string };
}
export interface FileMove { fileId: string; from: ExperimentMode; to: ExperimentMode }

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
  runFingerprints: l.cycles.map((c) => c.fingerprint ?? ''),
});

/**
 * Leave out runs recorded as already loaded from another file (project.duplicateRuns), and say so in
 * the file's messages. Used after an upload and when a project or session is reopened.
 */
function withoutDuplicateRuns(l: LoadedFile, skip: number[] | undefined, note?: string): LoadedFile {
  if (!skip?.length) return l;
  const cycles = l.cycles.filter((c) => !skip.includes(c.cycleNumber));
  const msg = note ?? `Run${skip.length === 1 ? '' : 's'} ${skip.join(', ')} not imported: the same data is already loaded from another file.`;
  return { ...l, cycles, parsed: { ...l.parsed, issues: [...l.parsed.issues, { severity: 'info', message: msg }] } };
}
const applyDuplicateRuns = (by: ByMode<LoadedFile[]>, dup: Record<string, number[]> | undefined): ByMode<LoadedFile[]> =>
  dup && Object.keys(dup).length ? (Object.fromEntries(EXPERIMENT_MODES.map((m) => [m, by[m].map((l) => withoutDuplicateRuns(l, dup[l.parsed.fileId]))])) as ByMode<LoadedFile[]>) : by;

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
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
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
    // Errors stay until dismissed; the import summary in the sidebar keeps the counts after a notice goes.
    if (kind !== 'error') setTimeout(() => setNotices((n) => n.filter((x) => x.id !== id)), kind === 'warning' ? 12000 : 6000);
  }, []);
  const dismiss = useCallback((id: number) => setNotices((n) => n.filter((x) => x.id !== id)), []);
  const setUi = useCallback(
    (patch: Partial<UiState> | ((u: UiState) => Partial<UiState>)) =>
      setUiState((u) => ({ ...u, ...(typeof patch === 'function' ? patch(u) : patch) })),
    [],
  );
  const update = useCallback((fn: (p: ProjectState) => ProjectState) => setProject((p) => fn(p)), []);

  // Metadata of every file; substrate variants of one test are grouped (each file keeps its own name).
  const meta = useMemo(
    () => groupSubstrates(EXPERIMENT_MODES.flatMap((mode) => filesByMode[mode].map((l) => ({
      id: l.parsed.fileId, mode, meta: applyOverride(inferMetadata(l.parsed.path), project.overrides[l.parsed.fileId]),
    })))),
    [filesByMode, project.overrides],
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
    [used, meta, project.settings, project.runOverrides, project.excludedPoints, project.groupBy, project.tackMetrics.excludedRepeats, project.tackMetrics.excludedSessions],
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
      const current = modeRef.current;
      if (sources.length === 0) {
        notify('warning', skippedEntries.length ? 'No .txt files were found in the selection.' : 'Nothing was selected.');
        return;
      }
      setBusy(`Reading ${sources.length} file(s)…`);
      const parsed: LoadedFile[] = [];
      for (let i = 0; i < sources.length; i++) {
        setBusy(`Reading ${i + 1} of ${sources.length}: ${sources[i].path}`);
        parsed.push(await parseInBackground(sources[i]));
      }
      // One upload can hold files of every test: each file goes to the test it belongs to. A file a
      // settings-only project is waiting for goes back to the test it was saved in.
      const waitingFor = new Map(pendingAll.map((r) => [r.sha256, r.mode ?? current]));
      const modeOf = new Map(parsed.map((l, i) => [l, waitingFor.get(l.parsed.sha256) ?? sources[i].mode ?? detectMode(l, current).mode]));
      const testOf = (l: LoadedFile) => modeOf.get(l)!;
      // Nothing loaded is ever replaced: an identical file, or a file whose runs are all loaded already
      // (in any test, from any file), is refused; of a file with some loaded runs only the new runs are added.
      const knownFiles = EXPERIMENT_MODES.flatMap((m) => filesRef.current[m].map((l) => ({ sha256: l.parsed.sha256, path: l.parsed.path, mode: m })));
      const knownRuns = new Map(EXPERIMENT_MODES.flatMap((m) => filesRef.current[m].flatMap((l) => l.cycles.filter((c) => c.fingerprint).map((c) => [c.fingerprint!, { path: l.parsed.path, cycleNumber: c.cycleNumber, mode: m }] as const))));
      const plan = planImport(knownFiles, knownRuns, parsed, testOf, MODE_LABEL);
      const refused = plan.filter((p) => p.outcome === 'refused');
      const partial = plan.filter((p) => p.outcome === 'partial');
      const accepted = plan.filter((p) => p.outcome !== 'refused');
      const out = accepted.map((p) => withoutDuplicateRuns(p.file, p.skipped.map((x) => x.cycleNumber), p.outcome === 'partial' ? p.message.replace(/^Imported /, 'Only the new runs were imported: ') : undefined));
      const outMode = new Map(out.map((l, i) => [l, testOf(accepted[i].file)]));
      const modesHit = EXPERIMENT_MODES.filter((m) => parsed.some((l) => testOf(l) === m));
      const several = modesHit.length > 1 || (modesHit.length === 1 && modesHit[0] !== current);
      setSkippedByMode((s) => {
        const next = { ...s, [current]: [...s[current], ...skippedEntries] };
        for (const p of refused) next[testOf(p.file)] = [...next[testOf(p.file)], { path: p.file.parsed.path, reason: `Not added: ${p.message}`, duplicate: true }];
        return next;
      });
      if (partial.length) {
        setProject((p) => ({ ...p, duplicateRuns: { ...(p.duplicateRuns ?? {}), ...Object.fromEntries(partial.map((x) => [x.file.parsed.fileId, x.skipped.map((k) => k.cycleNumber)])) } }));
      }
      const duplicates = [...refused, ...partial];
      if (duplicates.length) {
        const item = (p: (typeof plan)[number]): ImportReportItem => {
          const to = testOf(p.file);
          const loaded = p.outcome === 'refused' ? EXPERIMENT_MODES.flatMap((m) => filesRef.current[m].filter((l) => l.parsed.sha256 === p.file.parsed.sha256).map((l) => ({ l, m })))[0] : undefined;
          return {
            path: p.file.parsed.path,
            message: p.message,
            test: several ? MODE_LABEL[to] : undefined,
            moveLoaded: loaded && loaded.m !== to && detectMode(p.file, to).by !== 'current' ? { fileId: loaded.l.parsed.fileId, from: loaded.m, to, path: loaded.l.parsed.path } : undefined,
          };
        };
        setImportReport({
          test: modesHit.length === 1 ? MODE_LABEL[modesHit[0]] : 'all tests',
          imported: plan.filter((p) => p.outcome === 'imported').map(item),
          partial: partial.map(item),
          refused: refused.map(item),
        });
      }
      if (!out.length) {
        setBusy(null);
        return;
      }
      const nextFiles = { ...filesRef.current };
      for (const m of EXPERIMENT_MODES) {
        const add = out.filter((l) => outMode.get(l) === m);
        if (add.length) nextFiles[m] = [...nextFiles[m], ...add].sort(byPath);
      }
      storeFiles(nextFiles);

      // Reconnect a settings-only project if it is waiting for its files.
      let reconnected = 0;
      let waitingTotal = 0;
      let changed = 0;
      const stillMissing: SourceFileRecord[] = [];
      const idMap = new Map<string, string>();
      for (const m of EXPERIMENT_MODES) {
        const waiting = pendingAll.filter((r) => (r.mode ?? current) === m);
        if (!waiting.length) continue;
        const r = matchSources(waiting, out.filter((l) => outMode.get(l) === m).map((l) => toRecord(l, m)));
        r.idMap.forEach((v, k) => idMap.set(k, v));
        reconnected += r.idMap.size;
        waitingTotal += waiting.length;
        changed += r.changed.length;
        stillMissing.push(...waiting.filter((x) => !r.idMap.has(x.fileId)));
      }
      if (waitingTotal) {
        if (idMap.size) setProject((p) => remapState(p, idMap));
        setPending((all) => all.filter((r) => !idMap.has(r.fileId)));
        notify(
          stillMissing.length ? 'warning' : 'success',
          `Reconnected ${reconnected} of ${waitingTotal} project file(s).` +
            (changed ? ` ${changed} file(s) have the same name but different content and were not reconnected.` : '') +
            (stillMissing.length ? ` Still missing: ${stillMissing.slice(0, 4).map((x) => x.path).join(', ')}${stillMissing.length > 4 ? '…' : ''}` : ''),
        );
      }

      const nCycles = out.reduce((s, l) => s + l.cycles.length, 0);
      const bad = out.filter((l) => l.parsed.status === 'error').length;
      const warn = out.filter((l) => l.parsed.status === 'warning').length;
      const perTest = EXPERIMENT_MODES.map((m) => [m, out.filter((l) => outMode.get(l) === m).length] as const).filter(([, n]) => n > 0);
      const sorted = several ? ` Sorted by test: ${perTest.map(([m, n]) => `${n} to ${MODE_LABEL[m]}`).join(', ')}.` : '';
      const elsewhere = several && !perTest.some(([m]) => m === current) ? ` None are ${MODE_LABEL[current]} files; open ${perTest.map(([m]) => MODE_LABEL[m]).join(' or ')} to see them.` : '';
      if (!duplicates.length || several) notify(
        bad || warn ? 'warning' : 'success',
        `Imported ${out.length} file(s) with ${nCycles} run(s)${several ? '.' : ` for ${MODE_LABEL[current]}.`}` + sorted + elsewhere +
          (bad ? ` ${bad} file(s) had no usable data.` : '') +
          (warn ? ` ${warn} file(s) have warnings.` : '') +
          (bad || warn ? ' Details are in the Files tab.' : ''),
      );
      setBusy(null);
    },
    [notify, pendingAll, storeFiles],
  );

  const importFiles = useCallback(
    async (list: ArrayLike<File>) => {
      setBusy('Collecting files…');
      try {
        const collected = await collectFromFileList(list);
        const { files: src, skipped: sk, projects } = unpackSavedProjects(collected.files, collected.skipped);
        if (projects) notify('success', 'This is a saved project: its data files were imported into their tests. Use Load project to restore its settings and choices as well.');
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

  const moveFiles = useCallback(
    (moves: FileMove[]) => {
      const real = moves.filter((m) => m.from !== m.to && filesRef.current[m.from].some((l) => l.parsed.fileId === m.fileId));
      if (!real.length) return;
      const paths = new Map(real.map((m) => [m.fileId, filesRef.current[m.from].find((l) => l.parsed.fileId === m.fileId)!.parsed.path]));
      storeFiles(moveBetweenTests(filesRef.current, real, byPath));
      setProject((p) => {
        let next = p;
        for (const from of EXPERIMENT_MODES) {
          const gone = new Set(real.filter((m) => m.from === from).map((m) => m.fileId));
          if (gone.size) next = withDisabled(next, from, disabledOf(next, from).filter((id) => !gone.has(id)));
        }
        return next;
      });
      // A copy refused earlier because this file was in the wrong test is no longer a duplicate to report.
      setSkippedByMode((s) => {
        const next = { ...s };
        for (const m of real) next[m.to] = next[m.to].filter((x) => !(x.duplicate && x.reason.includes(paths.get(m.fileId)!)));
        return next;
      });
      const per = EXPERIMENT_MODES.map((to) => [to, real.filter((m) => m.to === to).length] as const).filter(([, n]) => n > 0);
      notify('success', `Moved ${per.map(([to, n]) => `${n} file(s) to ${MODE_LABEL[to]}`).join(', ')}. Their runs are analysed there now.`);
    },
    [notify, storeFiles],
  );

  const keepInTest = useCallback((list: { sha256: string; mode: ExperimentMode }[]) => {
    setProject((p) => ({ ...p, keptInTest: { ...(p.keptInTest ?? {}), ...Object.fromEntries(list.map((x) => [x.sha256, x.mode])) } }));
  }, []);

  const misfiled = useMemo(() => findMisfiled(filesByMode, EXPERIMENT_MODES, project.keptInTest), [filesByMode, project.keptInTest]);

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

  /** Keep one copy of identical files loaded together (project or session); list the others as duplicates. */
  const dedupeLoaded = useCallback((by: ByMode<LoadedFile[]>, what: string): ByMode<LoadedFile[]> => {
    const r = dedupeByMode(by, EXPERIMENT_MODES);
    if (r.dropped.length) {
      setSkippedByMode((s) => {
        const next = { ...s };
        for (const d of r.dropped) next[d.mode] = [...next[d.mode], { path: d.file.parsed.path, reason: duplicateReason(d, d.mode, MODE_LABEL), duplicate: true }];
        return next;
      });
      notify('warning', loadedDuplicateNotice(r.dropped, MODE_LABEL, what));
    }
    return r.by;
  }, [notify]);

  const restoreSession = useCallback(async () => {
    setBusy('Restoring previous session…');
    try {
      const { session, files: stored } = await loadSession();
      if (!session) return;
      setRestorable(null);
      autosaveReady.current = true;
      const restoredState = migrateState(session.state);
      setProject(restoredState);
      if (stored.length) {
        const { by: parsedBy, guessed } = await parseIntoModes(stored);
        setSkippedByMode(emptyByMode(() => []));
        const by = dedupeLoaded(applyDuplicateRuns(parsedBy, restoredState.duplicateRuns), 'session');
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
  }, [notify, parseIntoModes, storeFiles, dedupeLoaded]);

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
          const { by: parsedBy } = await parseIntoModes(lp.files.map((f) => ({ ...f, mode: f.mode ?? recMode.get(f.path) })));
          const by = dedupeLoaded(applyDuplicateRuns(parsedBy, lp.json.state.duplicateRuns), 'project');
          const all = EXPERIMENT_MODES.flatMap((m) => by[m]);
          const m = matchSources(lp.json.sources, all.map((l) => toRecord(l)));
          if (m.idMap.size) setProject(remapState(lp.json.state, m.idMap));
          storeFiles(by);
          setPending([]);
          const nLoaded = EXPERIMENT_MODES.reduce((n, mm) => n + by[mm].length, 0);
          notify('success', `Project "${lp.json.state.name}" opened with ${nLoaded} data file(s).`);
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
    [notify, parseIntoModes, setUi, storeFiles, dedupeLoaded],
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
    files, filesByMode, removeFiles, misfiled, moveFiles, keepInTest, skipped, importReport, closeImportReport: () => setImportReport(null), project, update, meta, derived, ui, setUi, busy, notices, notify, dismiss, pending,
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
