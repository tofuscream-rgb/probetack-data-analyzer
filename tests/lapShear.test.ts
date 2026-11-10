import { describe, expect, it } from 'vitest';
import { analyzeLapShear, analyzeLapShearCycle, describe as stats, strengthKPa, workPerAreaJm2, type RunInput } from '../src/analysis/lapShear';
import { parseSource } from '../src/parser/loader';
import { defaultLapShear } from '../src/state/defaults';
import { migrateState, remapState } from '../src/storage/project';
import { GF_TO_N, type LapShearRunMeta, type LapShearSettings } from '../src/types';
import { enc } from './helpers';

const settings = (patch: Partial<LapShearSettings> = {}): LapShearSettings => ({ ...defaultLapShear().settings, ...patch });
const meta = (patch: Partial<LapShearRunMeta> = {}): LapShearRunMeta => ({ lengthMm: 25, widthMm: 10, thicknessMm: 1, failureMode: 'unspecified', manualFailureMm: null, ...patch });

/** Stage pulled in −z at 0.1 mm per sample; the loading force is recorded as negative (as in Mach-1 lap-shear files). */
function run(forceGf: number[], step = 0.1): RunInput {
  return {
    time_s: forceGf.map((_, i) => i * 0.01),
    z_mm: forceGf.map((_, i) => -i * step),
    force_gf: forceGf,
    amplitudeMm: -25,
  };
}

/** Triangle: 0 → peak at sample 10 → 0 at sample 20, recorded negative. */
const triangle = (peak: number) => Array.from({ length: 21 }, (_, i) => -(i <= 10 ? (peak * i) / 10 : (peak * (20 - i)) / 10));

describe('lap shear: geometry, units and strength', () => {
  it('uses 25 × 10 × 1 mm and 250 mm² by default', () => {
    const d = defaultLapShear().settings.defaults;
    expect(d).toEqual({ lengthMm: 25, widthMm: 10, thicknessMm: 1 });
    const r = analyzeLapShear(run(triangle(100)), meta(), settings());
    expect(r.areaMm2).toBe(250);
  });

  it('converts gf to N and computes τ = F / A in kPa and MPa', () => {
    expect(strengthKPa(1.25, 250)).toBeCloseTo(5, 12); // spec example: 1.25 N on 250 mm² = 5 kPa
    const peakGf = 1.25 / GF_TO_N;
    const r = analyzeLapShear(run(triangle(peakGf)), meta(), settings());
    expect(r.loadingSign).toBe(-1); // negative recorded force detected as the loading direction
    expect(r.peak!.forceGf).toBeCloseTo(peakGf, 9);
    expect(r.peak!.forceN).toBeCloseTo(1.25, 12);
    expect(r.strengthKPa).toBeCloseTo(5, 9);
    expect(r.strengthMPa).toBeCloseTo(0.005, 12);
    expect(r.peak!.dispMm).toBeCloseTo(1.0, 12);
    expect(r.peak!.timeS).toBeCloseTo(0.1, 12);
  });

  it('recalculates strength and work per area when the dimensions change, without touching the curve', () => {
    const input = run(triangle(200));
    const before = Array.from(input.force_gf);
    const a = analyzeLapShear(input, meta(), settings());
    const b = analyzeLapShear(input, meta({ widthMm: 20 }), settings());
    expect(b.areaMm2).toBe(500);
    expect(b.strengthKPa).toBeCloseTo(a.strengthKPa / 2, 12);
    expect(b.work.fullPerAreaJm2).toBeCloseTo(a.work.fullPerAreaJm2 / 2, 12);
    expect(b.work.fullMJ).toBe(a.work.fullMJ); // work itself does not depend on area
    expect(b.peak!.forceGf).toBe(a.peak!.forceGf);
    expect(Array.from(input.force_gf)).toEqual(before);
    expect(Array.from(b.series.loadGf)).toEqual(Array.from(a.series.loadGf));
  });

  it('thickness is recorded but does not enter the strength', () => {
    const a = analyzeLapShear(run(triangle(200)), meta({ thicknessMm: 1 }), settings());
    const b = analyzeLapShear(run(triangle(200)), meta({ thicknessMm: 3 }), settings());
    expect(b.strengthKPa).toBe(a.strengthKPa);
    expect(b.dims.thicknessMm).toBe(3);
  });

  it('reports invalid dimensions clearly instead of failing', () => {
    const r = analyzeLapShear(run(triangle(100)), meta({ widthMm: 0 }), settings());
    expect(r.ok).toBe(true);
    expect(Number.isNaN(r.strengthKPa)).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/Overlap width must be a positive number/);
    expect(r.peak!.forceGf).toBeCloseTo(100, 9); // force results are still available
  });
});

describe('lap shear: mechanical work', () => {
  // Triangle with peak P (N) over 2 mm: full work = ½·2·P, half before and half after the peak.
  const P = 1; // N
  const tri = run(triangle(P / GF_TO_N));

  it('integrates the full curve with the trapezoidal rule (N·mm = mJ)', () => {
    const r = analyzeLapShear(tri, meta(), settings());
    expect(r.work.fullMJ).toBeCloseTo(1.0, 10);
    expect(r.work.toPeakMJ).toBeCloseTo(0.5, 10);
    expect(r.work.postPeakMJ).toBeCloseTo(0.5, 10);
    expect(r.work.toPeakMJ + r.work.postPeakMJ).toBeCloseTo(r.work.fullMJ, 12);
    expect(r.work.fullPerAreaJm2).toBeCloseTo(workPerAreaJm2(1.0, 250), 10);
    expect(workPerAreaJm2(10, 250)).toBeCloseTo(40, 12); // spec example
    // Explicit trapezoid sum on an irregular curve
    const f = [0, -10, -30, -25, -5, -1];
    const r2 = analyzeLapShear(run(f, 0.2), meta(), settings());
    let w = 0;
    for (let i = 1; i < f.length; i++) w += ((-f[i - 1] - f[i]) / 2) * GF_TO_N * 0.2;
    expect(r2.work.fullMJ).toBeCloseTo(w, 12);
  });

  it('uses the selected integration mode', () => {
    expect(analyzeLapShear(tri, meta(), settings({ integration: { mode: 'toPeak', fromMm: 0, toMm: 0 } })).work.selectedMJ).toBeCloseTo(0.5, 10);
    expect(analyzeLapShear(tri, meta(), settings({ integration: { mode: 'full', fromMm: 0, toMm: 0 } })).work.selectedMJ).toBeCloseTo(1.0, 10);
  });

  it('interpolates the force at exact custom limits', () => {
    // 0.55 mm to 1.25 mm on the triangle: F(δ) = δ/1mm·P up to 1 mm, then (2−δ)·P.
    const r = analyzeLapShear(tri, meta(), settings({ integration: { mode: 'custom', fromMm: 0.55, toMm: 1.25 } }));
    const exact = ((0.55 + 1) / 2) * 0.45 + ((1 + 0.75) / 2) * 0.25;
    expect(r.work.selectedMJ).toBeCloseTo(exact, 10);
    expect(r.work.selectedFromMm).toBe(0.55);
    expect(r.work.selectedToMm).toBe(1.25);
    expect(r.work.selectedPerAreaJm2).toBeCloseTo((exact * 1000) / 250, 10);
  });

  it('does not let displacement reversals cancel or double-count loading work', () => {
    const f = triangle(P / GF_TO_N);
    const input = run(f);
    // Insert a retraction and re-loading at sample 5: δ 0.5 → 0.4 → 0.5 (same forces).
    const z = Array.from(input.z_mm);
    const t = Array.from(input.time_s);
    const F = Array.from(input.force_gf);
    z.splice(6, 0, z[4], z[5]);
    F.splice(6, 0, F[4], F[5]);
    t.splice(6, 0, 0, 0);
    const time = t.map((_, i) => i * 0.01);
    const r = analyzeLapShear({ time_s: time, z_mm: z, force_gf: F, amplitudeMm: -25 }, meta(), settings());
    expect(r.quality.reversals).toBe(1);
    expect(r.work.fullMJ).toBeCloseTo(1.0, 10); // same as without the reversal
    expect(r.warnings.join(' ')).toMatch(/reversal/);
  });

  it('skips invalid values and does not integrate across gaps or duplicate positions', () => {
    const f = triangle(P / GF_TO_N);
    const input = run(f);
    const F = Array.from(input.force_gf);
    F[15] = NaN; // one bad sample after the peak
    const r = analyzeLapShear({ ...input, force_gf: F }, meta(), settings());
    expect(r.ok).toBe(true);
    expect(r.quality.invalid).toBe(1);
    expect(r.quality.gaps).toBe(1);
    // The two trapezoids around sample 15 (14→15, 15→16) are missing: 0.1 mm × (0.6+0.5)/2 + 0.1 × (0.5+0.4)/2 = 0.1 mJ.
    expect(r.work.fullMJ).toBeCloseTo(0.9, 10);
    const dup = analyzeLapShear({ ...input, z_mm: Array.from(input.z_mm).map((z, i) => (i === 3 ? input.z_mm[2] : z)) }, meta(), settings());
    expect(dup.quality.duplicates).toBe(1);
    expect(Number.isFinite(dup.work.fullMJ)).toBe(true);
    const inf = analyzeLapShear({ ...input, z_mm: Array.from(input.z_mm).map((z, i) => (i === 7 ? Infinity : z)) }, meta(), settings());
    expect(inf.quality.invalid).toBe(1);
  });

  it('reports missing measurements instead of crashing', () => {
    const r = analyzeLapShear({ time_s: [0, 1, 2], z_mm: [], force_gf: [1, 2, 3] }, meta(), settings());
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['Position (z), mm']);
    expect(r.error).toMatch(/Missing measurement/);
  });
});

describe('lap shear: baseline and failure', () => {
  it('corrects a load-cell offset only when the first points look unloaded, and keeps raw data', () => {
    const f = [...Array(30).fill(3), ...triangle(100).map((v) => v + 3)];
    const input = run(f);
    const off = analyzeLapShear(input, meta(), settings());
    expect(off.baseline.applied).toBe(false);
    const on = analyzeLapShear(input, meta(), settings({ baseline: { enabled: true, points: 30, maxSpreadGf: 2 } }));
    expect(on.baseline.applied).toBe(true);
    expect(on.baseline.offsetGf).toBe(3);
    expect(on.peak!.forceGf).toBeCloseTo(100, 9);
    expect(off.peak!.forceGf).toBeCloseTo(97, 9);
    expect(input.force_gf[0]).toBe(3); // raw unchanged
    // A region that is already loading is rejected.
    const loaded = analyzeLapShear(run(triangle(100)), meta(), settings({ baseline: { enabled: true, points: 10, maxSpreadGf: 2 } }));
    expect(loaded.baseline.applied).toBe(false);
    expect(loaded.baseline.note).toMatch(/not applied/);
  });

  it('finds complete failure with the 5% / 20-point rule, or leaves it blank', () => {
    // Peak 100 gf, then 30 samples at 2 gf (2% of peak).
    const f = [...triangle(100).slice(0, 15), ...Array(30).fill(-2)];
    const r = analyzeLapShear(run(f), meta(), settings());
    expect(r.failure.source).toBe('auto');
    expect(r.failure.index).toBe(15);
    expect(r.failure.dispMm).toBeCloseTo(1.5, 10);
    expect(r.work.toFailureMJ!).toBeLessThan(r.work.fullMJ);
    // Friction tail above 5%: no failure point.
    const tail = analyzeLapShear(run([...triangle(100).slice(0, 15), ...Array(30).fill(-20)]), meta(), settings());
    expect(tail.failure.dispMm).toBeNull();
    expect(tail.failure.note).toMatch(/could not be identified/);
    // A manual failure point wins.
    const manual = analyzeLapShear(run(f), meta({ manualFailureMm: 1.2 }), settings());
    expect(manual.failure).toMatchObject({ source: 'manual', dispMm: 1.2 });
  });
});

describe('lap shear: runs, statistics and saved state', () => {
  it('parses every Move Relative block of a file as a separate run', async () => {
    const block = (k: number) => [
      '<INFO>', 'Date:\tTue, Oct 27, 2026', `Time:\t13:5${k}:00.000`, '<END INFO>',
      '<Move Relative>', 'Stage Axis:\tPosition (z)', 'Amplitude, mm:\t-25.0000', 'Velocity, mm/s:\t0.0833', '<DATA>',
      'Time, s\tPosition (z), mm\tPosition (x), mm\tPosition (y), mm\tFz, gf',
      ...Array.from({ length: 50 }, (_, i) => `${(i / 100).toFixed(6)}\t${(-i * 0.01).toExponential(6)}\t-11.0\t12.1\t${(-k * 10 * Math.sin((i / 49) * Math.PI)).toFixed(6)}`),
      '<END DATA>',
    ];
    const text = ['<Mach-1 File>', ...block(1), ...block(2), ...block(3)].join('\r\n') + '\r\n';
    const l = await parseSource({ path: '0.25 2.5M/SS/lapshear.txt', bytes: enc(text) });
    expect(l.cycles).toHaveLength(3);
    const res = l.cycles.map((c) => analyzeLapShearCycle(c, meta(), settings()));
    expect(res.map((r) => Math.round(r.peak!.forceGf))).toEqual([10, 20, 30]);
    expect(res.every((r) => r.loadingSign === -1)).toBe(true);
    expect(l.cycles[1].force_gf.length).toBe(50);
  });

  it('averages per-run values (each with its own area) with the sample SD', () => {
    const a = analyzeLapShear(run(triangle(100)), meta(), settings());
    const b = analyzeLapShear(run(triangle(100)), meta({ widthMm: 20 }), settings());
    const d = stats([a.strengthKPa, b.strengthKPa]);
    expect(d.n).toBe(2);
    expect(d.mean).toBeCloseTo((a.strengthKPa + b.strengthKPa) / 2, 12);
    expect(d.sd).toBeCloseTo(Math.abs(a.strengthKPa - b.strengthKPa) / Math.SQRT2, 12);
    expect(stats([1, NaN]).n).toBe(1);
  });

  it('keeps per-run dimensions and failure modes through save/load and file reconnection', () => {
    const s = migrateState({
      mode: 'lapShear',
      lapShear: { runs: { 'f1#c1': meta({ widthMm: 20, failureMode: 'cohesive' }), 'f1#c3': meta({ failureMode: 'bogus' as never, lengthMm: -1 }) }, selected: ['f1#c1', 'f1#c3'] } as never,
    });
    expect(s.mode).toBe('lapShear');
    expect(s.lapShear.runs['f1#c1']).toMatchObject({ widthMm: 20, failureMode: 'cohesive' });
    expect(s.lapShear.runs['f1#c3']).toMatchObject({ lengthMm: 25, failureMode: 'unspecified' }); // invalid values fall back
    expect(s.lapShear.settings.integration.mode).toBe('full');
    const r = remapState(s, new Map([['f1', 'g7']]));
    expect(Object.keys(r.lapShear.runs).sort()).toEqual(['g7#c1', 'g7#c3']);
    expect(r.lapShear.selected).toEqual(['g7#c1', 'g7#c3']);
    expect(migrateState({}).mode).toBe('tack'); // existing projects open in Probe Tack
  });
});

describe('lap shear: Excel export', () => {
  it('contains every required property, the run data and the settings', async () => {
    const { buildLapShearSheets, buildLapShearWorkbook } = await import('../src/export/lapShearWorkbook');
    const input = run([...Array(30).fill(0), ...triangle(300)]);
    const s = settings({ baseline: { enabled: true, points: 30, maxSpreadGf: 2 } });
    const mk = (id: string, m: LapShearRunMeta) => ({ id, label: `SS.txt – Run ${id}`, filePath: 'gel/SS.txt', condition: 'CR 0.25', ...input, failureMode: m.failureMode, result: analyzeLapShear(input, m, s) });
    const runs = [mk('1', meta({ failureMode: 'cohesive' })), mk('2', meta({ widthMm: 20, failureMode: 'adhesive' }))];
    const sheets = buildLapShearSheets({ projectName: 'P', settings: s, runs, includeRunData: true, includeChart: true });
    expect(sheets.map((x) => x.name)).toEqual(['Lap Shear Summary', 'Lap Shear Chart', 'SS – Run 1', 'SS – Run 2', 'Analysis Settings']);
    const summary = sheets[0].rows;
    const header = summary.find((r) => r[0] === 'Run') as string[];
    for (const h of [
      'Peak force (gf)', 'Peak force (N)', 'Apparent nominal lap-shear strength (kPa)', 'Apparent nominal lap-shear strength (MPa)', 'Displacement at peak (mm)',
      'Time at peak (s)', 'Full-curve work (mJ)', 'Work to peak (mJ)', 'Post-peak work (mJ)', 'Selected integration work (mJ)', 'Selected work per bonded area (J/m²)',
      'Full-curve work per bonded area (J/m²)', 'Overlap length (mm)', 'Overlap width (mm)', 'Gel thickness (mm)', 'Bonded overlap area (mm²)', 'Failure mode',
      'Failure displacement (mm)', 'Valid data points',
    ]) expect(header).toContain(h);
    const row2 = summary[summary.indexOf(header) + 2];
    expect(row2[header.indexOf('Bonded overlap area (mm²)')]).toBe(500);
    expect(row2[header.indexOf('Failure mode')]).toBe('Adhesive / interfacial');
    expect(summary.some((r) => r[0] === 'Apparent nominal lap-shear strength' && r[1] === 'kPa' && r[4] === 2)).toBe(true);
    const runSheet = sheets[2].rows;
    expect(runSheet[0]).toEqual(expect.arrayContaining(['Time (s)', 'Position z, original (mm)', 'Relative displacement |z − z₀| (mm)', 'Fz original signed (gf)', 'Fz baseline-corrected (gf)', 'Peak (1 = peak)', 'In selected integration interval', 'Cumulative loading work (mJ)']));
    expect(runSheet.length).toBe(input.force_gf.length + 1);
    const settingsRows = sheets[4].rows.map((r) => r[0]);
    expect(settingsRows).toEqual(expect.arrayContaining(['Integration mode', 'Custom interval (mm)', 'Baseline correction', 'Failure endpoint', 'Force conversion']));
    expect(buildLapShearWorkbook({ projectName: 'P', settings: s, runs, includeRunData: false, includeChart: true }).length).toBeGreaterThan(1000);
  });
});
