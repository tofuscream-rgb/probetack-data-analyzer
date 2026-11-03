/**
 * Portable project files (.zip).
 *
 *   project.json      settings, selections, graphs, corrections, exclusions,
 *                     source-file identifiers (path + SHA-256), versions
 *   data/<path>.txt   ONLY in "complete" projects: the original TXT files, byte for byte
 *   README.txt        what the file contains
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { RUN_TABS } from '../types';
import type { RunGraphView, ExperimentMode, GroupKey, LapShearRunMeta, LapShearSettings, LapShearState, MainTab, PeelRunMeta, PeelSettings, PeelState, ProjectState, RunOverride, SourceFileRecord } from '../types';
import { ALGORITHM_VERSION, APP_VERSION, PROJECT_SCHEMA_VERSION } from '../types';
import { defaultCompare, defaultExperiment, defaultLapShear, defaultPeel, defaultProject, defaultSettings } from '../state/defaults';

export interface ProjectFileJson {
  format: 'mach1-analyzer-project';
  schemaVersion: number;
  appVersion: string;
  algorithmVersion: string;
  savedAt: string;
  mode: 'settings' | 'complete';
  state: ProjectState;
  sources: SourceFileRecord[];
}

export interface LoadedProject {
  json: ProjectFileJson;
  /** `mode` is set for files stored per test; files without it are probe-tack files (or from older projects). */
  files: { path: string; bytes: Uint8Array; mode?: ExperimentMode }[];
  warnings: string[];
}

/** Files are kept per test: the same TXT file may be imported for two tests. */
export const sourceKey = (r: { fileId: string; mode?: ExperimentMode }) => `${r.mode ?? 'tack'}|${r.fileId}`;
/** Archive path of a data file: probe-tack files keep the original layout (data/<path>), others go to data/@<test>/<path>. */
const dataPath = (r: SourceFileRecord) => (r.mode && r.mode !== 'tack' ? `data/@${r.mode}/${r.path}` : `data/${r.path}`);

export function saveProjectZip(
  state: ProjectState,
  sources: SourceFileRecord[],
  mode: 'settings' | 'complete',
  fileBytes: Map<string, Uint8Array>,
): Uint8Array {
  const json: ProjectFileJson = {
    format: 'mach1-analyzer-project',
    schemaVersion: PROJECT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    savedAt: new Date().toISOString(),
    mode,
    state,
    sources,
  };
  const entries: Record<string, Uint8Array> = {
    'project.json': strToU8(JSON.stringify(json, null, 2)),
    'README.txt': strToU8(
      mode === 'complete'
        ? 'Mach-1 Analyzer project (complete).\nThis archive CONTAINS THE ORIGINAL EXPERIMENTAL TXT FILES in data/.\nTreat it as confidential research data. Do not upload it to public places.\nOpen it with "Load project" in the Mach-1 Analyzer website.\n'
        : 'Mach-1 Analyzer project (settings only).\nThis archive contains analysis settings, metadata corrections, exclusions, graphs and file identifiers (names and SHA-256 hashes), but NOT the measurements.\nOpen it with "Load project", then select the original TXT files or folder again.\n',
    ),
  };
  if (mode === 'complete') {
    for (const src of sources) {
      const bytes = fileBytes.get(sourceKey(src));
      if (bytes) entries[dataPath(src)] = bytes;
    }
  }
  return zipSync(entries, { level: 6 });
}

// The gel option was removed from the interface; older projects may still group or compare by it.
const withoutGel = (keys: GroupKey[]) => keys.filter((k) => k !== 'gel');
const MAIN_TABS: MainTab[] = ['graph', 'analysis', 'compare', 'settings', 'files'];

/** Graph options; projects from 1.5 stored `shade` as true/false (now Off by default to keep the graph readable). */
function migrateView(d: RunGraphView, v: Partial<RunGraphView> | undefined): RunGraphView {
  const out = { ...d, ...(v ?? {}) };
  if (out.shade !== 'none' && out.shade !== 'highlight' && out.shade !== 'all') out.shade = d.shade;
  if (!['gf', 'N', 'kPa', 'MPa', 'N/m'].includes(out.unit)) out.unit = d.unit;
  out.x = 'disp';
  if (out.labels !== 'legend' && out.labels !== 'curve' && out.labels !== 'none') out.labels = d.labels;
  if (typeof out.title !== 'string') out.title = '';
  if (!out.names || typeof out.names !== 'object') out.names = {};
  return out;
}

/** Lap-shear state with every field present; unknown or damaged values fall back to defaults. */
export function migrateLapShear(raw: Partial<LapShearState> | undefined): LapShearState {
  const d = defaultLapShear();
  const r = raw ?? {};
  const s: Partial<LapShearSettings> = r.settings ?? {};
  const pos = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fb);
  const runs: Record<string, LapShearRunMeta> = {};
  for (const [id, m] of Object.entries(r.runs ?? {})) {
    if (!m || typeof m !== 'object') continue;
    runs[id] = {
      lengthMm: pos(m.lengthMm, d.settings.defaults.lengthMm),
      widthMm: pos(m.widthMm, d.settings.defaults.widthMm),
      thicknessMm: pos(m.thicknessMm, d.settings.defaults.thicknessMm),
      failureMode: ['adhesive', 'cohesive', 'mixed'].includes(m.failureMode) ? m.failureMode : 'unspecified',
      manualFailureMm: typeof m.manualFailureMm === 'number' && Number.isFinite(m.manualFailureMm) ? m.manualFailureMm : null,
    };
  }
  return {
    settings: {
      integration: { ...d.settings.integration, ...(s.integration ?? {}) },
      baseline: { ...d.settings.baseline, ...(s.baseline ?? {}) },
      failure: { ...d.settings.failure, ...(s.failure ?? {}) },
      direction: s.direction === 'negative' || s.direction === 'positive' ? s.direction : 'auto',
      gapFactor: pos(s.gapFactor, d.settings.gapFactor),
      defaults: { ...d.settings.defaults, ...(s.defaults ?? {}) },
    },
    runs,
    selected: Array.isArray(r.selected) ? r.selected : null,
    fileId: typeof r.fileId === 'string' ? r.fileId : null,
    view: migrateView(d.view, r.view),
    tab: r.tab && RUN_TABS.includes(r.tab) ? r.tab : 'graph',
    compare: { ...d.compare, ...(r.compare ?? {}) },
    disabledFiles: Array.isArray(r.disabledFiles) ? r.disabledFiles : [],
  };
}

/** 90° peel state with every field present; damaged values fall back to defaults. */
export function migratePeel(raw: Partial<PeelState> | undefined): PeelState {
  const d = defaultPeel();
  const r = raw ?? {};
  const s: Partial<PeelSettings> = r.settings ?? {};
  const pos = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fb);
  const runs: Record<string, PeelRunMeta> = {};
  for (const [id, m] of Object.entries(r.runs ?? {})) {
    if (!m || typeof m !== 'object') continue;
    runs[id] = {
      lengthMm: pos(m.lengthMm, d.settings.defaults.lengthMm),
      widthMm: pos(m.widthMm, d.settings.defaults.widthMm),
      thicknessMm: pos(m.thicknessMm, d.settings.defaults.thicknessMm),
      angleDeg: pos(m.angleDeg, d.settings.defaults.angleDeg),
      failureMode: ['adhesive', 'cohesive', 'mixed'].includes(m.failureMode) ? m.failureMode : 'unspecified',
      manualDetachMm: typeof m.manualDetachMm === 'number' && Number.isFinite(m.manualDetachMm) ? m.manualDetachMm : null,
    };
  }
  return {
    settings: {
      plateau: { ...d.settings.plateau, ...(s.plateau ?? {}) },
      integration: { ...d.settings.integration, ...(s.integration ?? {}) },
      baseline: { ...d.settings.baseline, ...(s.baseline ?? {}) },
      detach: { ...d.settings.detach, ...(s.detach ?? {}) },
      direction: s.direction === 'negative' || s.direction === 'positive' ? s.direction : 'auto',
      gapFactor: pos(s.gapFactor, d.settings.gapFactor),
      defaults: { ...d.settings.defaults, ...(s.defaults ?? {}) },
    },
    runs,
    selected: Array.isArray(r.selected) ? r.selected : null,
    fileId: typeof r.fileId === 'string' ? r.fileId : null,
    view: migrateView(d.view, r.view),
    tab: r.tab && RUN_TABS.includes(r.tab) ? r.tab : 'graph',
    compare: { ...d.compare, ...(r.compare ?? {}) },
    disabledFiles: Array.isArray(r.disabledFiles) ? r.disabledFiles : [],
  };
}

/** Merge a possibly older/partial state with current defaults so new fields always exist. */
export function migrateState(raw: Partial<ProjectState>): ProjectState {
  const d = defaultProject();
  const ds = defaultSettings();
  const s = raw.settings ?? ds;
  const compareBy = Array.isArray(s.cycle?.compareBy) ? withoutGel(s.cycle.compareBy) : ds.cycle.compareBy;
  const groupBy = Array.isArray(raw.groupBy) ? withoutGel(raw.groupBy) : [];
  const excludeClasses = s.runExclusion?.excludeClasses;
  // Schema 1 stored manual run exclusions in excludedCycles; they become 'exclude' overrides.
  const runOverrides: Record<string, RunOverride> = {};
  for (const [id, e] of Object.entries(raw.excludedCycles ?? {})) runOverrides[id] = { action: 'exclude', reason: e.reason, at: e.at };
  Object.assign(runOverrides, raw.runOverrides ?? {});
  const state: ProjectState = {
    ...d,
    ...raw,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    settings: {
      ...ds,
      ...s,
      point: { ...ds.point, ...(s.point ?? {}) },
      cycle: { ...ds.cycle, ...(s.cycle ?? {}), compareBy },
      runExclusion: { excludeClasses: Array.isArray(excludeClasses) ? excludeClasses : ds.runExclusion.excludeClasses },
      // Before schema 3 the signed z − z₀ was the default; it is replaced by the new default (distance from each run's start).
      displacementMode: (raw.schemaVersion ?? 0) < 3 && (s.displacementMode ?? 'signed') === 'signed' ? ds.displacementMode : s.displacementMode ?? ds.displacementMode,
    },
    overrides: raw.overrides ?? {},
    runOverrides,
    disabledFiles: Array.isArray(raw.disabledFiles) ? raw.disabledFiles : [],
    excludedPoints: raw.excludedPoints ?? {},
    graphs: Array.isArray(raw.graphs) && raw.graphs.length ? raw.graphs.map((g) => ({ ...g, showExcluded: g.showExcluded ?? true })) : d.graphs,
    // 'summary' was the per-condition summary tab of 1.3; it became part of Data analysis.
    mode: raw.mode === 'lapShear' || raw.mode === 'peel' ? raw.mode : 'tack',
    lapShear: migrateLapShear(raw.lapShear),
    peel: migratePeel(raw.peel),
    mainTab: (raw.mainTab as string) === 'summary' ? 'analysis' : raw.mainTab && MAIN_TABS.includes(raw.mainTab) ? raw.mainTab : 'graph',
    experiment: { ...defaultExperiment(), ...(raw.experiment ?? {}) },
    compare: { ...defaultCompare(), ...(raw.compare ?? {}) },
    selection: Array.isArray(raw.selection) ? raw.selection : [],
    groupBy: groupBy.length ? groupBy : d.groupBy,
  };
  delete state.excludedCycles;
  if (!state.graphs.some((g) => g.id === state.activeGraphId)) state.activeGraphId = state.graphs[0].id;
  return state;
}

export function loadProjectZip(bytes: Uint8Array): LoadedProject {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('This file is not a valid project archive (.zip).');
  }
  const pj = entries['project.json'];
  if (!pj) throw new Error('project.json is missing; this does not look like a Mach-1 Analyzer project.');
  let json: ProjectFileJson;
  try {
    json = JSON.parse(strFromU8(pj));
  } catch {
    throw new Error('project.json could not be read (invalid JSON).');
  }
  if (json.format !== 'mach1-analyzer-project') throw new Error('project.json is not a Mach-1 Analyzer project.');
  if (typeof json.schemaVersion !== 'number') throw new Error('Project schema version is missing.');
  const warnings: string[] = [];
  if (json.schemaVersion > PROJECT_SCHEMA_VERSION) {
    throw new Error(`This project was saved by a newer version (schema ${json.schemaVersion}). Update the website and try again.`);
  }
  if (json.algorithmVersion !== ALGORITHM_VERSION) {
    warnings.push(`Saved with algorithm version ${json.algorithmVersion}; this site uses ${ALGORITHM_VERSION}. Numerical results may differ.`);
  }
  json.state = migrateState(json.state ?? {});
  json.sources = Array.isArray(json.sources) ? json.sources : [];
  const files: { path: string; bytes: Uint8Array; mode?: ExperimentMode }[] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (!name.startsWith('data/') || name.endsWith('/')) continue;
    const m = name.match(/^data\/@(lapShear|peel)\/(.+)$/);
    if (m) files.push({ path: m[2], bytes: data, mode: m[1] as ExperimentMode });
    else files.push({ path: name.slice(5), bytes: data });
  }
  return { json, files, warnings };
}

/**
 * When files are re-selected, map saved file ids to newly imported ones.
 * Match by SHA-256 first (content identical even if moved), then by path.
 */
export function matchSources(
  saved: SourceFileRecord[],
  imported: SourceFileRecord[],
): { idMap: Map<string, string>; missing: SourceFileRecord[]; changed: SourceFileRecord[] } {
  const idMap = new Map<string, string>();
  const missing: SourceFileRecord[] = [];
  const changed: SourceFileRecord[] = [];
  const byHash = new Map<string, SourceFileRecord[]>();
  for (const f of imported) byHash.set(f.sha256, [...(byHash.get(f.sha256) ?? []), f]);
  const used = new Set<string>();
  for (const s of saved) {
    const candidates = (byHash.get(s.sha256) ?? []).filter((f) => !used.has(f.fileId));
    const exact = candidates.find((f) => f.path === s.path) ?? candidates.find((f) => f.name === s.name) ?? candidates[0];
    if (exact) {
      idMap.set(s.fileId, exact.fileId);
      used.add(exact.fileId);
      continue;
    }
    const samePath = imported.find((f) => f.path === s.path && !used.has(f.fileId));
    if (samePath) changed.push(s); // same name/path but different content: not reconnected
    else missing.push(s);
  }
  return { idMap, missing, changed };
}

/** Rewrite ids inside a project after files were re-imported under new ids. */
export function remapState(state: ProjectState, idMap: Map<string, string>): ProjectState {
  const mapCycle = (cid: string) => {
    const [fid, rest] = cid.split('#');
    const nf = idMap.get(fid);
    return nf ? `${nf}#${rest}` : cid;
  };
  const remapKeys = <T>(rec: Record<string, T>, f: (k: string) => string) =>
    Object.fromEntries(Object.entries(rec).map(([k, v]) => [f(k), v]));
  return {
    ...state,
    overrides: remapKeys(state.overrides, (k) => idMap.get(k) ?? k),
    runOverrides: remapKeys(state.runOverrides, mapCycle),
    disabledFiles: state.disabledFiles.map((id) => idMap.get(id) ?? id),
    lapShear: {
      ...state.lapShear,
      runs: remapKeys(state.lapShear.runs, mapCycle),
      view: { ...state.lapShear.view, names: remapKeys(state.lapShear.view.names, mapCycle) },
      selected: state.lapShear.selected ? state.lapShear.selected.map(mapCycle) : null,
      fileId: state.lapShear.fileId ? idMap.get(state.lapShear.fileId) ?? state.lapShear.fileId : null,
      disabledFiles: state.lapShear.disabledFiles.map((id) => idMap.get(id) ?? id),
    },
    peel: {
      ...state.peel,
      runs: remapKeys(state.peel.runs, mapCycle),
      view: { ...state.peel.view, names: remapKeys(state.peel.view.names, mapCycle) },
      selected: state.peel.selected ? state.peel.selected.map(mapCycle) : null,
      fileId: state.peel.fileId ? idMap.get(state.peel.fileId) ?? state.peel.fileId : null,
      disabledFiles: state.peel.disabledFiles.map((id) => idMap.get(id) ?? id),
    },
    excludedPoints: remapKeys(state.excludedPoints, mapCycle),
    selection: state.selection.map(mapCycle),
    experiment: {
      ...state.experiment,
      fileId: state.experiment.fileId ? idMap.get(state.experiment.fileId) ?? state.experiment.fileId : null,
      overlayFileIds: state.experiment.overlayFileIds.map((id) => idMap.get(id) ?? id),
    },
    graphs: state.graphs.map((g) => ({ ...g, cycleIds: g.cycleIds.map(mapCycle), hidden: g.hidden.map(mapCycle) })),
  };
}
