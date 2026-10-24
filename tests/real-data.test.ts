/**
 * Optional tests against real (unpublished) Mach-1 files.
 * Put files in ./private-data/ (git-ignored). Skipped automatically when absent,
 * e.g. on GitHub Actions, so no real data is ever needed in the repository.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSource } from '../src/parser/loader';
import { inferMetadata } from '../src/parser/pathMetadata';
import { computeDerived } from '../src/analysis/engine';
import { defaultProject } from '../src/state/defaults';

const ROOT = join(__dirname, '..', 'private-data');
const have = existsSync(ROOT);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n: string) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe.skipIf(!have)('real Mach-1 files (private-data/)', () => {
  it('parses every file and reports the summary', async () => {
    const files = walk(ROOT).filter((p) => p.endsWith('.txt'));
    const loaded = await Promise.all(
      files.map((p) => parseSource({ path: relative(ROOT, p).split('\\').join('/'), bytes: new Uint8Array(readFileSync(p)) })),
    );
    const cyclesByFile = new Map(loaded.map((l) => [l.parsed.fileId, l.cycles]));
    const meta = new Map(loaded.map((l) => [l.parsed.fileId, inferMetadata(l.parsed.path)]));
    const d = computeDerived(loaded.map((l) => l.parsed), cyclesByFile, meta, defaultProject());
    for (const l of loaded) {
      console.log(`${l.parsed.path}: ${l.parsed.status}, ${l.cycles.length} cycles; ${l.parsed.issues.map((i) => i.message).join(' | ')}`);
    }
    for (const r of d.ordered) {
      console.log(
        `${r.file.name} c${r.cycle.cycleNumber} hold=${r.holdTimeS} amp=${r.cycle.amplitudeMm} min=${r.raw.min.toFixed(2)} pts[y/o/r]=${r.points.counts.slice(1).join('/')} qc=${r.qc} modZ=${r.modZ?.toFixed(2)} :: ${r.flags.map((f) => f.code).join(',')}`,
      );
    }
    for (const g of d.groups) console.log(`GROUP ${g.key}: n=${g.nCycles} runs=${g.nRuns} mean=${g.mean.toFixed(2)} median=${g.median.toFixed(2)} sd=${g.sd.toFixed(2)}`);
    expect(loaded.length).toBeGreaterThan(0);
  });
});
