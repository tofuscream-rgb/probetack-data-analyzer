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

  it('distinguishes repeat files from cycles', () => {
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
});
