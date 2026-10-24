/**
 * Portable project files (.zip).
 *
 *   project.json      settings, selections, graphs, corrections, exclusions,
 *                     source-file identifiers (path + SHA-256), versions
 *   data/<path>.txt   ONLY in "complete" projects: the original TXT files, byte for byte
 *   README.txt        what the file contains
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { GroupKey, ProjectState, RunOverride, SourceFileRecord } from '../types';
import { ALGORITHM_VERSION, APP_VERSION, PROJECT_SCHEMA_VERSION } from '../types';
import { defaultProject, defaultSettings } from '../state/defaults';

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
  files: { path: string; bytes: Uint8Array }[];
  warnings: string[];
}

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
      const bytes = fileBytes.get(src.fileId);
      if (bytes) entries[`data/${src.path}`] = bytes;
    }
  }
  return zipSync(entries, { level: 6 });
}

// The gel option was removed from the interface; older projects may still group or compare by it.
const withoutGel = (keys: GroupKey[]) => keys.filter((k) => k !== 'gel');

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
    },
    overrides: raw.overrides ?? {},
    runOverrides,
    excludedPoints: raw.excludedPoints ?? {},
    graphs: Array.isArray(raw.graphs) && raw.graphs.length ? raw.graphs : d.graphs,
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
  const files: { path: string; bytes: Uint8Array }[] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (name.startsWith('data/') && !name.endsWith('/')) files.push({ path: name.slice(5), bytes: data });
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
    excludedPoints: remapKeys(state.excludedPoints, mapCycle),
    selection: state.selection.map(mapCycle),
    graphs: state.graphs.map((g) => ({ ...g, cycleIds: g.cycleIds.map(mapCycle), hidden: g.hidden.map(mapCycle) })),
  };
}
