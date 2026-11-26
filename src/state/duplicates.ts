/**
 * Duplicate detection on import: a file is a duplicate when its content is byte-for-byte identical
 * (same SHA-256) to a file already imported in any test, or to an earlier file of the same upload.
 * The name and folder do not matter; duplicates are not added, so no run is counted twice.
 */
import type { ExperimentMode } from '../types';

export interface KnownFile {
  sha256: string;
  path: string;
  mode: ExperimentMode;
}

export interface Duplicate<T> {
  file: T;
  /** The file already present with the same content (or the first copy in this upload). */
  of: { path: string; mode: ExperimentMode; sameUpload: boolean };
}

export function splitDuplicates<T extends { parsed: { sha256: string; path: string } }>(
  known: KnownFile[],
  incoming: T[],
  mode: ExperimentMode,
): { fresh: T[]; duplicates: Duplicate<T>[] } {
  const seen = new Map(known.map((k) => [k.sha256, { path: k.path, mode: k.mode, sameUpload: false }]));
  const fresh: T[] = [];
  const duplicates: Duplicate<T>[] = [];
  for (const f of incoming) {
    const hit = seen.get(f.parsed.sha256);
    if (hit) duplicates.push({ file: f, of: hit });
    else {
      fresh.push(f);
      seen.set(f.parsed.sha256, { path: f.parsed.path, mode, sameUpload: true });
    }
  }
  return { fresh, duplicates };
}


/** "glass-v2.txt = glass.txt (already in 90° Peel)" for the message and the Files tab. */
export function duplicateReason(d: Duplicate<{ parsed: { path: string } }>, mode: ExperimentMode, label: Record<ExperimentMode, string>): string {
  const where = d.of.sameUpload ? 'earlier in this upload' : d.of.mode === mode ? 'already imported' : `already imported in ${label[d.of.mode]}`;
  return `Duplicate: identical data to ${d.of.path} (${where}); not added.`;
}

/**
 * Remove identical copies from files loaded together (a project or a restored session saved before
 * duplicates were blocked). The first copy is kept: tests in the order Probe Tack, Lap Shear, 90° Peel,
 * files in path order within a test.
 */
export function dedupeByMode<T extends { parsed: { sha256: string; path: string } }>(
  by: Record<ExperimentMode, T[]>,
  modes: ExperimentMode[],
): { by: Record<ExperimentMode, T[]>; dropped: (Duplicate<T> & { mode: ExperimentMode })[] } {
  const known: KnownFile[] = [];
  const out = {} as Record<ExperimentMode, T[]>;
  const dropped: (Duplicate<T> & { mode: ExperimentMode })[] = [];
  for (const m of modes) {
    const sorted = [...by[m]].sort((a, b) => a.parsed.path.localeCompare(b.parsed.path));
    const r = splitDuplicates(known, sorted, m);
    out[m] = by[m].filter((f) => r.fresh.includes(f));
    for (const d of r.duplicates) dropped.push({ ...d, of: { ...d.of, sameUpload: false }, mode: m });
    known.push(...r.fresh.map((f) => ({ sha256: f.parsed.sha256, path: f.parsed.path, mode: m })));
  }
  return { by: out, dropped };
}

/** The notice after opening a project or restoring a session that contained identical copies. */
export function loadedDuplicateNotice(dropped: (Duplicate<{ parsed: { path: string } }> & { mode: ExperimentMode })[], label: Record<ExperimentMode, string>, what: string): string {
  const list = dropped.slice(0, 3).map((d) => `${d.file.parsed.path} = ${d.of.path}${d.of.mode !== d.mode ? ` (${label[d.of.mode]})` : ''}`).join('; ');
  const more = dropped.length > 3 ? `; and ${dropped.length - 3} more (see the Files tab)` : '';
  return `This ${what} contained ${dropped.length} duplicate file${dropped.length === 1 ? '' : 's'} (identical data); only one copy of each was loaded, so no run is counted twice. Not loaded: ${list}${more}. Save the project again to remove ${dropped.length === 1 ? 'it' : 'them'} from the file.`;
}

/** A run already loaded: where it came from (for the messages). */
export interface KnownRun {
  path: string;
  cycleNumber: number;
  mode: ExperimentMode;
}

export interface ImportPlanItem<T> {
  file: T;
  /** 'imported' = every run is new; 'partial' = only the new runs are imported; 'refused' = nothing is imported. */
  outcome: 'imported' | 'partial' | 'refused';
  /** Run numbers (as in the file) that are imported. */
  keep: number[];
  /** Runs not imported because the same run is already loaded (or earlier in this upload). */
  skipped: { cycleNumber: number; of: KnownRun }[];
  /** Message shown in the import summary. */
  message: string;
}

const runList = (ns: number[]) => `run${ns.length === 1 ? '' : 's'} ${ns.join(', ')}`;

/**
 * Decide, file by file, what an upload adds to the project, without ever touching what is loaded:
 *   1. identical file (same SHA-256 as a loaded file or an earlier file of the upload) → refused;
 *   2. every run already loaded (same run fingerprint) → refused;
 *   3. some runs already loaded → only the new runs are imported;
 *   4. otherwise the whole file is imported.
 * Files and runs accepted earlier in the same upload count as loaded for the later ones.
 */
export function planImport<T extends { parsed: { sha256: string; path: string }; cycles: { cycleNumber: number; fingerprint?: string }[] }>(
  knownFiles: KnownFile[],
  knownRuns: Map<string, KnownRun>,
  incoming: T[],
  /** Test the upload goes to, or the test of each file when one upload holds several tests. */
  modeOf: ExperimentMode | ((f: T) => ExperimentMode),
  label: Record<ExperimentMode, string>,
): ImportPlanItem<T>[] {
  const files = new Map(knownFiles.map((k) => [k.sha256, k]));
  const runs = new Map(knownRuns);
  return incoming.map((f) => {
    const mode = typeof modeOf === 'function' ? modeOf(f) : modeOf;
    const where = (k: { path: string; mode: ExperimentMode }) => `${k.path}${k.mode !== mode ? ` (${label[k.mode]})` : ''}`;
    const same = files.get(f.parsed.sha256);
    if (same) return { file: f, outcome: 'refused' as const, keep: [], skipped: [], message: `Already in project as ${where(same)}.` };
    const skipped: ImportPlanItem<T>['skipped'] = [];
    const keep: number[] = [];
    for (const c of f.cycles) {
      const hit = c.fingerprint ? runs.get(c.fingerprint) : undefined;
      if (hit) skipped.push({ cycleNumber: c.cycleNumber, of: hit });
      else keep.push(c.cycleNumber);
    }
    const sources = [...new Set(skipped.map((s) => where(s.of)))];
    if (f.cycles.length > 0 && keep.length === 0) {
      return { file: f, outcome: 'refused' as const, keep, skipped, message: `All runs already loaded from ${sources.join(', ')}.` };
    }
    files.set(f.parsed.sha256, { sha256: f.parsed.sha256, path: f.parsed.path, mode });
    for (const c of f.cycles) if (c.fingerprint && keep.includes(c.cycleNumber)) runs.set(c.fingerprint, { path: f.parsed.path, cycleNumber: c.cycleNumber, mode });
    if (skipped.length) {
      const bySource = sources.map((src) => `${runList(skipped.filter((s) => where(s.of) === src).map((s) => s.cycleNumber))} (already loaded from ${src})`).join(', ');
      return { file: f, outcome: 'partial' as const, keep, skipped, message: `Imported ${runList(keep)}, skipped ${bySource}.` };
    }
    return { file: f, outcome: 'imported' as const, keep, skipped, message: `Imported ${keep.length} run${keep.length === 1 ? '' : 's'}.` };
  });
}
