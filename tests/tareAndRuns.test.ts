import { describe, expect, it } from 'vitest';
import { analyzePeel } from '../src/analysis/peel';
import { parseSource } from '../src/parser/loader';
import { defaultPeel, defaultProject } from '../src/state/defaults';
import { planImport } from '../src/state/duplicates';
import { MODE_LABEL } from '../src/state/AppContext';
import { loadProjectZip, migrateState, saveProjectZip } from '../src/storage/project';
import { GF_TO_N, type PeelRunMeta, type PeelSettings } from '../src/types';
import { enc } from './helpers';

const settings = (patch: Partial<PeelSettings> = {}): PeelSettings => ({ ...defaultPeel().settings, ...patch });
const meta = (patch: Partial<PeelRunMeta> = {}): PeelRunMeta => ({ lengthMm: 60, widthMm: 10, thicknessMm: 1, angleDeg: 90, failureMode: 'unspecified', manualDetachMm: null, ...patch });

/**
 * Synthetic 90° peel at 0.1 mm per sample, pulled in −z (tensile force recorded negative):
 * ramp to a flat 200 gf plateau up to 50 mm, release to 0 by 51 mm, then the stage keeps moving.
 * A constant tare offset adds `offsetGf` (tensile) to the whole trace, so after detachment the
 * reading settles at +offsetGf instead of 0.
 */
function peelRun(offsetGf: number, endMm = 60) {
  const F: number[] = [];
  for (let i = 0; i <= endMm * 10; i++) {
    const d = i * 0.1;
    const t = d < 2 ? 100 * d : d < 50 ? 200 : d < 51 ? 200 * (51 - d) : 0;
    F.push(-(t + offsetGf));
  }
  return { time_s: F.map((_, i) => i * 0.02), z_mm: F.map((_, i) => -i * 0.1), force_gf: F, amplitudeMm: -65 };
}

describe('90° peel: post-detachment tare check', () => {
  it('flags a constant +20 gf offset, corrects G_peel by 20 gf × g / w, and undo restores it', () => {
    const raw = analyzePeel(peelRun(20), meta(), settings());
    const t = raw.tare!;
    expect(t.status).toBe('flagged');
    expect(t.reason).toBe('Possible tare offset');
    expect(t.residualGf).toBeCloseTo(20, 6);
    expect(Math.abs(t.driftGf)).toBeLessThan(1e-9);
    expect(t.residualJm2).toBeCloseTo(((20 * GF_TO_N) / 10) * 1000, 6); // 19.6133 J/m²
    expect(t.residualPctPlateau).toBeCloseTo((20 / 220) * 100, 6);
    expect(t.valid).toBe(true);
    expect(t.applied).toBe(false);
    // The offset keeps the force above the usual detachment threshold; the window starts where it settles.
    expect(t.detachFrom).toBe('settled');
    expect(t.windowFromMm).toBeGreaterThan(51);
    expect(t.windowToMm).toBeCloseTo(60, 6);

    const on = { applied: true, residualGf: t.residualGf, driftGf: t.driftGf, preTareGf: t.preTareGf, windowFromMm: t.windowFromMm, windowToMm: t.windowToMm };
    const corrected = analyzePeel(peelRun(20), meta({ tareCorrection: on }), settings());
    expect(corrected.tare!.applied).toBe(true);
    expect(corrected.plateau.meanGf).toBeCloseTo(200, 6);
    expect(raw.toughnessJm2 - corrected.toughnessJm2).toBeCloseTo(((20 * GF_TO_N) / 10) * 1000, 6); // G_corrected = G_raw − r·g/w
    // After the correction the trace returns to 0, so the usual detachment is found.
    expect(corrected.detach.dispMm).not.toBeNull();
    // The same as a trace without the offset.
    expect(corrected.toughnessJm2).toBeCloseTo(analyzePeel(peelRun(0), meta(), settings()).toughnessJm2, 6);

    const undone = analyzePeel(peelRun(20), meta({ tareCorrection: { ...on, applied: false } }), settings());
    expect(undone.toughnessJm2).toBe(raw.toughnessJm2);
    expect(undone.tare!.applied).toBe(false);
  });

  it('a run that returns to zero is not flagged, and the check can be switched off', () => {
    expect(analyzePeel(peelRun(0), meta(), settings()).tare!.status).toBe('ok');
    expect(analyzePeel(peelRun(20), meta(), settings({ tareCheck: { ...defaultPeel().settings.tareCheck, enabled: false } })).tare).toBeNull();
  });

  it('cannot check a run whose stage stops 0.5 mm after detachment, and cannot correct it', () => {
    const r = analyzePeel(peelRun(20, 51.5), meta(), settings());
    expect(r.tare!.status).toBe('cannotCheck');
    expect(r.tare!.reason).toBe('Cannot check: stage stopped at detachment.');
    expect(r.tare!.valid).toBe(false);
    const tried = analyzePeel(peelRun(20, 51.5), meta({ tareCorrection: { applied: true, residualGf: 20, driftGf: 0, preTareGf: null, windowFromMm: 52, windowToMm: 51.5 } }), settings());
    expect(tried.tare!.applied).toBe(false);
    expect(tried.toughnessJm2).toBe(r.toughnessJm2);
  });

  it('marks a force still drifting after detachment as "Cannot check"', () => {
    const run = peelRun(0);
    const f = run.force_gf.map((v, i) => (i * 0.1 > 51 ? v - (i * 0.1 - 51) * 2 : v)); // +2 gf per mm after detachment
    expect(analyzePeel({ ...run, force_gf: f }, meta(), settings()).tare!.reason).toBe('Cannot check: force still drifting.');
  });

  it('compares the residual with minus the force tared out at Zero load', () => {
    // Expected residual (tensile sign) = −sign × preTare; pulling is recorded negative (sign = −1), so expected = preTare.
    const r = analyzePeel({ ...peelRun(20), preTareGf: -20 }, meta(), settings());
    expect(r.tare!.expectedGf).toBeCloseTo(-20, 9);
    expect(r.tare!.mismatch).toBe(true);
    const ok = analyzePeel({ ...peelRun(20), preTareGf: 20 }, meta(), settings());
    expect(ok.tare!.expectedGf).toBeCloseTo(20, 9);
    expect(ok.tare!.mismatch).toBe(false);
  });

  it('older projects load with the correction off; the setting gets its defaults', () => {
    const s = migrateState({ schemaVersion: 5, peel: { runs: { 'f#c1': { widthMm: 10 } } } } as never);
    expect(s.peel.runs['f#c1'].tareCorrection).toBeUndefined();
    expect(s.peel.settings.tareCheck).toEqual({ enabled: true, thresholdGf: 2, windowOffsetMm: 1.5, minWindowMm: 2, maxDriftGf: 2 });
    const kept = migrateState({ peel: { runs: { 'f#c1': { tareCorrection: { applied: true, residualGf: 22.4, driftGf: 0.1, preTareGf: 22.9, windowFromMm: 55, windowToMm: 60 } } } } } as never);
    expect(kept.peel.runs['f#c1'].tareCorrection!.applied).toBe(true);
  });
});

/** A small Mach-1 peel file with one Scripts block per run; each run is given by its first force value and its time stamp. */
function peelFile(runs: { f0: number; time: string }[]): string {
  const lines = ['<Mach-1 File>', '<INFO>', 'Date:\tTue, Nov 24, 2026', '<END INFO>'];
  for (const r of runs) {
    lines.push('<INFO>', 'Date:\tTue, Nov 24, 2026', `Time:\t${r.time}`, '<END INFO>', '<Scripts>', 'Script 1', '1VA5;', '1PR-65;', '<DATA>', 'Time, s\tPosition (z), mm\tPosition (x), mm\tPosition (y), mm\tFz, gf');
    for (let i = 0; i < 40; i++) lines.push([i * 0.02, -i * 0.1, 0, 0, -(r.f0 + (i < 30 ? 100 : 0))].map((v) => v.toFixed(6)).join('\t'));
    lines.push('<END DATA>');
  }
  return lines.join('\r\n') + '\r\n';
}

describe('run-level duplicate detection when adding files', () => {
  it('refuses an identical file and a renamed copy, and imports only the new run of a file with old runs', async () => {
    const a = peelFile([{ f0: 1, time: '10:00:00.000' }, { f0: 2, time: '10:05:00.000' }]);
    const loaded = await parseSource({ path: 'peel/0.5/glass.txt', bytes: enc(a) });
    expect(loaded.cycles.every((c) => /^[0-9a-f]{64}$/.test(c.fingerprint ?? ''))).toBe(true);
    // Load a saved project containing that file; its sources carry the run fingerprints.
    const p = defaultProject();
    const zip = saveProjectZip(p, [{ fileId: loaded.parsed.fileId, path: loaded.parsed.path, name: loaded.parsed.name, sha256: loaded.parsed.sha256, sizeBytes: loaded.parsed.sizeBytes, mode: 'peel', runFingerprints: loaded.cycles.map((c) => c.fingerprint!) }], 'complete', new Map([[`peel|${loaded.parsed.fileId}`, loaded.bytes]]));
    const lp = loadProjectZip(zip);
    expect(lp.json.sources[0].runFingerprints).toEqual(loaded.cycles.map((c) => c.fingerprint));
    const reopened = await parseSource(lp.files[0]);
    expect(reopened.cycles.map((c) => c.fingerprint)).toEqual(loaded.cycles.map((c) => c.fingerprint)); // recomputed from the embedded data

    const knownFiles = [{ sha256: reopened.parsed.sha256, path: reopened.parsed.path, mode: 'peel' as const }];
    const knownRuns = new Map(reopened.cycles.map((c) => [c.fingerprint!, { path: reopened.parsed.path, cycleNumber: c.cycleNumber, mode: 'peel' as const }]));
    const identical = await parseSource({ path: 'peel/0.5/glass.txt', bytes: enc(a) });
    const renamed = await parseSource({ path: 'other folder/glass copy.txt', bytes: enc(a) });
    // The same two runs (same data and time stamps) plus one new run; the file as a whole differs.
    const mixed = await parseSource({ path: 'later/glass v2.txt', bytes: enc(peelFile([{ f0: 1, time: '10:00:00.000' }, { f0: 2, time: '10:05:00.000' }, { f0: 3, time: '11:00:00.000' }])) });
    const plan = planImport(knownFiles, knownRuns, [identical, renamed, mixed], 'peel', MODE_LABEL);
    expect(plan.map((x) => x.outcome)).toEqual(['refused', 'refused', 'partial']);
    expect(plan[0].message).toBe('Already in project as peel/0.5/glass.txt.');
    expect(plan[1].message).toBe('Already in project as peel/0.5/glass.txt.');
    expect(plan[2].keep).toEqual([3]);
    expect(plan[2].message).toBe('Imported run 3, skipped runs 1, 2 (already loaded from peel/0.5/glass.txt).');
  });

  it('refuses a file whose runs are all loaded already, also within one upload batch', async () => {
    const one = await parseSource({ path: 'a/glass.txt', bytes: enc(peelFile([{ f0: 1, time: '09:00:00.000' }])) });
    // Same run, but the file has an extra empty line at the end: a different file, the same run.
    const sameRun = await parseSource({ path: 'b/glass.txt', bytes: enc(peelFile([{ f0: 1, time: '09:00:00.000' }]) + '\r\n') });
    expect(sameRun.parsed.sha256).not.toBe(one.parsed.sha256);
    const plan = planImport([], new Map(), [one, sameRun], 'peel', MODE_LABEL);
    expect(plan.map((x) => x.outcome)).toEqual(['imported', 'refused']);
    expect(plan[1].message).toBe('All runs already loaded from a/glass.txt.');
    // The same data recorded at another time is a different run.
    const later = await parseSource({ path: 'c/glass.txt', bytes: enc(peelFile([{ f0: 1, time: '09:30:00.000' }])) });
    expect(planImport([], new Map(), [one, later], 'peel', MODE_LABEL).map((x) => x.outcome)).toEqual(['imported', 'imported']);
    // Files of one upload going to different tests: a match in another test is named with that test.
    const plan2 = planImport([], new Map(), [one, sameRun], (f) => (f === one ? 'tack' : 'peel'), MODE_LABEL);
    expect(plan2[1].outcome).toBe('refused');
    expect(plan2[1].message).toContain(`(${MODE_LABEL.tack})`);
  });

  it('saved projects keep the runs that were not imported', () => {
    const s = migrateState({ duplicateRuns: { f1: [1, 2], f2: 'x' } } as never);
    expect(s.duplicateRuns).toEqual({ f1: [1, 2] });
  });
});
