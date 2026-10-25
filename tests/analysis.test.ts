import { describe, expect, it } from 'vitest';
import { parseSource } from '../src/parser/loader';
import { scorePoints } from '../src/analysis/pointOutliers';
import { modifiedZScores, median, mad, resolutionStep, sampleSD } from '../src/analysis/stats';
import { displacement, displayFactor, peakLabel } from '../src/analysis/cycleMetrics';
import { defaultProject, defaultSettings } from '../src/state/defaults';
import { GF_TO_N, type QCClass, type RunStatus } from '../src/types';
import { computeGroups, type CycleResult } from '../src/analysis/engine';
import { inferMetadata } from '../src/parser/pathMetadata';
import { axisValues } from '../src/plotting/axes';
import { derive, enc, loadSynthetic, miniFile } from './helpers';

/** A smooth, quantized adhesion curve similar to the real data. */
function curve(peak: number, n = 110, step = 0.5): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / 100;
    const u = (t - 0.2) / 0.22;
    const g = t > 0.2 ? u * u * Math.exp(2 * (1 - u)) : 0;
    out.push(Math.round((1 - peak * g) / step) * step);
  }
  return out;
}

async function load(moves: number[][], path = '0.25/Glass/30s.txt') {
  return parseSource({ path, bytes: enc(miniFile(moves)) });
}

describe('statistics helpers', () => {
  it('computes median, MAD, SD and resolution step', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
    expect(sampleSD([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5);
    expect(resolutionStep([0, 0.5, 1.5, -0.5])).toBe(0.5);
  });

  it('modified Z-scores flag the one weak run among nine', () => {
    const peaks = [-40, -41, -39, -40.5, -39.5, -40, -42, -38.5, -2];
    const { z } = modifiedZScores(peaks);
    expect(Math.abs(z[8])).toBeGreaterThan(10);
    expect(z.slice(0, 8).every((v) => Math.abs(v) < 3.5)).toBe(true);
  });

  it('falls back safely when MAD is zero', () => {
    const r = modifiedZScores([-40, -40, -40, -40, -2]);
    expect(r.method).toBe('meanAD');
    expect(Number.isFinite(r.z[4])).toBe(true);
  });
});

describe('peak extraction and units', () => {
  it('uses the minimum (negative) force as the default peak', async () => {
    const l = await load([curve(40)]);
    const d = derive([l]);
    const r = d.ordered[0];
    expect(r.raw.min).toBeLessThan(-35);
    expect(r.peakRaw).toBe(r.raw.min);
    expect(r.raw.absPeak).toBe(Math.abs(r.raw.min));
    expect(r.raw.tAtMin).toBeGreaterThan(0.3);
    expect(r.raw.n).toBe(110);
  });

  it('supports maximum, absolute and baseline-corrected metrics', async () => {
    const l = await load([curve(40)]);
    const p = defaultProject();
    p.settings.peakMetric = 'max';
    expect(derive([l], p).ordered[0].peakRaw).toBe(1);
    p.settings.peakMetric = 'absmax';
    const abs = derive([l], p).ordered[0];
    expect(abs.peakRaw).toBe(Math.abs(abs.raw.min));
    p.settings.peakMetric = 'baselineMin';
    p.settings.baselineMode = 'holdMean';
    const bl = derive([l], p).ordered[0];
    expect(bl.baseline).toBe(1); // hold force in the mini file is 1 gf
    expect(bl.peakRaw).toBeCloseTo(bl.raw.min - 1, 10);
    p.settings.baselineMode = 'none';
    expect(Number.isNaN(derive([l], p).ordered[0].peakRaw)).toBe(true);
  });

  it('converts gf to N only for display/export, not in the stored values', async () => {
    const l = await load([curve(40)]);
    const p = defaultProject();
    p.settings.forceUnit = 'N';
    const r = derive([l], p).ordered[0];
    const yN = axisValues(r, 'force', p.settings)!;
    expect(yN[50]).toBeCloseTo(-r.cycle.force_gf[50] * GF_TO_N, 12); // default sign: adhesion shown positive
    p.settings.forceSign = 'recorded';
    expect(axisValues(r, 'force', p.settings)![50]).toBeCloseTo(r.cycle.force_gf[50] * GF_TO_N, 12);
    expect(r.raw.min).toBe(derive([l]).ordered[0].raw.min); // results stay in gf internally
    expect(GF_TO_N).toBe(0.00980665);
  });

  it('defines displacement relative to the first z of the movement', () => {
    const z = [10, 9.5, 9, 8];
    expect(Array.from(displacement(z, 'signed'))).toEqual([0, -0.5, -1, -2]);
    expect(Array.from(displacement(z, 'distance'))).toEqual([0, 0.5, 1, 2]);
    expect(Array.from(displacement(z, 'inverted'))).toEqual([-0, 0.5, 1, 2]);
  });
});

describe('Level A point screening', () => {
  it('does not flag a genuine smooth negative peak', () => {
    const s = scorePoints(curve(60), defaultSettings().point);
    expect(s.counts[2] + s.counts[3]).toBe(0);
    expect(s.counts[1]).toBe(0);
  });

  it('flags an isolated recording spike red and explains it with the local median', () => {
    const f = curve(40);
    f[70] += 15;
    const s = scorePoints(f, defaultSettings().point);
    expect(s.cls[70]).toBe(3);
    expect(s.score[70]).toBeGreaterThan(0.8);
    expect(s.counts[3]).toBe(1);
    expect(s.localMedian[70]).toBeLessThan(f[70]);
  });

  it('does not flag a sharp detachment step', () => {
    const f = Array.from({ length: 100 }, (_, i) => (i < 50 ? -40 : 0));
    const s = scorePoints(f, defaultSettings().point);
    expect(s.counts[2] + s.counts[3]).toBe(0);
  });

  it('scores lie between 0 and 1 and respond to adjustable thresholds', () => {
    const f = curve(40);
    f[70] += 4;
    const st = defaultSettings().point;
    const a = scorePoints(f, st);
    for (const v of a.score) expect(v >= 0 && v <= 1).toBe(true);
    const strict = scorePoints(f, { ...st, yellow: 0.05, orange: 0.1, red: 0.2 });
    expect(strict.cls[70]).toBeGreaterThanOrEqual(a.cls[70]);
  });
});

describe('Level B run screening', () => {
  it('flags one weak run among nine without invalidating the others', async () => {
    const moves = [40, 41, 39, 40.5, 39.5, 40, 42, 38.5].map((p) => curve(p));
    moves.push(curve(3));
    const d = derive([await load(moves)]);
    const weak = d.ordered[8];
    expect(weak.qc).toBe('red');
    expect(weak.flags.some((f) => f.code === 'modZ')).toBe(true);
    expect(weak.flags.some((f) => f.code === 'weak')).toBe(true);
    expect(d.ordered.slice(0, 8).every((r) => r.qc === 'green')).toBe(true);
  });

  it('flags a positive-only response as a missing contact', async () => {
    const d = derive([await load([curve(40), Array.from({ length: 110 }, () => 2)])]);
    expect(d.ordered[1].flags.some((f) => f.code === 'positiveOnly')).toBe(true);
    expect(d.ordered[1].qc).toBe('red');
  });

  it('does not compute modified Z for very small groups', async () => {
    const d = derive([await load([curve(40), curve(10)])]);
    expect(d.ordered.every((r) => r.modZ === null)).toBe(true);
    expect(d.ordered[0].flags.some((f) => f.code === 'smallGroup')).toBe(true);
  });

  it('flags an incomplete movement', async () => {
    const l = await load([curve(40)]);
    const c = l.cycles[0];
    // Simulate truncated travel by shortening the arrays.
    c.z_mm = c.z_mm.slice(0, 30);
    c.force_gf = c.force_gf.slice(0, 30);
    c.time_s = c.time_s.slice(0, 30);
    const d = derive([l]);
    expect(d.ordered[0].flags.some((f) => f.code === 'incomplete')).toBe(true);
  });
});

describe('processed data, exclusions and reproducibility', () => {
  it('excludes points by rule and manually, reversibly, without touching raw data', async () => {
    const f = curve(40);
    f[70] += 15;
    const l = await load([f]);
    const before = Array.from(l.cycles[0].force_gf);
    const p = defaultProject();
    const raw = derive([l], p).ordered[0];
    expect(raw.processed.n).toBe(110);

    p.settings.exclusionRule = 'excludeRed';
    const red = derive([l], p).ordered[0];
    expect(red.processed.n).toBe(109);
    expect(red.include[70]).toBe(0);
    expect(red.raw.max).toBe(raw.raw.max); // raw statistics unchanged

    p.settings.exclusionRule = 'keepAll';
    const id = l.cycles[0].cycleId;
    p.excludedPoints = { [id]: { '10': { reason: 'test', at: 'now' } } };
    const manual = derive([l], p).ordered[0];
    expect(manual.processed.n).toBe(109);
    expect(manual.excludedManual).toBe(1);

    p.excludedPoints = {};
    expect(derive([l], p).ordered[0].processed.n).toBe(110); // restored
    expect(Array.from(l.cycles[0].force_gf)).toEqual(before);
  });

  it('removes manually excluded runs from processed statistics only, and restores them', async () => {
    const l = await load([curve(40), curve(42), curve(41), curve(5)]);
    const p = defaultProject();
    p.settings.runExclusion.excludeClasses = []; // isolate the manual decision
    const all = derive([l], p).groups[0];
    expect(all.processed.n).toBe(4);
    p.runOverrides = { [l.cycles[3].cycleId]: { action: 'exclude', reason: 'missed contact', at: 'now' } };
    const ex = derive([l], p).groups[0];
    expect(ex.processed.n).toBe(3);
    expect(ex.processed.mean).toBeLessThan(all.processed.mean);
    expect(ex.raw.n).toBe(4);
    expect(ex.raw.mean).toBe(all.raw.mean);
    p.runOverrides = {};
    expect(derive([l], p).groups[0].processed.n).toBe(4);
  });

  it('never merges different concentrations into one group', async () => {
    const a = await parseSource({ path: '0.25 (2.5M)/Glass/30s.txt', bytes: enc(miniFile([curve(40)])) });
    const b = await parseSource({ path: '0.25/Glass/30s.txt', bytes: enc(miniFile([curve(40)])) });
    const p = defaultProject();
    p.groupBy = ['chargeRatio']; // even if the user groups by charge ratio only
    const g = derive([a, b], p).groups;
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.label.concentrationM).sort()).toEqual(['2.1', '2.5']);
  });

  it('separates run-level and repeat-level statistics', async () => {
    const a = await parseSource({ path: '0.5/Glass/30s.txt', bytes: enc(miniFile([curve(40), curve(42)])) });
    const b = await parseSource({ path: '0.5/Glass/30s-2.txt', bytes: enc(miniFile([curve(50), curve(52), curve(51)])) });
    const g = derive([a, b]).groups[0];
    for (const st of [g.raw, g.processed]) {
      expect(st.n).toBe(5);
      expect(st.nRepeats).toBe(2);
      expect(Number.isFinite(st.repeatSD)).toBe(true);
    }
  });

  it('gives identical results for repeated analyses', async () => {
    const loaded = await loadSynthetic();
    const a = derive(loaded).ordered.map((r) => [r.cycle.cycleId, r.peakRaw, r.cycleScore, r.qc]);
    const b = derive(loaded).ordered.map((r) => [r.cycle.cycleId, r.peakRaw, r.cycleScore, r.qc]);
    expect(a).toEqual(b);
  });
});

describe('synthetic example dataset', () => {
  it('detects the planted problems', async () => {
    const loaded = await loadSynthetic();
    const byName = (p: string) => loaded.find((l) => l.parsed.path.endsWith(p))!;
    expect(byName('0.25 (2.5M)/Glass/1s-2.txt').parsed.status).toBe('error');
    const trunc = byName('1.05/Glass/5s-2.txt').parsed;
    expect(trunc.status).toBe('warning');
    const d = derive(loaded);
    const spike = d.ordered.find((r) => r.file.path.endsWith('0.25 (2.5M)/Glass/1s.txt') && r.cycle.cycleNumber === 3)!;
    expect(spike.points.counts[3]).toBeGreaterThanOrEqual(1);
    const pos = d.ordered.find((r) => r.file.path.endsWith('0.25 (2.5M)/Glass/5s-2.txt') && r.cycle.cycleNumber === 2)!;
    expect(pos.flags.some((f) => f.code === 'positiveOnly')).toBe(true);
    expect(d.ordered.find((r) => r.file.path.includes('0.25 (2.5M)'))!.meta.concentrationM.value).toBe(2.5);
    expect(d.ordered.find((r) => r.file.path.includes('0.50/'))!.meta.concentrationM.source).toBe('default');
  });
});

describe('starting position check', () => {
  it('flags a movement that starts far from the usual start position', async () => {
    const l = await load([curve(40), curve(41), curve(39), curve(40)]);
    l.cycles[2].z_mm = l.cycles[2].z_mm.map((z) => z - 2.3); // lower start, same direction as travel
    l.cycles[3].z_mm = l.cycles[3].z_mm.map((z) => z + 5); // repositioned upward: deliberate
    const r = derive([l]).ordered;
    expect(r[2].flags.some((f) => f.code === 'startOffset')).toBe(true);
    expect(r[3].flags.some((f) => f.code === 'startOffset')).toBe(false);
    expect(r[1].flags.some((f) => f.code === 'startOffset')).toBe(false);
  });
});

describe('repeat-file differences', () => {
  it('reports a large difference between repeats as a note without changing run QC colour', async () => {
    const a = await parseSource({ path: '0.5/Glass/30s.txt', bytes: enc(miniFile([curve(40), curve(41), curve(40)])) });
    const b = await parseSource({ path: '0.5/Glass/30s-2.txt', bytes: enc(miniFile([curve(65), curve(66), curve(64)])) });
    const d = derive([a, b]);
    expect(d.ordered.every((r) => r.flags.some((f) => f.code === 'repeatDiff'))).toBe(true);
    expect(d.ordered.every((r) => r.qc === 'green')).toBe(true);
  });
});

describe('run-level exclusion', () => {
  const weakAmongNine = () => load([...[40, 41, 39, 40.5, 39.5, 40, 42, 38.5].map((p) => curve(p)), curve(3)]);

  it('excludes red and orange runs automatically by default and keeps yellow and green runs', async () => {
    expect(defaultSettings().runExclusion.excludeClasses).toEqual(['red', 'orange']);
    const d = derive([await weakAmongNine()]);
    const red = d.ordered[8];
    expect(red.qc).toBe('red');
    expect(red.status).toBe('excludedAuto');
    expect(red.statusReason).toMatch(/Excluded automatically: QC red/);
    expect(d.ordered.slice(0, 8).every((r) => r.status === 'included')).toBe(true);
    expect(d.groups[0].raw.n).toBe(9);
    expect(d.groups[0].processed.n).toBe(8);
    expect(d.groups[0].includedCycleIds).not.toContain(red.cycle.cycleId);

    const l = await load([curve(40), curve(41), curve(39), curve(40)]);
    l.cycles[2].z_mm = l.cycles[2].z_mm.map((z) => z - 2.3); // start-position flag (orange)
    const orange = derive([l]).ordered[2];
    expect(orange.qc).toBe('orange');
    expect(orange.status).toBe('excludedAuto');

    const f = curve(40);
    f[70] += 15; // isolated spike: yellow run
    const yellow = derive([await load([f])]).ordered[0];
    expect(yellow.qc).toBe('yellow');
    expect(yellow.status).toBe('included');
  });

  it("keeps a red run when it has an 'include' override", async () => {
    const l = await weakAmongNine();
    const p = defaultProject();
    p.runOverrides = { [l.cycles[8].cycleId]: { action: 'include', reason: 'checked: real weak bond', at: 'now' } };
    const d = derive([l], p);
    expect(d.ordered[8].qc).toBe('red');
    expect(d.ordered[8].status).toBe('keptManual');
    expect(d.ordered[8].statusReason).toContain('checked: real weak bond');
    expect(d.groups[0].processed.n).toBe(9);
  });

  it("removes a green run when it has an 'exclude' override", async () => {
    const l = await weakAmongNine();
    const p = defaultProject();
    p.runOverrides = { [l.cycles[0].cycleId]: { action: 'exclude', reason: 'bubble seen', at: 'now' } };
    const d = derive([l], p);
    expect(d.ordered[0].status).toBe('excludedManual');
    expect(d.ordered[0].statusReason).toBe('Excluded manually: bubble seen');
    expect(d.groups[0].raw.n).toBe(9);
    expect(d.groups[0].processed.n).toBe(7); // the green run and the automatically excluded red run
  });

  it('reports raw and processed group statistics side by side (hand-made example)', () => {
    const meta = inferMetadata('0.5/Glass/30s.txt');
    const run = (fileId: string, n: number, peak: number, status: RunStatus) =>
      ({ cycle: { cycleId: `${fileId}#c${n}`, amplitudeMm: -2.5, velocityMmS: 10 }, meta, file: { fileId }, holdTimeS: 30, peakRaw: peak, peakProcessed: peak, status }) as unknown as CycleResult;
    const runs = [
      run('A', 1, -10, 'included'),
      run('A', 2, -12, 'keptManual'),
      run('B', 1, -14, 'included'),
      run('B', 2, -40, 'excludedAuto'),
      run('B', 3, -20, 'excludedManual'),
    ];
    const [g] = computeGroups(runs, ['chargeRatio', 'substrate', 'holdTimeS']);
    expect(g.raw.n).toBe(5);
    expect(g.raw.mean).toBeCloseTo(-19.2, 10);
    expect(g.raw.sd).toBeCloseTo(sampleSD([-10, -12, -14, -40, -20]), 10);
    expect(g.raw.sd).toBeCloseTo(Math.sqrt(596.8 / 4), 10);
    expect(g.raw.median).toBe(-14);
    expect(g.raw.nRepeats).toBe(2);
    expect(g.raw.repeatMean).toBeCloseTo((-11 + -74 / 3) / 2, 10);
    expect(g.processed.n).toBe(3);
    expect(g.processed.mean).toBeCloseTo(-12, 10);
    expect(g.processed.sd).toBeCloseTo(2, 10);
    expect(g.processed.median).toBe(-12);
    expect(g.processed.cv).toBeCloseTo(2 / 12, 10);
    expect(g.processed.nRepeats).toBe(2);
    expect(g.processed.repeatMean).toBeCloseTo((-11 + -14) / 2, 10);
    expect(g.includedCycleIds).toEqual(['A#c1', 'A#c2', 'B#c1']);
    expect(g.label.concentrationM).toBe('2.1'); // concentration is always part of the key
  });

  it('computes identical flags whatever the automatic exclusion setting', async () => {
    const loaded = await loadSynthetic();
    const snapshot = (classes: QCClass[]) => {
      const p = defaultProject();
      p.settings.runExclusion.excludeClasses = classes;
      const d = derive(loaded, p);
      return {
        flags: d.ordered.map((r) => [r.cycle.cycleId, r.qc, r.cycleScore, r.modZ, r.flags.map((f) => `${f.code}:${f.cls}:${f.message}`)]),
        statuses: d.ordered.map((r) => r.status),
      };
    };
    const none = snapshot([]);
    const dflt = snapshot(['red', 'orange']);
    const strict = snapshot(['red', 'orange', 'yellow']);
    expect(dflt.flags).toEqual(none.flags);
    expect(strict.flags).toEqual(none.flags);
    expect(none.statuses.every((s) => s === 'included')).toBe(true);
    expect(dflt.statuses).toContain('excludedAuto');
  });
});

describe('displacement zeroing and force sign', () => {
  it('starts every run at displacement 0 and counts up, whatever stage height it started at', async () => {
    const loaded = await loadSynthetic();
    const d = derive(loaded);
    const s = defaultSettings();
    expect(s.displacementMode).toBe('distance');
    const starts = new Set(d.ordered.map((r) => r.cycle.z_mm[0]));
    expect(starts.size).toBeGreaterThan(1); // runs really start at different absolute z
    for (const r of d.ordered.filter((x) => x.cycle.z_mm.length)) {
      const disp = axisValues(r, 'disp_mm', s)!;
      expect(disp[0]).toBe(0);
      expect(Math.min(...disp)).toBeGreaterThanOrEqual(0);
    }
  });

  it('shows adhesion as positive force by default without changing recorded values or flags', async () => {
    const loaded = await loadSynthetic();
    const p = defaultProject();
    expect(p.settings.forceSign).toBe('positive');
    const pos = derive(loaded, p);
    const r = pos.ordered.find((x) => x.raw.min < -10)!;
    const shown = axisValues(r, 'force', p.settings)!;
    expect(shown[5]).toBeCloseTo(-r.cycle.force_gf[5], 12);
    expect(Math.max(...shown)).toBeCloseTo(-r.raw.min, 12);
    expect(displayFactor(p.settings) * r.peakRaw).toBeGreaterThan(0);
    expect(displayFactor({ forceUnit: 'N', forceSign: 'positive' })).toBeCloseTo(-GF_TO_N, 15);
    expect(peakLabel(p.settings)).toBe('Peak adhesion force');
    const rec = defaultProject();
    rec.settings.forceSign = 'recorded';
    const asRecorded = derive(loaded, rec);
    const snap = (d: typeof pos) => d.ordered.map((x) => [x.peakRaw, x.qc, x.modZ, x.flags.map((f) => f.message)]);
    expect(snap(pos)).toEqual(snap(asRecorded));
  });
});
