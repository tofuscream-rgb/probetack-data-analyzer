import { describe, expect, it } from 'vitest';
import { parseSource } from '../src/parser/loader';
import { defaultProject } from '../src/state/defaults';
import { isIncluded, sessionOf } from '../src/analysis/engine';
import { withOverrideReason, withRunInclusion } from '../src/state/inclusion';
import { migrateState } from '../src/storage/project';
import { derive, enc, miniFile } from './helpers';

function curve(peak: number, n = 60): number[] {
  return Array.from({ length: n }, (_, i) => (i < 10 ? 0 : -peak * Math.sin((Math.PI * (i - 10)) / (n - 10))));
}
async function load(path: string, peaks: number[]) {
  const t = miniFile(peaks.map((p) => curve(p)));
  return parseSource({ path, bytes: enc(t) });
}

describe('one shared inclusion state for Data analysis and Tack metrics', () => {
  it('a whole-Repeat or session exclusion excludes its runs in the shared status, with the reason', async () => {
    const a = await load('0.25/Glass/30s.txt', [40, 41, 42]);
    const b = await load('0.25/Glass/30s-2.txt', [40, 41, 42]);
    const p = defaultProject();
    p.tackMetrics.excludedRepeats = { [a.parsed.fileId]: { reason: 'bubble under probe', at: '' } };
    const d = derive([a, b], p);
    const runsA = d.ordered.filter((r) => r.file.fileId === a.parsed.fileId);
    const runsB = d.ordered.filter((r) => r.file.fileId === b.parsed.fileId);
    expect(runsA.every((r) => r.status === 'excludedManual' && /whole Repeat .*bubble under probe/.test(r.statusReason))).toBe(true);
    expect(runsB.every(isIncluded)).toBe(true);
    const session = sessionOf(runsB[0]);
    p.tackMetrics.excludedRepeats = {};
    p.tackMetrics.excludedSessions = { [session]: { reason: 'probe not cleaned', at: '' } };
    expect(derive([a, b], p).ordered.every((r) => r.status === 'excludedManual' && /session/.test(r.statusReason))).toBe(true);
  });

  it('excluding or re-including a run writes the same override, whichever tab does it; a run decision wins over a Repeat exclusion', async () => {
    const a = await load('0.25/Glass/30s.txt', [40, 41, 42]);
    let p = defaultProject();
    let r = derive([a], p).ordered[0];
    expect(isIncluded(r)).toBe(true);
    p = withRunInclusion(p, r, false, 'Left out after review (Tack metrics)');
    expect(p.runOverrides[r.cycle.cycleId]).toMatchObject({ action: 'exclude', reason: 'Left out after review (Tack metrics)' });
    r = derive([a], p).ordered[0];
    expect(isIncluded(r)).toBe(false); // seen as excluded by Data analysis too
    p = withOverrideReason(p, r.cycle.cycleId, 'trapped air');
    expect(p.runOverrides[r.cycle.cycleId].reason).toBe('trapped air');
    p = withRunInclusion(p, r, true, 'Kept after review (Data analysis)');
    expect(p.runOverrides[r.cycle.cycleId]).toBeUndefined(); // back to the automatic decision
    // Repeat excluded: re-including one run keeps it (manual run decision wins).
    p.tackMetrics.excludedRepeats = { [a.parsed.fileId]: { reason: 'x', at: '' } };
    r = derive([a], p).ordered[0];
    expect(isIncluded(r)).toBe(false);
    p = withRunInclusion(p, r, true, 'Kept after review (Data analysis)');
    expect(p.runOverrides[r.cycle.cycleId].action).toBe('include');
    expect(isIncluded(derive([a], p).ordered[0])).toBe(true);
  });

  it('older projects: single-run exclusions made in Tack metrics become shared overrides with their reasons', () => {
    const s = migrateState({
      runOverrides: { 'f#c2': { action: 'include', reason: 'kept in Data analysis', at: 't' } },
      tackMetrics: { excludedRuns: { 'f#c1': { reason: 'load zeroed', at: 't1' }, 'f#c2': { reason: 'conflict', at: 't2' } } },
    } as never);
    expect(s.runOverrides['f#c1']).toEqual({ action: 'exclude', reason: 'load zeroed (Tack metrics)', at: 't1' });
    expect(s.runOverrides['f#c2'].action).toBe('include'); // a decision already made in Data analysis wins
    expect(s.tackMetrics.excludedRuns).toEqual({});
  });
});
