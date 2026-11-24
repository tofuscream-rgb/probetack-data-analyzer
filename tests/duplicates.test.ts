import { describe, expect, it } from 'vitest';
import { duplicateReason, splitDuplicates } from '../src/state/duplicates';
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

});

describe('duplicates inside a project or restored session', () => {
  it('keeps the first copy (path order) and reports the others, within and across tests', async () => {
    const { dedupeByMode, loadedDuplicateNotice } = await import('../src/state/duplicates');
    const by = {
      tack: [f('t/1s.txt', 't1')],
      lapShear: [f('l/glass.txt', 'same-as-tack')].map((x) => ({ ...x, parsed: { ...x.parsed, sha256: 't1' } })),
      peel: [f('post conference/90 peel 2026 Oct/0.25 2.98M/glass.txt', 'g'), f('0.25 2.98M/glass.txt', 'g'), f('0.25 2.98M/PET.txt', 'p')],
    };
    const r = dedupeByMode(by, ['tack', 'lapShear', 'peel']);
    expect(r.by.tack.map((x) => x.parsed.path)).toEqual(['t/1s.txt']);
    expect(r.by.lapShear).toHaveLength(0);
    expect(r.by.peel.map((x) => x.parsed.path)).toEqual(['0.25 2.98M/glass.txt', '0.25 2.98M/PET.txt']);
    expect(r.dropped.map((d) => [d.mode, d.file.parsed.path, d.of.path])).toEqual([
      ['lapShear', 'l/glass.txt', 't/1s.txt'],
      ['peel', 'post conference/90 peel 2026 Oct/0.25 2.98M/glass.txt', '0.25 2.98M/glass.txt'],
    ]);
    expect(loadedDuplicateNotice(r.dropped, MODE_LABEL, 'project')).toMatch(/^This project contained 2 duplicate files \(identical data\); only one copy of each was loaded/);
  });
});
