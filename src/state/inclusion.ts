/**
 * Run inclusion shared by Data analysis and Tack metrics (one source of truth:
 * project.runOverrides, plus whole-Repeat / session exclusions). A manual override is
 * written only when the choice differs from what the run would get without it.
 */
import { defaultIncluded, type CycleResult } from '../analysis/engine';
import type { ProjectState } from '../types';

export function withRunInclusion(p: ProjectState, r: CycleResult, want: boolean, reason: string): ProjectState {
  const ro = { ...p.runOverrides };
  if (want === defaultIncluded(r, p)) delete ro[r.cycle.cycleId];
  else ro[r.cycle.cycleId] = { action: want ? 'include' : 'exclude', reason, at: new Date().toISOString() };
  return { ...p, runOverrides: ro };
}

/** Change the reason of a manual run decision (keeps its action and time). */
export function withOverrideReason(p: ProjectState, cycleId: string, reason: string): ProjectState {
  const o = p.runOverrides[cycleId];
  return o ? { ...p, runOverrides: { ...p.runOverrides, [cycleId]: { ...o, reason } } } : p;
}

/**
 * Lap Shear / 90° Peel review choice of one run (true = in the average, false = left out,
 * null = back to the default: every valid run is included). Shared by Data analysis and the
 * metrics tab.
 */
export function withAnalysisInclusion(p: ProjectState, mode: 'lapShear' | 'peel', id: string, value: boolean | null): ProjectState {
  const cur = { ...(p[mode].analysisInclusion ?? {}) };
  if (value === null) delete cur[id];
  else cur[id] = value;
  return mode === 'lapShear' ? { ...p, lapShear: { ...p.lapShear, analysisInclusion: cur } } : { ...p, peel: { ...p.peel, analysisInclusion: cur } };
}
