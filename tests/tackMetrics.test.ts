import { describe, expect, it } from 'vitest';
import { analyzeTack, meanSd } from '../src/analysis/tackMetrics';
import { bySubstrate, canonicalSubstrate } from '../src/analysis/substrates';
import { GF_TO_N } from '../src/types';

/** A pull curve given as tensile force in N against distance travelled; recorded as Fz in gf (pulling negative). */
function run(points: [number, number][], hold: number[] | null = null) {
  return {
    z_mm: points.map(([d]) => 10 - d), // stage moving down: distance travelled = 10 − z
    force_gf: points.map(([, tN]) => -tN / GF_TO_N),
    holdForce_gf: hold,
  };
}
const D = 5.5;
const A = (Math.PI * D * D) / 4;

/** Compressive start, linear loading to 2 N at δ = 1 mm, linear unloading to 0 by δ = 1.5 mm, then zero. */
function triangle(step = 0.001) {
  const pts: [number, number][] = [];
  for (let x = 0; x <= 3 + 1e-9; x += step) {
    const delta = x - 0.5; // onset at distance 0.5 mm
    const tN = delta < 0 ? 4 * delta : delta <= 1 ? 2 * delta : delta <= 1.5 ? 2 - 4 * (delta - 1) : 0;
    pts.push([x, tN]);
  }
  return pts;
}

describe('probe-tack metrics', () => {
  it('peak, stress, work, displacements and strains of a known curve', () => {
    const m = analyzeTack(run(triangle()), { diameterMm: D, h0Mm: 2 });
    expect(m.ok).toBe(true);
    expect(m.areaMm2).toBeCloseTo(A, 12);
    expect(m.fmaxN).toBeCloseTo(2, 6);
    expect(m.sigmaMaxKPa).toBeCloseTo((2 / A) * 1000, 3);
    expect(m.deltaPeakMm).toBeCloseTo(1, 6);
    // T falls to 2% of 2 N = 0.04 N at δ = 1 + (2 − 0.04)/4 = 1.49 mm
    expect(m.deltaMaxMm).toBeCloseTo(1.49, 4);
    // ∫ T dδ from 0 to 1.49 = triangle 1.5 × 2 / 2 − small tail (0.01 × 0.04 / 2) = 1.4998 N·mm
    expect(m.wJm2).toBeCloseTo((1.4998 / A) * 1000, 2);
    expect(m.epsMax).toBeCloseTo(1.49 / 2, 4);
    expect(m.epsPeak).toBeCloseTo(1 / 2, 6);
    expect(m.plateau).toBeNull(); // no plateau longer than 0.3 mm
    expect(m.incomplete).toBe(false);
  });

  it('skips the strains without h₀, and needs a probe diameter', () => {
    const m = analyzeTack(run(triangle()), { diameterMm: D, h0Mm: null });
    expect(m.epsMax).toBeNull();
    expect(m.epsPeak).toBeNull();
    expect(m.fmaxN).toBeCloseTo(2, 6); // the other results do not need h₀
    expect(analyzeTack(run(triangle()), { diameterMm: 0, h0Mm: 1 }).ok).toBe(false);
  });

  it('measures a plateau longer than 0.3 mm', () => {
    const pts: [number, number][] = [];
    for (let x = 0; x <= 4; x += 0.001) {
      // peak 2 N at 0.5 mm, drop to a 0.9–1.1 N plateau from 0.6 to 2.0 mm, then release
      const tN = x <= 0.5 ? 4 * x : x <= 0.6 ? 2 - 10 * (x - 0.5) : x <= 2 ? 1 + 0.1 * Math.sin(20 * x) : x <= 2.2 ? 1 - 5 * (x - 2) : 0;
      pts.push([x, tN]);
    }
    const m = analyzeTack(run(pts), { diameterMm: D, h0Mm: null });
    expect(m.plateau!.lengthMm).toBeGreaterThan(1.3);
    expect(m.plateau!.stressKPa).toBeCloseTo((1 / A) * 1000, -1);
  });

  it('flags a pull that ended before the force returned to ~0', () => {
    const pts = triangle().filter(([x]) => x < 1.7); // stops while T is still ~0.8 N
    const m = analyzeTack(run(pts), { diameterMm: D, h0Mm: 1 });
    expect(m.incomplete).toBe(true);
    expect(m.notes.join(' ')).toMatch(/Detachment incomplete – W underestimated/);
  });

  it('dwell: force at the start and end of the Wait and % relaxation', () => {
    const m = analyzeTack(run(triangle(), [100, 90, 80, 75]), { diameterMm: D, h0Mm: null });
    expect(m.dwell!.startN).toBeCloseTo(100 * GF_TO_N, 10);
    expect(m.dwell!.endN).toBeCloseTo(75 * GF_TO_N, 10);
    expect(m.dwell!.relaxPct).toBeCloseTo(25, 10);
  });

  it('gives the same results for a file recorded in N (converted to gf on reading)', () => {
    const gf = run(triangle());
    const fromN = { ...gf, force_gf: gf.force_gf.map((v) => (v * GF_TO_N) / GF_TO_N) };
    const a = analyzeTack(gf, { diameterMm: D, h0Mm: 2 });
    const b = analyzeTack(fromN, { diameterMm: D, h0Mm: 2 });
    expect(b.wJm2).toBeCloseTo(a.wJm2, 9);
    expect(b.fmaxN).toBeCloseTo(a.fmaxN, 12);
  });

  it('mean ± SD and substrate order PET, stainless steel, glass', () => {
    expect(meanSd([1, 2, 3, null])).toEqual({ mean: 2, sd: 1, n: 3 });
    expect(['glass', 'Other', 'SS', 'PET', 'abc'].sort(bySubstrate)).toEqual(['PET', 'SS', 'glass', 'abc', 'Other']);
    expect(canonicalSubstrate('Stainless steel')).toBe('stainless steel');
    expect(canonicalSubstrate('ss')).toBe('stainless steel');
    expect(canonicalSubstrate('PTFE')).toBeNull();
  });
});

describe('tack metrics project state', () => {
  it('nothing is excluded by default, and older projects load with empty exclusions', async () => {
    const { migrateState } = await import('../src/storage/project');
    const { defaultProject } = await import('../src/state/defaults');
    expect(defaultProject().tackMetrics).toEqual({ h0: {}, excludedRepeats: {}, excludedSessions: {}, excludedRuns: {}, observations: {} });
    expect(migrateState({}).tackMetrics).toEqual({ h0: {}, excludedRepeats: {}, excludedSessions: {}, excludedRuns: {}, observations: {} });
    const s = migrateState({ tackMetrics: { h0: { f1: 2, f2: -1 }, excludedRuns: { 'f1#c1': { reason: 'bubble', at: 'x' } } } as never });
    expect(s.tackMetrics.h0).toEqual({ f1: 2 });
    expect(s.tackMetrics.excludedRuns['f1#c1'].reason).toBe('bubble');
  });
});

describe('tack flags and failure modes', () => {
  it('short flags with details; flags never exclude a run', async () => {
    const { tackFlags } = await import('../src/state/tackMetrics');
    const pts = triangle().filter(([x]) => x < 1.7); // ends before detachment
    const coarse = run(pts);
    coarse.force_gf = coarse.force_gf.map((v) => Math.round(v / 50) * 50); // ~0.49 N steps: F_max ≈ 4 steps
    const m = analyzeTack({ ...coarse, zeroedGf: 1.25 }, { diameterMm: D, h0Mm: null });
    const f = tackFlags(m);
    expect(f.map((x) => x.label)).toEqual(['Low force resolution', 'Incomplete detachment', 'Load tared after dwell']);
    expect(f[0].detail).toMatch(/^F_max = [\d.]+ force steps of [\d.]+ N; plateau and relaxation may be approximate\.$/);
    expect(f[1].detail).toMatch(/W_adh is a lower bound and true failure displacement\/strain are left blank/);
    expect(f[2].detail).toMatch(/pull force is referenced to the new zero/);
    expect(tackFlags(analyzeTack(run(triangle()), { diameterMm: D, h0Mm: 2 }))).toEqual([]);
  });

  it('counts failure loci and debonding morphologies separately', async () => {
    const { failureModeCounts, morphologyCounts, EMPTY_OBSERVATION } = await import('../src/state/tackMetrics');
    const r = (locus: string, morphology: string) => ({ obs: { ...EMPTY_OBSERVATION, locus, morphology } }) as never;
    const runs = [r('cohesive', 'fibrillation'), r('unspecified', 'none'), r('cohesive', 'cavitation+fibrillation'), r('adhesive', 'unspecified')];
    expect(failureModeCounts(runs)).toBe('Cohesive 2 · Adhesive / interfacial 1 · not set 1');
    expect(morphologyCounts(runs)).toBe('Fibrillation 1 · None 1 · Cavitation + fibrillation 1 · not set 1');
  });

  it('keeps observations in saved projects', async () => {
    const { migrateState } = await import('../src/storage/project');
    const s = migrateState({ tackMetrics: { observations: { 'f#c1': { mode: 'fibrillation', note: 'long fibrils', fibrilOnsetMm: 0.4, fibrilMaxMm: -1 }, 'f#c2': { mode: 'bogus' } } } as never });
    // A single legacy failure mode is split into failure locus and debonding morphology.
    expect(s.tackMetrics.observations['f#c1']).toEqual({ locus: 'unspecified', morphology: 'fibrillation', note: 'long fibrils', fibrilOnsetMm: 0.4, fibrilMaxMm: null });
    expect(s.tackMetrics.observations['f#c2']).toMatchObject({ locus: 'unspecified', morphology: 'unspecified' });
    const legacy = migrateState({ tackMetrics: { observations: { a: { mode: 'interfacial' }, b: { mode: 'cohesive' } } } as never }).tackMetrics.observations;
    expect([legacy.a.locus, legacy.b.locus]).toEqual(['adhesive', 'cohesive']);
  });
});
