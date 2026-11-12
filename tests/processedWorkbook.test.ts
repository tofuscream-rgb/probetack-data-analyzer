import { describe, expect, it } from 'vitest';
import { processedSheets, type ProcessedRow } from '../src/export/processedWorkbook';
import { plotSheet } from '../src/export/plotWorkbook';
import { GF_TO_N } from '../src/types';

const row = (fileId: string, number: number, gf: number): ProcessedRow => ({
  id: `${fileId}-${number}`, fileId, name: fileId, path: `PET/${fileId}.txt`, number,
  cond: { substrate: 'PET', chargeRatio: '0.25', concentration: '2.5', concentrationDefault: false, hold: '1' },
  gel: null, primary: gf * GF_TO_N, peakN: gf * GF_TO_N, normalized: 2, workMJ: 3, incomplete: false, note: '',
});

describe('processed adhesion report', () => {
  it('averages repeat means equally and writes only the requested sheet', () => {
    const [sheet] = processedSheets('lapShear', [row('1s', 1, 10), row('1s', 2, 10), row('1s-v2', 1, 30)], ['condition']);
    expect(sheet.name).toBe('Per Condition');
    expect(sheet.rows[0]).toEqual(['Condition', 'Metric', 'Mean', 'SD', 'Work note']);
    expect(sheet.rows[1][2]).toBeCloseTo(20);
    expect(sheet.rows[1][3]).toBeCloseTo(Math.sqrt(200));
    expect(sheet.rows[2][2]).toBeCloseTo(20 * GF_TO_N);
  });

  it('keeps missing normalized values blank and labels recorded-end work', () => {
    const [sheet] = processedSheets('tack', [{ ...row('1s', 1, 10), normalized: NaN, incomplete: true }], ['run']);
    expect(sheet.rows[1][4]).toBeCloseTo(10);
    expect(sheet.rows[3].slice(3)).toEqual(['Measured work Wadh (mJ)', 3, 'Recorded end']);
    expect(sheet.rows[4][4]).toBeNull();
  });
});

it('exports plotted units and gaps as an editable chart with vertically stacked data', () => {
  const sheet = plotSheet('Test', {
    data: [
      { type: 'scatter', mode: 'lines', name: 'Run A', x: [0, 1, 2], y: [0, null, 3] },
      { type: 'scatter', mode: 'lines', visible: 'legendonly', x: [0, 1], y: [0, 2] },
    ],
    layout: { xaxis: { title: { text: 'Distance (mm)' } }, yaxis: { title: { text: 'Force (N)' } } },
  });
  expect(sheet?.rows.slice(-4)).toEqual([['Curve', 'Distance (mm)', 'Force (N)'], ['Run A', 0, 0], [null, 1, null], [null, 2, 3]]);
  expect(sheet?.charts?.[0].series).toHaveLength(1);
  expect(sheet?.charts?.[0].series[0].yRange).toEqual(['C25', 'C27']);
});
