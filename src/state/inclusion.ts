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
