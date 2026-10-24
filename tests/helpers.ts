import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSource, type LoadedFile } from '../src/parser/loader';
import { inferMetadata, applyOverride } from '../src/parser/pathMetadata';
import { computeDerived } from '../src/analysis/engine';
import type { ExperimentMeta, ProjectState } from '../src/types';
import { defaultProject } from '../src/state/defaults';

export const SYNTH = join(__dirname, '..', 'examples', 'synthetic-data');

export function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n: string) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export async function loadSynthetic(): Promise<LoadedFile[]> {
  const files = walk(SYNTH).filter((p) => p.endsWith('.txt')).sort();
  return Promise.all(
    files.map((p) => parseSource({ path: relative(SYNTH, p).split('\\').join('/'), bytes: new Uint8Array(readFileSync(p)) })),
  );
}

export function derive(loaded: LoadedFile[], project: ProjectState = defaultProject()) {
  const cyclesByFile = new Map(loaded.map((l) => [l.parsed.fileId, l.cycles]));
  const meta = new Map<string, ExperimentMeta>(
    loaded.map((l) => [l.parsed.fileId, applyOverride(inferMetadata(l.parsed.path), project.overrides[l.parsed.fileId])]),
  );
  return computeDerived(loaded.map((l) => l.parsed), cyclesByFile, meta, project);
}

export const enc = (s: string) => new TextEncoder().encode(s);

/** Build a small Mach-1-style text with given move forces. */
export function miniFile(moves: number[][], opts: { holdS?: number; forceHeader?: string; crlf?: boolean } = {}): string {
  const nl = opts.crlf === false ? '\n' : '\r\n';
  const L: string[] = ['<Mach-1 File>'];
  const info = ['<INFO>', 'Date:\tWed, Oct 21, 2026', 'Time:\t16:28:11.687', 'Load Cell Low-pass filter:\tYes', '<END INFO>'];
  moves.forEach((forces, k) => {
    L.push(...info, '<Wait>', `Wait:\t00:00:${String(opts.holdS ?? 30).padStart(2, '0')}`, '<DATA>');
    L.push(`Time, s\tPosition (z), mm\tPosition (x), mm\tPosition (y), mm\t${opts.forceHeader ?? 'Fz, gf'}`);
    for (let i = 0; i < 5; i++) L.push(`${(i / 100).toFixed(6)}\t10.000000\t0.3\t-0.08\t1.000000`);
    L.push('<END DATA>', ...info, '<Move Relative>', 'Stage Axis:\tPosition (z)', 'Amplitude, mm:\t-2.5000', 'Velocity, mm/s:\t10.0000', '<DATA>');
    L.push(`Time, s\tPosition (z), mm\tPosition (x), mm\tPosition (y), mm\t${opts.forceHeader ?? 'Fz, gf'}`);
    forces.forEach((f, i) => {
      const z = 10 - (2.5 * i) / Math.max(1, forces.length - 1);
      L.push(`${(i / 100).toFixed(6)}\t${z.toFixed(6)}\t0.3\t-0.08\t${f.toFixed(6)}`);
    });
    L.push('<END DATA>');
    void k;
  });
  return L.join(nl) + nl;
}
