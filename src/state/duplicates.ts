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

const name = (path: string) => path.split('/').pop() ?? path;

/** "glass-v2.txt = glass.txt (already in 90° Peel)" for the message and the Files tab. */
export function duplicateReason(d: Duplicate<{ parsed: { path: string } }>, mode: ExperimentMode, label: Record<ExperimentMode, string>): string {
  const where = d.of.sameUpload ? 'earlier in this upload' : d.of.mode === mode ? 'already imported' : `already imported in ${label[d.of.mode]}`;
  return `Duplicate: identical data to ${d.of.path} (${where}); not added.`;
}

/** The notice after an upload that contained duplicates. */
export function duplicateNotice(total: number, added: number, duplicates: Duplicate<{ parsed: { path: string } }>[], mode: ExperimentMode, label: Record<ExperimentMode, string>): string {
  const list = duplicates.slice(0, 3).map((d) => `${name(d.file.parsed.path)} = ${d.of.path}${d.of.mode !== mode && !d.of.sameUpload ? ` (${label[d.of.mode]})` : ''}`).join('; ');
  const more = duplicates.length > 3 ? `; and ${duplicates.length - 3} more (see the Files tab)` : '';
  if (added === 0) {
    return duplicates.length === 1
      ? `This data has already been imported: ${list}. Nothing new was added.`
      : `This data has already been imported: all ${total} files are identical to files already here (${list}${more}). Nothing new was added.`;
  }
  return `Only ${added} of ${total} files were imported. The remaining ${duplicates.length} ${duplicates.length === 1 ? 'is a duplicate' : 'are duplicates'} of data already here (identical content) and ${duplicates.length === 1 ? 'was' : 'were'} skipped: ${list}${more}.`;
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
