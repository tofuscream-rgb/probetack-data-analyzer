import { describe, expect, it } from 'vitest';
import { duplicateNotice, duplicateReason, splitDuplicates } from '../src/state/duplicates';
import { MODE_LABEL } from '../src/state/AppContext';

const f = (path: string, sha256: string) => ({ parsed: { path, sha256 } });

describe('duplicate files on import', () => {
  it('finds identical data under another name, in another test and repeated within the upload', () => {
    const known = [{ sha256: 'aaa', path: 'peel/0.25 2.5M/glass.txt', mode: 'peel' as const }, { sha256: 'ttt', path: 'tack/1s.txt', mode: 'tack' as const }];
    const incoming = [f('new/glass-copy.txt', 'aaa'), f('new/PET.txt', 'bbb'), f('new/PET again.txt', 'bbb'), f('new/1s.txt', 'ttt')];
    const r = splitDuplicates(known, incoming, 'peel');
    expect(r.fresh.map((x) => x.parsed.path)).toEqual(['new/PET.txt']);
    expect(r.duplicates.map((d) => [d.file.parsed.path, d.of.path, d.of.mode, d.of.sameUpload])).toEqual([
      ['new/glass-copy.txt', 'peel/0.25 2.5M/glass.txt', 'peel', false],
      ['new/PET again.txt', 'new/PET.txt', 'peel', true],
      ['new/1s.txt', 'tack/1s.txt', 'tack', false],
    ]);
    expect(duplicateReason(r.duplicates[2], 'peel', MODE_LABEL)).toBe('Duplicate: identical data to tack/1s.txt (already imported in Probe Tack); not added.');
    expect(duplicateReason(r.duplicates[1], 'peel', MODE_LABEL)).toMatch(/earlier in this upload/);
  });

  it('a file with the same name but different data is not a duplicate', () => {
    const r = splitDuplicates([{ sha256: 'aaa', path: 'glass.txt', mode: 'peel' }], [f('glass.txt', 'zzz')], 'peel');
    expect(r.fresh).toHaveLength(1);
    expect(r.duplicates).toHaveLength(0);
  });

  it('messages: one duplicate, all duplicates, and a folder with new and duplicate files', () => {
    const d = (p: string, of: string) => ({ file: f(p, 'x'), of: { path: of, mode: 'peel' as const, sameUpload: false } });
    expect(duplicateNotice(1, 0, [d('a/glass.txt', 'b/glass.txt')], 'peel', MODE_LABEL)).toBe('This data has already been imported: glass.txt = b/glass.txt. Nothing new was added.');
    expect(duplicateNotice(2, 0, [d('a/1.txt', 'b/1.txt'), d('a/2.txt', 'b/2.txt')], 'peel', MODE_LABEL)).toMatch(/^This data has already been imported: all 2 files are identical/);
    expect(duplicateNotice(5, 3, [d('a/1.txt', 'b/1.txt'), d('a/2.txt', 'b/2.txt')], 'peel', MODE_LABEL))
      .toBe('Only 3 of 5 files were imported. The remaining 2 are duplicates of data already here (identical content) and were skipped: 1.txt = b/1.txt; 2.txt = b/2.txt.');
  });
});
