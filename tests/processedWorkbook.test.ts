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
    expect(sheet.rows[0]).toEqual(['Metric', 'Charge ratio', 'Concentration (M)', 'Substrate', 'Dwell (s)', 'Mean', 'SD', 'Work note']);
    expect(sheet.rows[1].slice(0, 5)).toEqual(['Peak load (gf)', 0.25, 2.5, 'PET', 1]);
    expect(sheet.rows[1][5]).toBeCloseTo(20);
    expect(sheet.rows[1][6]).toBeCloseTo(Math.sqrt(200));
    expect(sheet.rows[2][5]).toBeCloseTo(20 * GF_TO_N);
  });

  it('groups rows by metric, then conditions in numeric order', () => {
    const at = (hold: string, substrate: string, gf: number) => ({ ...row(`${substrate}${hold}`, 1, gf), cond: { ...row('x', 1, 1).cond, hold, substrate } });
    const [sheet] = processedSheets('tack', [at('60', 'ss', 3), at('1', 'ss', 1), at('30', 'ss', 2), at('1', 'glass', 4)], ['condition']);
    const peak = sheet.rows.filter((r) => r[0] === 'Peak adhesion force (gf)');
    expect(peak.map((r) => [r[3], r[4], r[5]])).toEqual([['ss', 1, 1], ['ss', 30, 2], ['ss', 60, 3], ['glass', 1, 4]]);
    expect(sheet.rows[1][0]).toBe('Peak adhesion force (gf)');
    expect(sheet.rows[5][0]).toBe('Peak adhesion force (N)');
  });

  it('Compare Gels: bars per gel with substrates side by side, dwell-time lines, SD error bars', () => {
    const at = (cr: string, hold: string, substrate: string, gf: number) => ({ ...row(`${cr}${substrate}${hold}`, 1, gf), cond: { ...row('x', 1, 1).cond, chargeRatio: cr, hold, substrate } });
    const data = ['0.25', '0.5'].flatMap((cr) => ['ss', 'glass'].flatMap((sub) => ['1', '30'].map((h) => at(cr, h, sub, Number(h) + Number(cr)))));
    const [sheet] = processedSheets('lapShear', data, ['gel']);
    expect(sheet.name).toBe('Compare Gels');
    const bar = sheet.charts!.find((c) => c.title === 'Peak load (N): each gel, substrates side by side')!;
    expect(bar.type).toBe('bar');
    expect(bar.series.map((x) => x.name)).toEqual(['ss · 1 s', 'ss · 30 s', 'glass · 1 s', 'glass · 30 s']);
    expect(bar.series[0].categories).toEqual(['CR 0.25 · 2.5 M', 'CR 0.5 · 2.5 M']);
    expect(bar.series[1].yValues.map((v) => +(v! / GF_TO_N).toFixed(2))).toEqual([30.25, 30.5]);
    expect(bar.series[0].yErrRange).toBeDefined();
    const dwell = sheet.charts!.find((c) => c.title.startsWith('Peak load (N) vs dwell'))!;
    expect(dwell.series.map((x) => x.name)).toEqual(['CR 0.25 · 2.5 M · ss', 'CR 0.25 · 2.5 M · glass', 'CR 0.5 · 2.5 M · ss', 'CR 0.5 · 2.5 M · glass']);
    expect(dwell.series[0].xValues).toEqual([1, 30]);
    // The autofilter covers only the long table.
    expect(sheet.filterRows).toBe(1 + data.length * 5);
  });

  it('Compare Gels draws bars even with one dwell time and gels that differ by concentration', () => {
    const at = (cr: string, conc: string, substrate: string) => ({ ...row(`${cr}${conc}${substrate}`, 1, 10), cond: { ...row('x', 1, 1).cond, chargeRatio: cr, concentration: conc, substrate, hold: '—' } });
    const [sheet] = processedSheets('peel', [at('0.25', '2.5', 'glass'), at('0.25', '2.98', 'glass'), at('0.25', '2.5', 'PET')], ['gel']);
    const bars = sheet.charts!.filter((c) => c.type === 'bar');
    expect(bars).toHaveLength(4); // the four metrics not in gf
    expect(bars[0].series.map((x) => x.name)).toEqual(['PET', 'glass']);
    expect(bars[0].series[0].categories).toEqual(['CR 0.25 · 2.5 M', 'CR 0.25 · 2.98 M']);
    expect(sheet.charts!.some((c) => c.type !== 'bar')).toBe(false);
  });

  it('keeps missing normalized values blank and labels recorded-end work', () => {
    const [sheet] = processedSheets('tack', [{ ...row('1s', 1, 10), normalized: NaN, incomplete: true }], ['run']);
    const value = (metric: string) => sheet.rows.find((r) => r[0] === metric)!;
    expect(value('Peak adhesion force (gf)')[7]).toBeCloseTo(10);
    expect(value('Measured work Wadh (mJ)').slice(7)).toEqual([3, 'Recorded end']);
    expect(value('Peak nominal tensile stress (kPa)')[7]).toBeNull();
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
