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
