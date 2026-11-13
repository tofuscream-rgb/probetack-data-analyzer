import { describe, expect, it } from 'vitest';
import { analyzePeel } from '../src/analysis/peel';
import { parseSource, guessMode } from '../src/parser/loader';
import { defaultPeel } from '../src/state/defaults';
import { migrateState } from '../src/storage/project';
import { GF_TO_N, type PeelRunMeta, type PeelSettings } from '../src/types';
import { enc, loadSynthetic } from './helpers';

const settings = (patch: Partial<PeelSettings> = {}): PeelSettings => ({ ...defaultPeel().settings, ...patch });
const meta = (patch: Partial<PeelRunMeta> = {}): PeelRunMeta => ({ lengthMm: 60, widthMm: 10, thicknessMm: 1, angleDeg: 90, failureMode: 'unspecified', manualDetachMm: null, ...patch });

/**
 * Synthetic 90° peel recorded at 0.1 mm per sample (pulled in −z, force negative):
 * 0–2 mm ramp to an initiation spike of 3 N, 2–50 mm steady peel at 2 N ± 0.1 N (alternating),
 * a release spike of 4 N at 50.5 mm, then zero force for 5 mm.
 */
function peelRun() {
  const F: number[] = [];
  for (let i = 0; i <= 600; i++) {
    const d = i * 0.1;
    let n: number;
    if (d < 1) n = 3 * d;
    else if (d < 2) n = 3 - (d - 1);
    else if (d < 50) n = 2 + (i % 2 ? 0.1 : -0.1);
    else if (d < 51) n = 4;
    else n = 0;
    F.push(-n / GF_TO_N);
  }
  return { time_s: F.map((_, i) => i * 0.02), z_mm: F.map((_, i) => -i * 0.1), force_gf: F, amplitudeMm: -65 };
}

/** Steady peel without overshoot: ramp to 2 N by 0.5 mm, flat 2 N to 50 mm, then zero. */
function flatPeelRun() {
  const F: number[] = [];
  for (let i = 0; i <= 600; i++) {
    const d = i * 0.1;
    F.push(-(d < 0.5 ? 4 * d : d < 50 ? 2 : 0) / GF_TO_N);
  }
  return { time_s: F.map((_, i) => i * 0.02), z_mm: F.map((_, i) => -i * 0.1), force_gf: F, amplitudeMm: -65 };
}

describe('90° peel initiation metrics', () => {
  it('F_pre,max, its travel, G_pre and the peak/steady ratio for a known overshoot before the window', () => {
    // peelRun(): 3 N spike at 1 mm, window 10.2–40.8 mm (20–80% of 51 mm) on the 2 N ± 0.1 N plateau.
    const r = analyzePeel(peelRun(), meta(), settings());
    expect(r.initiationPeak!.forceN).toBeCloseTo(3, 9);
    expect(r.initiationPeak!.dispMm).toBeCloseTo(1, 9);
    expect(r.initiation.gPreJm2).toBeCloseTo((3 / 10) * 1000, 6); // 3 N / 10 mm = 300 J/m² at 90°
    expect(r.initiation.ratio).toBeCloseTo(3 / r.plateau.meanN, 12);
    expect(r.initiation.ratio).toBeCloseTo(1.5, 2);
    // Width and angle of the run: G_pre = F/w × (1 − cos θ).
    expect(analyzePeel(peelRun(), meta({ widthMm: 20 }), settings()).initiation.gPreJm2).toBeCloseTo(150, 6);
    expect(analyzePeel(peelRun(), meta({ angleDeg: 180 }), settings()).initiation.gPreJm2).toBeCloseTo(600, 6);
  });

  it('uses the window start the user set (custom fromMm), the same start as the steady-state mean', () => {
    const custom = (fromMm: number) => analyzePeel(peelRun(), meta(), settings({ plateau: { mode: 'custom', startFrac: 0.2, endFrac: 0.8, fromMm, toMm: 40 } }));
    const late = custom(20);
    expect(late.initiationPeak!.forceN).toBeCloseTo(3, 9); // the spike is still before 20 mm
    expect(late.initiationPeak!.dispMm).toBeCloseTo(1, 9);
    const early = custom(0.5); // only the ramp 0–0.4 mm lies before the window
    expect(early.initiationPeak!.forceN).toBeCloseTo(1.2, 9);
    expect(early.initiationPeak!.dispMm).toBeCloseTo(0.4, 9);
    expect(early.initiation.ratio).toBeCloseTo(1.2 / early.plateau.meanN, 12);
    // Fraction-based start: 30% of the peeled length.
    const frac = analyzePeel(peelRun(), meta(), settings({ plateau: { mode: 'auto', startFrac: 0.3, endFrac: 0.8, fromMm: 0, toMm: 0 } }));
    expect(frac.window.fromMm).toBeCloseTo(0.3 * 51, 9);
    expect(frac.initiationPeak!.forceN).toBeCloseTo(3, 9);
  });

  it('gives a ratio of about 1 when there is no overshoot', () => {
    const r = analyzePeel(flatPeelRun(), meta(), settings());
    expect(r.plateau.meanN).toBeCloseTo(2, 9);
    expect(r.initiationPeak!.forceN).toBeCloseTo(2, 9);
    expect(r.initiation.ratio).toBeCloseTo(1, 9);
    expect(r.initiation.gPreJm2).toBeCloseTo(r.toughnessJm2, 9); // same force: G_pre = G_peel
  });

  it('leaves the metrics blank when no point lies before the window', () => {
    const r = analyzePeel(peelRun(), meta(), settings({ plateau: { mode: 'custom', startFrac: 0.2, endFrac: 0.8, fromMm: 0, toMm: 40 } }));
    expect(r.initiationPeak).toBeNull();
    expect(r.initiation.gPreJm2).toBeNaN();
    expect(r.initiation.ratio).toBeNaN();
  });
});

describe('90° peel', () => {
  it('reports the plateau force, peel strength and interfacial toughness Γ = F̄/w', () => {
    const r = analyzePeel(peelRun(), meta(), settings());
    expect(r.ok).toBe(true);
    expect(r.curve.loadingSign).toBe(-1);
    expect(r.detach.source).toBe('auto');
    expect(r.detach.dispMm).toBeCloseTo(51, 6);
    expect(r.peeledLengthMm).toBeCloseTo(51, 6);
    // Automatic window 20–80% of 51 mm = 10.2–40.8 mm: entirely inside the 2 N plateau.
    expect(r.window.fromMm).toBeCloseTo(10.2, 6);
    expect(r.window.toMm).toBeCloseTo(40.8, 6);
    expect(r.plateau.meanN).toBeCloseTo(2, 2);
    expect(r.plateau.minN).toBeCloseTo(1.9, 6);
    expect(r.plateau.maxN).toBeCloseTo(2.1, 6);
    expect(r.plateau.cv).toBeCloseTo(0.05, 2);
    expect(r.peelStrengthNmm).toBeCloseTo(0.2, 3); // 2 N / 10 mm
    expect(r.peelStrengthNm).toBeCloseTo(200, 0);
    expect(r.toughnessJm2).toBeCloseTo(r.peelStrengthNm, 9); // (1 − cos 90°) = 1
    expect(r.peak!.forceN).toBeCloseTo(4, 6);
    expect(r.peak!.perWidthNm).toBeCloseTo(400, 4);
    expect(r.initiationPeak!.forceN).toBeCloseTo(3, 6);
    expect(r.initiationPeak!.dispMm).toBeCloseTo(1, 6);
    expect(r.peelRateMmS).toBeCloseTo(5, 6); // 0.1 mm per 0.02 s
  });

  it('gives a work per peeled area close to Γ for a steady peel', () => {
    const r = analyzePeel(peelRun(), meta(), settings());
    // Exact area: ramp 1.5 + 2.5 (triangle) ... compute with trapezoids independently of the code under test.
    const run = peelRun();
    let w = 0;
    for (let i = 1; i <= 510; i++) w += ((-run.force_gf[i - 1] - run.force_gf[i]) / 2) * GF_TO_N * 0.1;
    expect(r.work.toDetachMJ!).toBeCloseTo(w, 6);
    expect(r.work.perPeeledAreaJm2).toBeCloseTo((w / (10 * 51)) * 1000, 6);
    expect(Math.abs(r.work.perPeeledAreaJm2 - r.toughnessJm2) / r.toughnessJm2).toBeLessThan(0.05);
  });

  it('uses each run’s own width and angle, and a custom window', () => {
    const a = analyzePeel(peelRun(), meta(), settings());
    const b = analyzePeel(peelRun(), meta({ widthMm: 20 }), settings());
    expect(b.peelStrengthNm).toBeCloseTo(a.peelStrengthNm / 2, 9);
    expect(b.plateau.meanN).toBe(a.plateau.meanN);
    const c = analyzePeel(peelRun(), meta({ angleDeg: 180 }), settings());
    expect(c.toughnessJm2).toBeCloseTo(2 * a.peelStrengthNm, 6); // Γ = 2F/w at 180°
    const custom = analyzePeel(peelRun(), meta(), settings({ plateau: { mode: 'custom', startFrac: 0, endFrac: 1, fromMm: 0.5, toMm: 1.5 } }));
    expect(custom.window).toMatchObject({ fromMm: 0.5, toMm: 1.5, source: 'custom' });
    expect(custom.plateau.meanN).toBeGreaterThan(2); // the initiation spike region
  });

  it('uses the end of the recording when no detachment is found, and a typed detachment wins', () => {
    const run = peelRun();
    const tail = { ...run, force_gf: run.force_gf.map((f, i) => (i > 510 ? -1 / GF_TO_N : f)) }; // friction tail at 1 N (25% of peak)
    const r = analyzePeel(tail, meta(), settings());
    expect(r.detach.dispMm).toBeNull();
    expect(r.peeledLengthMm).toBeCloseTo(60, 6);
    expect(r.window.note).toMatch(/end of recording/);
    const m = analyzePeel(tail, meta({ manualDetachMm: 50 }), settings());
    expect(m.detach).toMatchObject({ source: 'manual', dispMm: 50 });
    expect(m.peeledLengthMm).toBe(50);
  });

  it('rejects bad dimensions with a message instead of failing', () => {
    const r = analyzePeel(peelRun(), meta({ widthMm: -1, angleDeg: 0 }), settings());
    expect(r.ok).toBe(true);
    expect(Number.isNaN(r.peelStrengthNm)).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/Gel width must be a positive number/);
    expect(r.warnings.join(' ')).toMatch(/Peel angle/);
  });

  it('parses a Mach-1 Script section as one peel run, with its velocity and distance', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => `${(i / 100).toFixed(6)}\t${(-i * 0.05).toExponential(6)}\t${(17 - i * 0.05).toFixed(6)}\t0\t${(i < 10 ? 0 : -200 - (i % 3)).toFixed(6)}`);
    const text = ['<Mach-1 File>', '<INFO>', 'Date:\tThu, Oct 29, 2026', '<END INFO>', '<Scripts>', 'Script 1', '1AC100;1AG100;2AC100;2AG100;', '1VA5;2VA5;', '1PR-65;2PR-65;', '<DATA>',
      'Time, s\tPosition (z), mm\tPosition (x), mm\tPosition (y), mm\tFz, gf', ...rows, '<END DATA>'].join('\r\n') + '\r\n';
    const l = await parseSource({ path: 'peel/glass.txt', bytes: enc(text) });
    expect(l.parsed.status).toBe('ok');
    expect(l.cycles).toHaveLength(1);
    expect(l.cycles[0].velocityMmS).toBe(5);
    expect(l.cycles[0].amplitudeMm).toBe(-65);
    expect(guessMode(l)).toBe('peel');
    const r = analyzePeel(l.cycles[0], meta(), settings());
    expect(r.ok).toBe(true);
    expect(r.peak!.forceGf).toBeCloseTo(202, 6);
  });

  it('sorts files from older sessions into their test by content', async () => {
    const tack = await loadSynthetic();
    expect(guessMode(tack.find((l) => l.cycles.length)!)).toBe('tack');
    const lap = await parseSource({ path: 'SS.txt', bytes: enc(['<Mach-1 File>', '<Move Relative>', 'Amplitude, mm:\t-25', '<DATA>', 'Time, s\tPosition (z), mm\tFz, gf', '0\t0\t0', '0.01\t-0.1\t-5', '0.02\t-0.2\t-9', '<END DATA>'].join('\r\n')) });
    expect(guessMode(lap)).toBe('lapShear');
  });

  it('opens older projects with empty 90° peel state and keeps saved peel dimensions', () => {
    expect(migrateState({}).peel.settings.defaults).toEqual({ lengthMm: 60, widthMm: 10, thicknessMm: 1, angleDeg: 90 });
    const s = migrateState({ mode: 'peel', peel: { runs: { 'f#c1': meta({ widthMm: 12, failureMode: 'cohesive' }) } } as never });
    expect(s.mode).toBe('peel');
    expect(s.peel.runs['f#c1']).toMatchObject({ widthMm: 12, failureMode: 'cohesive', angleDeg: 90 });
  });
});
