/**
 * Lap-shear mode state: every movement (run) of the imported, selected files,
 * its dimensions and failure mode, and its analysis result. Results are cached
 * per run, so editing one run's dimensions recalculates only that run.
 */
import { useCallback, useMemo } from 'react';
import { useApp } from './AppContext';
import { uniqueFileNames } from './experiment';
import { runCondition, type RunCondition } from '../analysis/runCompare';
import { analyzeLapShearCycle, type LapShearResult } from '../analysis/lapShear';
import type { Cycle, LapShearRunMeta, LapShearSettings, LapShearState, ParsedFile } from '../types';

export interface LapShearRun {
  id: string;
  file: ParsedFile;
  cycle: Cycle;
  /** "SS.txt – Run 2" */
  label: string;
  /** Charge ratio · concentration · substrate read from the folder names (for grouping). */
  condition: string;
  /** The same conditions as separate fields (Compare tab). */
  cond: RunCondition;
  meta: LapShearRunMeta;
  result: LapShearResult;
}

const cache = new WeakMap<Cycle, { key: string; settings: LapShearSettings; result: LapShearResult }>();

function cachedResult(c: Cycle, meta: LapShearRunMeta, s: LapShearSettings): LapShearResult {
  const key = `${meta.lengthMm}|${meta.widthMm}|${meta.thicknessMm}|${meta.manualFailureMm}`;
  const hit = cache.get(c);
  if (hit && hit.key === key && hit.settings === s) return hit.result;
  const result = analyzeLapShearCycle(c, meta, s);
  cache.set(c, { key, settings: s, result });
  return result;
}

export function runMeta(ls: LapShearState, id: string): LapShearRunMeta {
  return ls.runs[id] ?? { ...ls.settings.defaults, failureMode: 'unspecified', manualFailureMm: null };
}

export function useLapShear() {
  const { filesByMode, project, update, meta } = useApp();
  const files = filesByMode.lapShear;
  const ls = project.lapShear;

  const runs = useMemo<LapShearRun[]>(() => {
    const off = new Set(project.lapShear.disabledFiles);
    const out: LapShearRun[] = [];
    const names = uniqueFileNames(files.filter((l) => !off.has(l.parsed.fileId)).map((l) => l.parsed));
    for (const l of files) {
      if (off.has(l.parsed.fileId)) continue;
      const m = meta.get(l.parsed.fileId);
      const condition = m
        ? [m.chargeRatio.value !== null ? `CR ${m.chargeRatio.value}` : null, m.concentrationM.source === 'default' ? null : `${m.concentrationM.value} M`, m.substrate.value].filter(Boolean).join(' · ') || '(no condition in folder names)'
        : '';
      for (const c of l.cycles) {
        const rm = runMeta(ls, c.cycleId);
        out.push({ id: c.cycleId, file: l.parsed, cycle: c, label: `${names.get(l.parsed.fileId) ?? l.parsed.name} – Run ${c.cycleNumber}`, condition, cond: runCondition(m), meta: rm, result: cachedResult(c, rm, ls.settings) });
      }
    }
    return out;
  }, [files, meta, ls]);

  const valid = runs.filter((r) => r.result.ok);
  const selectedIds = ls.selected === null ? valid.map((r) => r.id) : ls.selected.filter((id) => runs.some((r) => r.id === id));
  const selected = runs.filter((r) => selectedIds.includes(r.id));

  const set = useCallback((patch: Partial<LapShearState>) => update((p) => ({ ...p, lapShear: { ...p.lapShear, ...patch } })), [update]);
  const setSettings = useCallback(
    (patch: Partial<LapShearSettings>) => update((p) => ({ ...p, lapShear: { ...p.lapShear, settings: { ...p.lapShear.settings, ...patch } } })),
    [update],
  );
  /** Edit dimensions, failure mode or manual failure point of one or more runs. */
  const setMeta = useCallback(
    (ids: string[], patch: Partial<LapShearRunMeta>) =>
      update((p) => {
        const next = { ...p.lapShear.runs };
        for (const id of ids) next[id] = { ...runMeta(p.lapShear, id), ...patch };
        return { ...p, lapShear: { ...p.lapShear, runs: next } };
      }),
    [update],
  );
  const setSelected = useCallback((ids: string[]) => set({ selected: ids }), [set]);

  return { ls, runs, valid, selected, selectedIds, set, setSettings, setMeta, setSelected };
}
