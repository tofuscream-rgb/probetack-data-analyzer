import { describe, expect, it } from 'vitest';
import { parseSource, type LoadedFile } from '../src/parser/loader';
import { findMisfiled, moveBetweenTests, testOfData } from '../src/state/misfiled';
import { migrateState } from '../src/storage/project';
import { EXPERIMENT_MODES } from '../src/types';
import { enc } from './helpers';

const peelFile = (path: string) => {
  const rows = Array.from({ length: 50 }, (_, i) => `${(i / 100).toFixed(6)}\t${(-i * 0.05).toFixed(6)}\t0\t0\t${(i < 5 ? 0 : -200).toFixed(6)}`);
  return parseSource({ path, bytes: enc(['<Mach-1 File>', '<Scripts>', 'Script 1', '1VA5;2VA5;', '1PR-65;2PR-65;', '<DATA>', 'Time, s\tPosition (z), mm\tPosition (x), mm\tPosition (y), mm\tFz, gf', ...rows, '<END DATA>'].join('\r\n')) });
};
const moveFile = (path: string, velocity: number) =>
  parseSource({ path, bytes: enc(['<Mach-1 File>', '<Move Relative>', 'Amplitude, mm:\t-25', `Velocity, mm/s:\t${velocity}`, '<DATA>', 'Time, s\tPosition (z), mm\tFz, gf', '0\t0\t0', '0.01\t-0.1\t-5', '0.02\t-0.2\t-9', '<END DATA>'].join('\r\n')) });
const byPath = (a: LoadedFile, b: LoadedFile) => a.parsed.path.localeCompare(b.parsed.path);

describe('files in the wrong test', () => {
  it('finds peel data loaded in Probe Tack and moves it to 90° Peel', async () => {
    const peel = await peelFile('Oct/0.25/glass.txt');
    const lap = await moveFile('Oct/0.25/SS.txt', 0.0833);
    const tack = await moveFile('Nov/1s.txt', 10);
    const note = await parseSource({ path: 'Oct/note.txt', bytes: enc('gel slipped') });
    const byMode = { tack: [peel, tack, note], lapShear: [lap], peel: [] as LoadedFile[] };
    const found = findMisfiled(byMode, EXPERIMENT_MODES);
    expect(found.map((m) => [m.file.parsed.path, m.inMode, m.detected])).toEqual([['Oct/0.25/glass.txt', 'tack', 'peel']]);
    expect(found[0].why).toMatch(/Script block/);
    expect(testOfData(note)).toBeNull(); // no runs: never flagged

    const moved = moveBetweenTests(byMode, [{ fileId: peel.parsed.fileId, from: 'tack', to: 'peel' }], byPath);
    expect(moved.tack.map((l) => l.parsed.path)).toEqual(['Nov/1s.txt', 'Oct/note.txt']);
    expect(moved.peel).toEqual([peel]);
    expect(findMisfiled(moved, EXPERIMENT_MODES)).toEqual([]);
    expect(byMode.tack).toHaveLength(3); // the input is not changed
  });

  it('can move a file by hand anywhere, and a file kept on purpose is not flagged again while it stays', async () => {
    const lap = await moveFile('a/SS.txt', 0.0833);
    const byMode = { tack: [lap], lapShear: [] as LoadedFile[], peel: [] as LoadedFile[] };
    expect(findMisfiled(byMode, EXPERIMENT_MODES)).toHaveLength(1);
    const kept = { [lap.parsed.sha256]: 'tack' as const };
    expect(findMisfiled(byMode, EXPERIMENT_MODES, kept)).toEqual([]);
    // Moved elsewhere later, the keep choice no longer applies.
    const inPeel = moveBetweenTests(byMode, [{ fileId: lap.parsed.fileId, from: 'tack', to: 'peel' }], byPath);
    expect(findMisfiled(inPeel, EXPERIMENT_MODES, kept).map((m) => m.detected)).toEqual(['lapShear']);
  });

  it('saves the keep choices in projects and drops invalid ones', () => {
    const s = migrateState({ keptInTest: { abc: 'peel', bad: 'nope', n: 3 } } as unknown as Parameters<typeof migrateState>[0]);
    expect(s.keptInTest).toEqual({ abc: 'peel' });
    expect(migrateState({}).keptInTest).toEqual({});
  });
});

describe('a saved project opened as data', () => {
  it('takes the storage folders off the paths, tells the test from them and leaves out the README', async () => {
    const { unpackSavedProjects } = await import('../src/parser/loader');
    const b = new Uint8Array([1]);
    const r = unpackSavedProjects(
      [
        { path: 'P (most updated)/README.txt', bytes: b },
        { path: 'P (most updated)/data/@peel/post conference/0.25 2.1M/PET.txt', bytes: b },
        { path: 'P (most updated)/data/@lapShear/lap-shear 2026 Oct/0.25/SS.txt', bytes: b },
        { path: 'P (most updated)/data/Full data_nov.12/ss/1s.txt', bytes: b },
        { path: 'other/data/x.txt', bytes: b },
      ],
      [{ path: 'upload.zip/P (most updated)/project.json', reason: 'Not a .txt file' }, { path: 'upload.zip/a.png', reason: 'Not a .txt file' }],
    );
    expect(r.projects).toBe(1);
    expect(r.files.map((f) => [f.path, f.mode])).toEqual([
      ['post conference/0.25 2.1M/PET.txt', 'peel'],
      ['lap-shear 2026 Oct/0.25/SS.txt', 'lapShear'],
      ['Full data_nov.12/ss/1s.txt', 'tack'],
      ['other/data/x.txt', undefined],
    ]);
    expect(r.skipped.map((s) => s.path)).toEqual(['upload.zip/a.png']);
    // Ordinary uploads are not changed.
    const plain = [{ path: 'data/0.25/PET.txt', bytes: b }];
    expect(unpackSavedProjects(plain, []).files).toBe(plain);
  });
});
