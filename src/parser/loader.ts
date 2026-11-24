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

/**
 * Test a file most likely belongs to, for sessions and projects saved before files
 * were kept per test: hold (Wait) blocks before the moves = probe tack, a Script
 * block = 90° peel, otherwise lap shear.
 */
export function guessMode(l: LoadedFile): ExperimentMode {
  if (l.cycles.some((c) => c.holdBlockIndex !== null)) return 'tack';
  if (l.parsed.blocks.some((b) => isScriptBlock(b.type))) return 'peel';
  return l.cycles.length ? 'lapShear' : 'tack';
}
