/**
 * Turns user-selected files (single files, folders, ZIP archives) into parsed
 * Mach-1 files. Runs entirely in the browser; nothing is sent anywhere.
 */
import { unzipSync } from 'fflate';
import type { Cycle, ExperimentMode, OperationBlock, ParsedFile } from '../types';
import { decodeText, sha256Hex } from './hash';
import { extractCycles, isScriptBlock, parseMach1Text } from './mach1Parser';

export interface SourceFile {
  path: string; // relative path with folders, "/"-separated
  bytes: Uint8Array;
}

export interface LoadedFile {
  parsed: ParsedFile;
  cycles: Cycle[];
  bytes: Uint8Array;
}

export interface SkippedEntry {
  path: string;
  reason: string;
  /** Identical content to a file already imported (not added). */
  duplicate?: boolean;
}

const IGNORED = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)\._/;

export function isCandidateTxt(path: string): boolean {
  return /\.txt$/i.test(path) && !IGNORED.test(path);
}

export function expandZip(zipName: string, bytes: Uint8Array): { files: SourceFile[]; skipped: SkippedEntry[] } {
  const entries = unzipSync(bytes);
  const files: SourceFile[] = [];
  const skipped: SkippedEntry[] = [];
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue;
    if (isCandidateTxt(name)) files.push({ path: name, bytes: data });
    else if (!IGNORED.test(name)) skipped.push({ path: `${zipName}/${name}`, reason: 'Not a .txt file' });
  }
  files.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  return { files, skipped };
}

export async function parseSource(src: SourceFile): Promise<LoadedFile> {
  const sha = await sha256Hex(src.bytes);
  const parsed = parseMach1Text(decodeText(src.bytes), src.path, sha, src.bytes.length);
  const cycles = extractCycles(parsed);
  // A fingerprint per run, to recognise runs already loaded from another file.
  for (const c of cycles) {
    const block = parsed.blocks[c.moveBlockIndex];
    if (block) c.fingerprint = await runFingerprint(block, parsed.header['Date']);
  }
  return { parsed, cycles, bytes: src.bytes };
}

/**
 * SHA-256 of one run block: its INFO Date and Time and every numeric row (all columns, e.g. time,
 * z, x, y, Fz), so the same run is recognised whatever the file is called or whatever else it holds.
 */
export async function runFingerprint(block: OperationBlock, fileDate?: string): Promise<string> {
  const lines = [`date\t${block.info['Date'] ?? fileDate ?? ''}`, `time\t${block.info['Time'] ?? ''}`];
  const d = block.data;
  if (d) {
    for (let r = 0; r < d.rowCount; r++) lines.push(d.values.map((col) => String(col[r])).join('\t'));
  }
  return sha256Hex(new TextEncoder().encode(lines.join('\n')));
}

/** Collect browser File objects (from an <input>, folder picker or drop) into SourceFiles. */
export async function collectFromFileList(
  list: ArrayLike<File>,
): Promise<{ files: SourceFile[]; skipped: SkippedEntry[] }> {
  // Copy first: a browser FileList is live and empties when its <input> is reset.
  const items = Array.from(list);
  const files: SourceFile[] = [];
  const skipped: SkippedEntry[] = [];
  for (const f of items) {
    const path = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, '/');
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) {
      const z = expandZip(f.name, bytes);
      const prefix = f.name.replace(/\.zip$/i, '');
      // Keep the archive's internal folder structure; add the archive name only if it has no top folder.
      const hasTop = z.files.length > 0 && z.files.every((x) => x.path.includes('/'));
      for (const x of z.files) files.push({ path: hasTop ? x.path : `${prefix}/${x.path}`, bytes: x.bytes });
      skipped.push(...z.skipped);
    } else if (isCandidateTxt(path)) {
      files.push({ path, bytes });
    } else if (!IGNORED.test(path)) {
      skipped.push({ path, reason: 'Not a .txt or .zip file' });
    }
  }
  return { files, skipped };
}

/** How an upload decided which test a file belongs to. */
export type ModeSource = 'content' | 'name' | 'speed' | 'current';

/** Test names in folder or file names; the closest name to the file wins. */
const NAME_HINTS: [RegExp, ExperimentMode][] = [
  [/lap[\s_-]*shear|\bshear\b/i, 'lapShear'],
  [/\bpeel/i, 'peel'],
  [/tack|\bprobe\b/i, 'tack'],
];

export function modeFromPath(path: string): ExperimentMode | null {
  const parts = path.split('/').reverse();
  for (const part of parts) {
    const hits = NAME_HINTS.filter(([re]) => re.test(part)).map(([, m]) => m);
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/** Fastest stage speed (mm/s) of the moves of a file, or null if none is given. */
function fastestMove(l: LoadedFile): number | null {
  const v = l.parsed.blocks
    .filter((b) => /^move/i.test(b.type))
    .map((b) => Math.abs(parseFloat(Object.entries(b.params).find(([k]) => /^velocity/i.test(k))?.[1] ?? '')))
    .filter(Number.isFinite);
  return v.length ? Math.max(...v) : null;
}

/** Lap shear pulls slowly (typically 5 mm/min ≈ 0.08 mm/s); probe tack retracts at mm/s. */
const TACK_MIN_SPEED = 1;

/**
 * Test a file belongs to, so one upload can hold files of every test:
 *   1. a Script block → 90° peel (the peel protocol runs as a script);
 *   2. a test named in the nearest folder or file name ("lap-shear 2026 Oct", "90 peel", "tack");
 *   3. hold (Wait) blocks before the moves → probe tack;
 *   4. moves faster than 1 mm/s → probe tack, slower → lap shear;
 *   5. otherwise (no runs, e.g. a note) the test that is open.
 */
export function detectMode(l: LoadedFile, fallback: ExperimentMode): { mode: ExperimentMode; by: ModeSource } {
  if (l.parsed.blocks.some((b) => isScriptBlock(b.type))) return { mode: 'peel', by: 'content' };
  const named = modeFromPath(l.parsed.path);
  if (named) return { mode: named, by: 'name' };
  if (l.cycles.some((c) => c.holdBlockIndex !== null)) return { mode: 'tack', by: 'content' };
  if (!l.cycles.length) return { mode: fallback, by: 'current' };
  const v = fastestMove(l);
  if (v !== null) return { mode: v >= TACK_MIN_SPEED ? 'tack' : 'lapShear', by: 'speed' };
  return { mode: fallback, by: 'current' };
}

/** Test of a stored file saved before files were kept per test. */
export function guessMode(l: LoadedFile): ExperimentMode {
  return detectMode(l, l.cycles.length ? 'lapShear' : 'tack').mode;
}
