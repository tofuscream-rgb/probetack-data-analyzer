import { describe, expect, it } from 'vitest';
import { processedSheets, type ProcessedRow } from '../src/export/processedWorkbook';
import { GF_TO_N } from '../src/types';

const row = (fileId: string, number: number, gf: number): ProcessedRow => ({
  id: `${fileId}-${number}`, fileId, name: fileId, path: `PET/${fileId}.txt`, number,
  cond: { substrate: 'PET', chargeRatio: '0.25', concentration: '2.5', concentrationDefault: false, hold: '1' },
  gel: null, primary: gf * GF_TO_N, peakN: gf * GF_TO_N, normalized: 2, workMJ: 3, incomplete: false, note: '',
});

describe('processed adhesion report', () => {
  it('averages repeat means equally and writes only the requested sheet', () => {
    const [sheet] = processedSheets('lapShear', [row('1s', 1, 10), row('1s', 2, 10), row('1s-v2', 1, 30)], ['condition']);
    expect(sheet.name).toBe('Per condition');
    expect(sheet.rows).toHaveLength(2);
    expect(sheet.rows[1].slice(1, 4)).toEqual([2, 3, 0]);
    expect(sheet.rows[1][4]).toBeCloseTo(20);
    expect(sheet.rows[1][6]).toBe(2);
    expect(sheet.rows[1][7]).toBeCloseTo(20 * GF_TO_N);
  });

  it('keeps missing normalized values blank and labels recorded-end work', () => {
    const [sheet] = processedSheets('tack', [{ ...row('1s', 1, 10), normalized: NaN, incomplete: true }], ['run']);
    expect(sheet.rows[1][3]).toBeCloseTo(10);
    expect(sheet.rows[1].slice(4)).toEqual([10 * GF_TO_N, 3, null, null, 'Recorded end only']);
  });
});
