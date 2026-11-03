import { describe, expect, it } from 'vitest';
import { buildRunComparison, runCondition, type CompareItem } from '../src/analysis/runCompare';
import { inferMetadata } from '../src/parser/pathMetadata';
import { defaultLapShear, defaultPeel } from '../src/state/defaults';
import { migrateState, remapState } from '../src/storage/project';

const item = (path: string, value: number): CompareItem => ({ id: path + value, cond: runCondition(inferMetadata(path)), values: { tau: value } });

describe('lap shear / peel: compare charge ratios', () => {
  it('groups ticked runs into substrate × charge ratio × concentration sets with mean ± SD', () => {
    const items = [
      item('0.25 2.1M/ss/a.txt', 10), item('0.25 2.1M/ss/b.txt', 12),
      item('0.25 2.5M/SS/a.txt', 20),
      item('0.25 2.98M/ss/a.txt', 30),
      item('0.5/ss/a.txt', 5), item('0.5/glass/a.txt', 7),
    ];
    const sel = { ...defaultLapShear().compare, substrates: ['ss'], chargeRatios: ['0.25'] };
    const c = buildRunComparison(items, sel);
    expect(c.substrates.map((s) => s.value)).toEqual(['glass', 'ss']);
    expect(c.sets.map((s) => s.concentration)).toEqual(['2.1', '2.5', '2.98']);
    expect(c.holdTimes).toEqual(['—']); // no holding time in these file names
    const s0 = c.stat(c.sets[0], '—', 'tau');
    expect(s0).toEqual({ mean: 11, sd: Math.SQRT2, n: 2 });
    // All substrates, every charge ratio; panels in tick order with charge ratio high → low.
    const all = buildRunComparison(items, { ...defaultLapShear().compare, substrates: ['ss', 'glass'] });
    expect(all.sets.map((s) => `${s.substrate} ${s.chargeRatio} ${s.concentration}`)).toEqual(['ss 0.5 2.1', 'ss 0.25 2.1', 'ss 0.25 2.5', 'ss 0.25 2.98', 'glass 0.5 2.1']);
    expect(all.sets[0].concentrationDefault).toBe(true);
  });

  it('uses holding times from the file names as bar series', () => {
    const items = [item('0.25/glass/1s.txt', 3), item('0.25/glass/60s.txt', 9), item('0.25/glass/60s-2.txt', 11)];
    const c = buildRunComparison(items, defaultPeel().compare);
    expect(c.holdTimes).toEqual(['1', '60']);
    expect(c.stat(c.sets[0], '60', 'tau')).toMatchObject({ mean: 10, n: 2 });
  });

  it('opens 1.5 projects with shading off and the new Compare tab available', () => {
    const s = migrateState({ lapShear: { view: { shade: true }, tab: 'compare' } as never, peel: { view: { showPlateau: true } } as never });
    expect(s.lapShear.view.shade).toBe('none');
    expect(s.lapShear.view.highlight).toBeNull();
    expect(s.lapShear.tab).toBe('compare');
    expect(s.peel.view.shade).toBe('none');
    expect(s.lapShear.compare.metric).toBe('tauKPa');
    expect(s.peel.compare.metric).toBe('toughness');
  });
});

describe('unique run labels', () => {
  it('uses the folder path when file names repeat', async () => {
    const { uniqueFileNames } = await import('../src/state/experiment');
    const m = uniqueFileNames([
      { fileId: 'a', name: '1s.txt', path: 'Lap/0.25 2.1M/ss/1s.txt' },
      { fileId: 'b', name: '1s.txt', path: 'Lap/0.25 2.5M/ss/1s.txt' },
      { fileId: 'c', name: 'x.txt', path: 'Lap/0.5/glass/x.txt' },
    ]);
    expect([m.get('a'), m.get('b'), m.get('c')]).toEqual(['0.25 2.1M/ss/1s.txt', '0.25 2.5M/ss/1s.txt', 'x.txt']);
  });
});

describe('legend labels from conditions', () => {
  it('labels runs "0.25 · 2.98 M · glass" and adds the file name only where labels repeat', async () => {
    const { runLabels } = await import('../src/analysis/runCompare');
    const mk = (path: string, n = 1, of = 1) => ({ fileId: path, fileName: path.split('/').pop()!, uniqueName: path, cycleNumber: n, runsInFile: of, cond: runCondition(inferMetadata(path)) });
    const labels = runLabels([
      mk('p/0.25 2.98M 90/glass.txt'), mk('p/0.25 2.98M 90/PET.txt'), mk('p/0.25 2.5M/glass.txt'),
      mk('p/0.5/ss/a.txt', 1, 2), mk('p/0.5/ss/a.txt', 2, 2),
      mk('p/0.25 2.1M/glass-1.txt'), mk('p/0.25 2.1M/glass-2.txt'),
      mk('p/run.txt'),
    ]);
    expect(labels).toEqual([
      '0.25 · 2.98 M · glass', '0.25 · 2.98 M · PET', '0.25 · 2.5 M · glass',
      '0.5 · ss – Run 1', '0.5 · ss – Run 2',
      '0.25 · 2.1 M · glass (glass-1.txt)', '0.25 · 2.1 M · glass (glass-2.txt)',
      'p/run.txt – Run 1',
    ]);
  });
});

describe('strength vs displacement', () => {
  it('converts force to stress with each run’s own area, and to force per width', async () => {
    const { yFactor } = await import('../src/components/RunGraphControls');
    const { GF_TO_N } = await import('../src/types');
    const gf = 1.25 / GF_TO_N; // 1.25 N
    expect(gf * yFactor('kPa', 250, 10)).toBeCloseTo(5, 10); // 1.25 N / 250 mm² = 5 kPa
    expect(gf * yFactor('MPa', 250, 10)).toBeCloseTo(0.005, 12);
    expect(gf * yFactor('kPa', 500, 20)).toBeCloseTo(2.5, 10); // a run with twice the area
    expect(gf * yFactor('N/m', 1250, 25)).toBeCloseTo(50, 10); // 1.25 N / 25 mm = 50 N/m
    expect(yFactor('N', 0, 0)).toBe(GF_TO_N);
    expect(Number.isNaN(yFactor('kPa', 0, 10))).toBe(true);
    const s = migrateState({ lapShear: { view: { x: 'time', unit: 'kPa' } } as never, peel: { view: { unit: 'psi' } } as never });
    expect(s.lapShear.view).toMatchObject({ x: 'disp', unit: 'kPa' });
    expect(s.peel.view.unit).toBe('gf');
  });
});

describe('curve labels and graph title', () => {
  it('places one label per curve where the curves are apart, without overlaps', async () => {
    const { curveLabelAnnotations } = await import('../src/components/RunGraphControls');
    const x = Array.from({ length: 101 }, (_, i) => i * 0.2); // 0–20 mm
    const s = (id: string, f: (x: number) => number) => ({ id, name: id, color: '#123456', x, y: x.map(f) });
    // Three curves that meet near the start and separate later.
    const a = curveLabelAnnotations([s('glass', (v) => 130 + v), s('ss', (v) => 75 + 0.2 * v), s('PET', () => 15)]);
    expect(a.map((l) => l.text)).toEqual(['<b>PET</b>', '<b>ss</b>', '<b>glass</b>']);
    const xs = new Set(a.map((l) => l.x));
    expect(xs.size).toBe(1);
    expect(a[0].x as number).toBeGreaterThan(5); // not at the crowded start
    // Two touching curves: labels are pushed apart and keep a connector to their curve.
    const b = curveLabelAnnotations([s('one', () => 50), s('two', () => 50.5)]);
    const top = b.find((l) => l.showarrow);
    expect(top).toBeTruthy();
    expect((top!.ay as number) - (top!.y as number)).toBeGreaterThan(0);
    expect(curveLabelAnnotations([])).toEqual([]);
  });

  it('suggests a title from what all runs share', async () => {
    const { commonTitle } = await import('../src/components/RunGraphControls');
    const c = (cr: string, conc: string, sub: string, d = false) => ({ chargeRatio: cr, concentration: conc, concentrationDefault: d, substrate: sub });
    expect(commonTitle([c('0.25', '2.5', 'glass'), c('0.25', '2.5', 'PET'), c('0.25', '2.5', 'ss')])).toBe('0.25 · 2.5 M');
    expect(commonTitle([c('0.25', '2.1', 'glass', true), c('0.5', '2.1', 'Glass', true)])).toBe('glass');
    expect(commonTitle([])).toBe('');
  });

  it('opens older projects with the legend box, no title and no custom names', () => {
    const s = migrateState({ lapShear: { view: { unit: 'kPa' } } as never });
    expect(s.lapShear.view).toMatchObject({ labels: 'legend', title: '', names: {}, unit: 'kPa' });
    const r = remapState(migrateState({ peel: { view: { names: { 'f1#c1': 'glass' } } } as never }), new Map([['f1', 'g1']]));
    expect(r.peel.view.names).toEqual({ 'g1#c1': 'glass' });
  });
});

describe('short on-curve labels', () => {
  it('keeps only what differs between curves', async () => {
    const { shortLabels } = await import('../src/components/RunGraphControls');
    const c = (conc: string, sub: string, n = 1) => ({ label: `0.25 · ${conc} M · ${sub} – Run ${n}`, cycleNumber: n, cond: { chargeRatio: '0.25', concentration: conc, concentrationDefault: false, substrate: sub } });
    expect(shortLabels([c('2.1', 'ss'), c('2.5', 'ss'), c('2.98', 'ss')])).toEqual(['2.1 M', '2.5 M', '2.98 M']);
    expect(shortLabels([c('2.5', 'glass'), c('2.5', 'stainless steel'), c('2.5', 'PET')])).toEqual(['glass', 'stainless steel', 'PET']);
    expect(shortLabels([c('2.5', 'ss', 1), c('2.5', 'ss', 2)])).toEqual(['Run 1', 'Run 2']);
    expect(shortLabels([c('2.5', 'ss', 1), c('2.5', 'SS', 1)])).toEqual(['0.25 · 2.5 M · ss – Run 1', '0.25 · 2.5 M · SS – Run 1']); // not unique: full labels
  });

  it('keeps curve labels away from peak labels', async () => {
    const { curveLabelAnnotations } = await import('../src/components/RunGraphControls');
    const x = Array.from({ length: 101 }, (_, i) => i * 0.6);
    const spike = (v: number) => (Math.abs(v - 55) < 2 ? 500 : 200);
    const a = curveLabelAnnotations([{ id: 'g', name: 'glass', color: '#000', x, y: x.map(spike) }, { id: 'p', name: 'PET', color: '#000', x, y: x.map((v) => spike(v) * 0.5) }], [55, 55]);
    expect(Math.abs((a[0].x as number) - 55)).toBeGreaterThan(4);
  });
});
