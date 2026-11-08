import { describe, expect, it } from 'vitest';
import { applyOverride, findChargeRatio, findConcentration, findHoldTime, inferMetadata, splitRepeat } from '../src/parser/pathMetadata';

describe('folder and file name metadata', () => {
  it('reads charge ratio, substrate, hold time and repeat from a typical path', () => {
    const m = inferMetadata('Hydrogel Experiments/0.25/Glass/60s-2.txt');
    expect(m.chargeRatio.value).toBe(0.25);
    expect(m.substrate.value).toBe('Glass');
    expect(m.nominalHoldS.value).toBe(60);
    expect(m.repeat.value).toBe(2);
    expect(m.baseName).toBe('60s');
  });

  it('defaults concentration to 2.1 M and labels it as a default', () => {
    const m = inferMetadata('0.50/Glass/30s.txt');
    expect(m.concentrationM.value).toBe(2.1);
    expect(m.concentrationM.source).toBe('default');
    expect(m.notes.join(' ')).toMatch(/default 2.1 M/);
  });

  it('uses an explicit concentration in a folder name instead of the default', () => {
    expect(inferMetadata('0.25 (2.5M)/Glass/1s.txt').concentrationM).toEqual({ value: 2.5, source: 'path' });
    expect(inferMetadata('2.5 M/0.25/Glass/1s.txt').concentrationM.value).toBe(2.5);
    expect(inferMetadata('0.25 (2.5M)/Glass/1s.txt').chargeRatio.value).toBe(0.25);
  });

  it('lets a user correction override inferred values and records the source', () => {
    const m = applyOverride(inferMetadata('0.25/Glass/1s.txt'), { concentrationM: 2.5 });
    expect(m.concentrationM).toEqual({ value: 2.5, source: 'user' });
    expect(m.chargeRatio.value).toBe(0.25);
  });

  it('distinguishes repeats from runs', () => {
    expect(splitRepeat('60s')).toEqual({ base: '60s', repeat: 1, explicit: false });
    expect(splitRepeat('60s-2')).toEqual({ base: '60s', repeat: 2, explicit: true });
    expect(splitRepeat('60s-3')).toEqual({ base: '60s', repeat: 3, explicit: true });
    expect(splitRepeat('1s_2')).toEqual({ base: '1s', repeat: 2, explicit: true });
  });

  it('parses various charge ratio, hold and concentration spellings', () => {
    expect(findChargeRatio('1.05')).toBe(1.05);
    expect(findChargeRatio('CR 0.75')).toBe(0.75);
    expect(findChargeRatio('Charge ratio 0.5')).toBe(0.5);
    expect(findChargeRatio('Glass')).toBeNull();
    expect(findHoldTime('2min')).toBe(120);
    expect(findHoldTime('500ms')).toBe(0.5);
    expect(findHoldTime('sample')).toBeNull();
    expect(findConcentration('2.5 mol/L')).toBe(2.5);
    expect(findConcentration('2.5mm')).toBeNull();
  });

  it('copes with files that have no folder structure', () => {
    const m = inferMetadata('30s.txt');
    expect(m.chargeRatio.value).toBeNull();
    expect(m.substrate.value).toBeNull();
    expect(m.nominalHoldS.value).toBe(30);
  });

  it('recognizes gel folders and assumes the substrate from folder position when no keyword matches', () => {
    const m = inferMetadata('0.75/Gel B/Mica/10s.txt');
    expect(m.gel.value).toBe('Gel B');
    expect(m.substrate.value).toBe('Mica');
    expect(m.notes.join(' ')).toMatch(/assumed from folder position/);
  });

  it('reads both folder orders: gel then substrate, and substrate then gel', () => {
    const gelFirst = inferMetadata('probe tack October/0.25 2.5M/glass/1s.txt');
    expect([gelFirst.chargeRatio.value, gelFirst.concentrationM.value, gelFirst.substrate.value]).toEqual([0.25, 2.5, 'glass']);
    const subFirst = inferMetadata('after conference/stainless steel/0.75/30s-2.txt');
    expect([subFirst.chargeRatio.value, subFirst.concentrationM.value, subFirst.substrate.value, subFirst.nominalHoldS.value, subFirst.repeat.value]).toEqual([0.75, 2.1, 'stainless steel', 30, 2]);
    expect(subFirst.concentrationM.source).toBe('default'); // no concentration in the old folder names
    expect(inferMetadata('after conference/SS/1.05 2.5M/1s.txt').substrate.value).toBe('SS');
    // A substrate name that is not a known word, in either order:
    expect(inferMetadata('after conference/Nitrile/0.75/1s.txt').substrate.value).toBe('Nitrile');
    expect(inferMetadata('probe tack October/0.25 2.5M/Nitrile/1s.txt').substrate.value).toBe('Nitrile');
    // A letter before the charge ratio ("f1.05"), as in some older folders.
    const f = inferMetadata('After conference/ss/f1.05/1s_new.txt');
    expect([f.chargeRatio.value, f.substrate.value, f.nominalHoldS.value]).toEqual([1.05, 'ss', 1]);
    expect(inferMetadata('After conference/glass/F0.25 2.5M/30s.txt').chargeRatio.value).toBe(0.25);
    expect(inferMetadata('data/v2/glass/1s.txt').chargeRatio.value).toBeNull(); // a version number is not a charge ratio
    // Other ways the gel folder may be written, in either folder order:
    const cr = (g: string) => [inferMetadata(`After conference/ss/${g}/1s.txt`).chargeRatio.value, inferMetadata(`Oct/${g}/ss/1s.txt`).chargeRatio.value];
    for (const [g, v] of [['f0.25', 0.25], ['F0.5', 0.5], ['f 0.75', 0.75], ['f_1.05', 1.05], ['f1', 1], ['f1.05 new', 1.05], ['f1.05_2ndGel', 1.05], ['gel 1.05', 1.05], ['Gel0.25', 0.25], ['1.05f', 1.05], ['0.25 gel', 0.25], ['f0.25(2.5M)', 0.25]] as const) {
      expect(cr(g)).toEqual([v, v]);
    }
    for (const g of ['0.5mm', '1.5s', '0.5 N', 'v2']) expect(cr(g)).toEqual([null, null]); // units and versions are not charge ratios
    // "f=" and other labelled forms, decimal commas, in folders or in the file name.
    for (const g of ['f= 0.5', 'f=0.5', 'f = 0.5', 'F=0.5', 'f: 0.5', 'f=.5', 'f=0,5', 'f0,5', '0,5', 'f=0.5 (2.5M)', 'f=0.5, 2.5M', 'gel f=0.5', 'CR=0.5', 'cr0.5', 'charge ratio=0.5', 'ratio_0.5', 'f=0.5_glass']) {
      expect(cr(g)).toEqual([0.5, 0.5]);
    }
    expect(cr('f = 1')).toEqual([1, 1]);
    expect(inferMetadata('x/f=0.5 2,5M/glass/1s.txt').concentrationM.value).toBe(2.5);
    const file = inferMetadata('peel Oct/f= 0.5 glass.txt');
    expect([file.chargeRatio.value, file.chargeRatio.source, file.substrate.value]).toEqual([0.5, 'filename', 'glass']);
    expect(inferMetadata('peel Oct/glass f=0.5-2.txt').repeat.value).toBe(2);
    for (const f of ['1s', '60s-2', 'trial 70n', 'PET-2', 'glass']) expect(inferMetadata(`peel Oct/glass/${f}.txt`).chargeRatio.value).toBeNull(); // file names without a label
    expect(inferMetadata('x/Gel 2/glass/1s.txt').chargeRatio.value).toBeNull(); // gel number, not a charge ratio
    // The folder picked for import is not taken as a substrate.
    expect(inferMetadata('probe tack October/0.75/1s.txt').substrate.value).toBeNull();
  });
});

describe('lap-shear and peel folder layouts', () => {
  it('reads "0.25 2.98M 90" (with a trailing peel angle) and a substrate named in the file', () => {
    const m = inferMetadata('peel 2026 Oct/0.25 2.98M 90/glass.txt');
    expect(m.chargeRatio.value).toBe(0.25);
    expect(m.concentrationM.value).toBe(2.98);
    expect(m.substrate).toEqual({ value: 'glass', source: 'filename' });
    expect(inferMetadata('peel 2026 Oct/0.25 2.5M/PET.txt').substrate.value).toBe('PET');
    expect(inferMetadata('x/0.25 2.98M 90/SS-reused gel.txt').substrate.value).toBe('SS-reused gel');
    expect(inferMetadata('0.5/PET-2.txt')).toMatchObject({ chargeRatio: { value: 0.5 }, substrate: { value: 'PET' }, repeat: { value: 2 } });
  });

  it('keeps reading the probe-tack layouts as before', () => {
    expect(inferMetadata('Hydrogel Experiments/0.25/Glass/60s-2.txt')).toMatchObject({ chargeRatio: { value: 0.25 }, substrate: { value: 'Glass', source: 'path' }, nominalHoldS: { value: 60 } });
    expect(inferMetadata('0.25 (2.5M)/Glass/30s.txt')).toMatchObject({ chargeRatio: { value: 0.25 }, concentrationM: { value: 2.5 } });
    expect(inferMetadata('2026 Oct/60s.txt').chargeRatio.value).toBeNull(); // a date is not a charge ratio
    expect(inferMetadata('Gels 2026/60s.txt').chargeRatio.value).toBeNull();
  });
});
