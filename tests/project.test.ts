import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { loadProjectZip, matchSources, migrateState, remapState, saveProjectZip } from '../src/storage/project';
import { clearSession, loadSession, saveSessionFiles, saveSessionState } from '../src/storage/idb';
import { defaultProject, defaultSettings } from '../src/state/defaults';
import { PROJECT_SCHEMA_VERSION, type SourceFileRecord } from '../src/types';
import { zipSync, strToU8 } from 'fflate';
import { loadSynthetic } from './helpers';

const record = (l: Awaited<ReturnType<typeof loadSynthetic>>[number]): SourceFileRecord => ({
  fileId: l.parsed.fileId, path: l.parsed.path, name: l.parsed.name, sha256: l.parsed.sha256, sizeBytes: l.parsed.sizeBytes,
});

describe('project save and load', () => {
  it('round-trips a settings-only project without any measurement data', async () => {
    const loaded = await loadSynthetic();
    const p = defaultProject();
    p.settings.peakMetric = 'absmax';
    p.settings.point.zHalf = 7;
    p.overrides[loaded[0].parsed.fileId] = { concentrationM: 2.5 };
    p.runOverrides[loaded[1].cycles[0]?.cycleId ?? 'x#c1'] = { action: 'exclude', reason: 'bubble', at: '2026-10-23T00:00:00Z' };
    p.graphs[0].cycleIds = loaded[1].cycles.map((c) => c.cycleId);
    const zip = saveProjectZip(p, loaded.map(record), 'settings', new Map());
    const back = loadProjectZip(zip);
    expect(back.files).toHaveLength(0);
    expect(back.json.mode).toBe('settings');
    expect(back.json.state.settings.peakMetric).toBe('absmax');
    expect(back.json.state.settings.point.zHalf).toBe(7);
    expect(back.json.state.overrides).toEqual(p.overrides);
    expect(back.json.state.runOverrides).toEqual(p.runOverrides);
    expect(back.json.state.excludedCycles).toBeUndefined();
    expect(back.json.state.graphs[0].cycleIds).toEqual(p.graphs[0].cycleIds);
    expect(back.json.sources.map((s) => s.sha256)).toEqual(loaded.map((l) => l.parsed.sha256));
  });

  it('includes the original bytes in a complete project', async () => {
    const loaded = await loadSynthetic();
    const bytes = new Map(loaded.map((l) => [l.parsed.fileId, l.bytes]));
    const back = loadProjectZip(saveProjectZip(defaultProject(), loaded.map(record), 'complete', bytes));
    expect(back.files).toHaveLength(loaded.length);
    const first = back.files.find((f) => f.path === loaded[0].parsed.path)!;
    expect(Array.from(first.bytes)).toEqual(Array.from(loaded[0].bytes));
  });

  it('rejects invalid or newer project files with clear messages', () => {
    expect(() => loadProjectZip(new Uint8Array([1, 2, 3]))).toThrow(/not a valid project/);
    expect(() => loadProjectZip(zipSync({ 'x.txt': strToU8('x') }))).toThrow(/project.json is missing/);
    const newer = zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'mach1-analyzer-project', schemaVersion: PROJECT_SCHEMA_VERSION + 1 })) });
    expect(() => loadProjectZip(newer)).toThrow(/newer version/);
  });

  it('fills in missing fields from older/partial project states', () => {
    const s = migrateState({ name: 'old', settings: { peakMetric: 'max' } as never });
    expect(s.settings.peakMetric).toBe('max');
    expect(s.settings.point.halfWindow).toBe(5);
    expect(s.graphs.length).toBe(1);
  });

  it('converts old excludedCycles into exclude overrides and keeps accepting schema-1 projects', () => {
    const s = migrateState({
      excludedCycles: { 'f1#c2': { reason: 'missed contact', at: '2026-01-02T03:04:05Z' }, 'f1#c3': { reason: 'old', at: 't0' } },
      runOverrides: { 'f1#c3': { action: 'include', reason: 'newer decision', at: 't1' } },
    });
    expect(s.runOverrides['f1#c2']).toEqual({ action: 'exclude', reason: 'missed contact', at: '2026-01-02T03:04:05Z' });
    expect(s.runOverrides['f1#c3'].action).toBe('include'); // an explicit override wins over the legacy entry
    expect(s.excludedCycles).toBeUndefined();
    expect(s.settings.runExclusion.excludeClasses).toEqual(['red', 'orange']);

    const old = { format: 'mach1-analyzer-project', schemaVersion: 1, appVersion: '1.1.0', algorithmVersion: '1.0.0', savedAt: 't', mode: 'settings', sources: [],
      state: { name: 'old', excludedCycles: { 'f1#c1': { reason: 'bubble', at: 't' } }, settings: { peakMetric: 'min' } } };
    const lp = loadProjectZip(zipSync({ 'project.json': strToU8(JSON.stringify(old)) }));
    expect(lp.json.state.runOverrides).toEqual({ 'f1#c1': { action: 'exclude', reason: 'bubble', at: 't' } });
    expect(lp.json.state.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(lp.warnings.join(' ')).toMatch(/algorithm version 1.0.0/);
  });

  it('remembers the selected main tab and fills in graph options missing from older projects', () => {
    expect(defaultProject().mainTab).toBe('graph');
    expect(defaultProject().graphs[0].showExcluded).toBe(true);
    const old = migrateState({ graphs: [{ id: 'g1', title: 'G', x: 'disp_mm', y: 'force', cycleIds: ['a#c1'], hidden: [], showMarkers: false } as never] });
    expect(old.mainTab).toBe('graph');
    expect(old.graphs[0].showExcluded).toBe(true);
    expect(old.graphs[0].showMarkers).toBe(false);
    expect(migrateState({ mainTab: 'compare' }).mainTab).toBe('compare');
    expect(migrateState({ mainTab: 'summary' as never }).mainTab).toBe('analysis'); // 1.3 summary tab became part of Data analysis
    expect(migrateState({ mainTab: 'bogus' as never }).mainTab).toBe('graph');
  });

  it('keeps the chosen experiment and remaps its file ids when files are reconnected', () => {
    expect(migrateState({}).experiment).toEqual({ chargeRatio: null, concentrationM: null, substrate: null, fileId: null, overlay: false, overlayFileIds: [] });
    const s = migrateState({ experiment: { chargeRatio: '0.25', concentrationM: '2.5', substrate: 'Glass', fileId: 'old1', overlay: true, overlayFileIds: ['old2', 'x'] } });
    expect(s.experiment.substrate).toBe('Glass');
    const r = remapState(s, new Map([['old1', 'new1'], ['old2', 'new2']]));
    expect(r.experiment.fileId).toBe('new1');
    expect(r.experiment.overlayFileIds).toEqual(['new2', 'x']);
  });

  it('switches projects saved with the old signed displacement default to distance from each run start', () => {
    expect(migrateState({ schemaVersion: 2, settings: { displacementMode: 'signed' } as never }).settings.displacementMode).toBe('distance');
    expect(migrateState({ schemaVersion: 2, settings: { displacementMode: 'inverted' } as never }).settings.displacementMode).toBe('inverted');
    expect(migrateState({ schemaVersion: 3, settings: { displacementMode: 'signed' } as never }).settings.displacementMode).toBe('signed');
    expect(migrateState({ schemaVersion: 2, settings: {} as never }).settings.forceSign).toBe('positive');
  });

  it('fills in the compare selection for older projects and keeps a saved one', () => {
    expect(migrateState({}).compare).toEqual({ substrates: null, chargeRatios: null, concentrations: null, holdTimes: null, hiddenSets: [], order: 'desc', which: 'processed' });
    expect(migrateState({ compare: { substrates: ['glass', 'pet'], order: 'asc' } as never }).compare).toMatchObject({ substrates: ['glass', 'pet'], order: 'asc', hiddenSets: [] });
  });

  it('removes the retired gel option from grouping and comparison keys of older projects', () => {
    const ds = defaultSettings();
    const s = migrateState({
      groupBy: ['chargeRatio', 'gel', 'substrate'],
      settings: { ...ds, cycle: { ...ds.cycle, compareBy: ['chargeRatio', 'concentrationM', 'gel', 'substrate', 'holdTimeS'] } },
    });
    expect(s.groupBy).toEqual(['chargeRatio', 'substrate']);
    expect(s.settings.cycle.compareBy).toEqual(['chargeRatio', 'concentrationM', 'substrate', 'holdTimeS']);
    expect(migrateState({ groupBy: ['gel'] }).groupBy).toEqual(defaultProject().groupBy);
    expect(defaultProject().groupBy).not.toContain('gel');
    expect(ds.cycle.compareBy).not.toContain('gel');
  });

  it('reconnects re-selected files by SHA-256 even if they were moved, and reports missing/changed files', () => {
    const saved: SourceFileRecord[] = [
      { fileId: 'old1', path: 'A/30s.txt', name: '30s.txt', sha256: 'h1', sizeBytes: 1 },
      { fileId: 'old2', path: 'A/60s.txt', name: '60s.txt', sha256: 'h2', sizeBytes: 1 },
      { fileId: 'old3', path: 'A/1s.txt', name: '1s.txt', sha256: 'h3', sizeBytes: 1 },
    ];
    const imported: SourceFileRecord[] = [
      { fileId: 'new1', path: 'Moved/30s.txt', name: '30s.txt', sha256: 'h1', sizeBytes: 1 },
      { fileId: 'new3', path: 'A/1s.txt', name: '1s.txt', sha256: 'DIFFERENT', sizeBytes: 1 },
    ];
    const m = matchSources(saved, imported);
    expect(m.idMap.get('old1')).toBe('new1');
    expect(m.missing.map((x) => x.fileId)).toEqual(['old2']);
    expect(m.changed.map((x) => x.fileId)).toEqual(['old3']);

    const p = defaultProject();
    p.runOverrides['old1#c2'] = { action: 'exclude', reason: 'r', at: 't' };
    p.excludedPoints['old1#c1'] = { '5': { reason: 'spike', at: 't' } };
    p.overrides.old1 = { substrate: 'Glass' };
    p.selection = ['old1#c1'];
    const r = remapState(p, m.idMap);
    expect(Object.keys(r.runOverrides)).toEqual(['new1#c2']);
    expect(Object.keys(r.excludedPoints)).toEqual(['new1#c1']);
    expect(Object.keys(r.overrides)).toEqual(['new1']);
    expect(r.selection).toEqual(['new1#c1']);
  });
});

describe('browser autosave (IndexedDB)', () => {
  it('stores and restores the session and files, and can be cleared', async () => {
    const p = defaultProject();
    p.name = 'autosave-test';
    await saveSessionState({ savedAt: 'now', state: p, sources: [], hasFiles: true });
    await saveSessionFiles([{ path: 'a/30s.txt', bytes: new Uint8Array([1, 2, 3]) }]);
    const s = await loadSession();
    expect(s.session?.state.name).toBe('autosave-test');
    expect(Array.from(s.files[0].bytes)).toEqual([1, 2, 3]);
    await clearSession();
    expect((await loadSession()).session).toBeNull();
  });
});
