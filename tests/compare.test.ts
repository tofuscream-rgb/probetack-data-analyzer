import { describe, expect, it } from 'vitest';
import { parseSource } from '../src/parser/loader';
import { buildComparison } from '../src/analysis/compare';
import { defaultCompare } from '../src/state/defaults';
import { derive, enc, miniFile } from './helpers';

/** Runs whose recorded minimum is −peak (one move per value). */
const moves = (peaks: number[]) => peaks.map((p) => Array.from({ length: 40 }, (_, i) => (i === 20 ? -p : -p / 4)));
const file = (path: string, peaks: number[]) => parseSource({ path, bytes: enc(miniFile(moves(peaks))) });

describe('compare data sets', () => {
  it('builds one data set per substrate × charge ratio × concentration and lets several be compared', async () => {
    const loaded = await Promise.all([
      file('0.25 2.1M/glass/1s.txt', [10, 12]),
      file('0.25 2.5M/glass/1s.txt', [20, 22]),
      file('0.25 2.98M/glass/1s.txt', [30, 32]),
      file('0.5/glass/1s.txt', [5, 7]),
      file('0.25 2.1M/ss/1s.txt', [40, 44]),
      file('0.25 2.5M/SS/1s.txt', [50, 54]), // same substrate as "ss"
    ]);
    const d = derive(loaded);
    // Glass + charge ratio 0.25 + three concentrations: three sets, never mixed.
    const sel = { ...defaultCompare(), substrates: ['glass'], chargeRatios: ['0.25'] };
    const c = buildComparison(d.ordered, sel);
    expect(c.sets.map((s) => s.concentration)).toEqual(['2.1', '2.5', '2.98']);
    const means = c.sets.map((s) => c.stats(s, '30')!.raw.mean);
    expect(means).toEqual([-11, -21, -31]);
    expect(c.stats(c.sets[0], '30')!.raw.sd).toBeCloseTo(Math.SQRT2, 10);

    // Two substrates, every charge ratio: panels in tick order, charge ratio high → low inside each.
    const both = buildComparison(d.ordered, { ...defaultCompare(), substrates: ['ss', 'glass'] });
    expect(both.substrates.map((s) => s.value)).toEqual(['glass', 'ss']);
    expect(both.sets.map((s) => `${s.substrate} ${s.chargeRatio} ${s.concentration}`)).toEqual([
      'ss 0.25 2.1', 'ss 0.25 2.5', 'glass 0.5 2.1', 'glass 0.25 2.1', 'glass 0.25 2.5', 'glass 0.25 2.98',
    ]);
    expect(both.sets.find((s) => s.chargeRatio === '0.5')!.concentrationDefault).toBe(true);

    // Unticking one data set keeps it listed but marks it hidden; ascending order flips charge ratios.
    const hidden = buildComparison(d.ordered, { ...defaultCompare(), substrates: ['glass'], hiddenSets: ['glass|0.5|2.1'], order: 'asc' });
    expect(hidden.sets.map((s) => [s.chargeRatio, s.hidden])).toEqual([['0.25', false], ['0.25', false], ['0.25', false], ['0.5', true]]);
  });

  it('defaults to the substrate chosen in the sidebar and ignores selections that are no longer available', async () => {
    const d = derive(await Promise.all([file('0.5/glass/1s.txt', [5]), file('0.5/PET/1s.txt', [6])]));
    expect(buildComparison(d.ordered, defaultCompare(), 'PET').selected.substrates).toEqual(['pet']);
    const c = buildComparison(d.ordered, { ...defaultCompare(), substrates: ['glass'], chargeRatios: ['9.9'], holdTimes: ['30'] });
    expect(c.selected.chargeRatios).toEqual([]);
    expect(c.sets).toHaveLength(0);
  });
});
