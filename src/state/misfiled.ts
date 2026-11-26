/**
 * Files that sit in one test but whose data belong to another (e.g. 90° peel data imported
 * while Probe Tack was open, before uploads were sorted automatically).
 */
import { detectMode, type LoadedFile } from '../parser/loader';
import type { ExperimentMode } from '../types';

export interface Misfiled {
  file: LoadedFile;
  /** Test the file is in now. */
  inMode: ExperimentMode;
  /** Test its data belong to. */
  detected: ExperimentMode;
  /** Why, e.g. "Script block (the 90° peel protocol)". */
  why: string;
}

/** The test a loaded file's data belong to, or null when the file cannot tell (no runs). */
export function testOfData(l: LoadedFile): { mode: ExperimentMode; why: string } | null {
  const d = detectMode(l, 'tack');
  return d.by === 'current' ? null : { mode: d.mode, why: d.why };
}

/**
 * Every loaded file whose data belong to another test than the one it is in. Files the user chose
 * to keep where they are (`kept`: SHA-256 → test) are not listed while they stay in that test.
 */
export function findMisfiled(
  byMode: Record<ExperimentMode, LoadedFile[]>,
  modes: readonly ExperimentMode[],
  kept: Record<string, ExperimentMode> = {},
): Misfiled[] {
  const out: Misfiled[] = [];
  for (const inMode of modes) {
    for (const file of byMode[inMode]) {
      if (kept[file.parsed.sha256] === inMode) continue;
      const t = testOfData(file);
      if (t && t.mode !== inMode) out.push({ file, inMode, detected: t.mode, why: t.why });
    }
  }
  return out;
}

/** Move files between the tests' file lists; nothing else of the lists changes. */
export function moveBetweenTests(
  byMode: Record<ExperimentMode, LoadedFile[]>,
  moves: { fileId: string; from: ExperimentMode; to: ExperimentMode }[],
  byPath: (a: LoadedFile, b: LoadedFile) => number,
): Record<ExperimentMode, LoadedFile[]> {
  const next = { ...byMode };
  for (const m of moves) {
    if (m.from === m.to) continue;
    const file = next[m.from].find((l) => l.parsed.fileId === m.fileId);
    if (!file) continue;
    next[m.from] = next[m.from].filter((l) => l !== file);
    if (!next[m.to].some((l) => l.parsed.fileId === m.fileId)) next[m.to] = [...next[m.to], file].sort(byPath);
  }
  return next;
}
