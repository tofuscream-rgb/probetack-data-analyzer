/**
 * Lap-shear mode state: every movement (run) of the imported, selected files,
 * its dimensions and failure mode, and its analysis result. Results are cached
 * per run, so editing one run's dimensions recalculates only that run.
 */
import { useCallback, useMemo } from 'react';
import { useApp } from './AppContext';
import { uniqueFileNames } from './experiment';
import { runCondition, runLabels, withRecordedHold, type RunCondition } from '../analysis/runCompare';
import { analyzeLapShearCycle, type LapShearResult } from '../analysis/lapShear';
import { matchesPick, normalizePick, pickOptions } from '../analysis/experimentPick';
import type { Cycle, ExperimentPick, LapShearRunMeta, LapShearSettings, LapShearState, ParsedFile } from '../types';

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

export function runMeta(ls: Pick<LapShearState, 'runs' | 'settings'>, id: string): LapShearRunMeta {
  return ls.runs[id] ?? { ...ls.settings.defaults, failureMode: 'unspecified', manualFailureMm: null };
}

export function useLapShear() {
  const { filesByMode, project, update, meta } = useApp();
  const files = filesByMode.lapShear;
  const ls = project.lapShear;
  const { disabledFiles, runs: savedRuns, settings } = ls;

  const runs = useMemo<LapShearRun[]>(() => {
    const off = new Set(disabledFiles);
    const out: LapShearRun[] = [];
    const runCounts = new Map<string, number>();
    const names = uniqueFileNames(files.filter((l) => !off.has(l.parsed.fileId)).map((l) => l.parsed));
    for (const l of files) {
      if (off.has(l.parsed.fileId)) continue;
      const m = meta.get(l.parsed.fileId);
      const condition = m
        ? [m.chargeRatio.value !== null ? `CR ${m.chargeRatio.value}` : null, m.concentrationM.source === 'default' ? null : `${m.concentrationM.value} M`, m.substrate.value].filter(Boolean).join(' · ') || '(no condition in folder names)'
        : '';
      runCounts.set(l.parsed.fileId, l.cycles.length);
      for (const c of l.cycles) {
        const rm = runMeta({ runs: savedRuns, settings }, c.cycleId);
        out.push({ id: c.cycleId, file: l.parsed, cycle: c, label: '', condition, cond: withRecordedHold(runCondition(m), c.holdTimeS), meta: rm, result: cachedResult(c, rm, settings) });
      }
    }
    const labels = runLabels(out.map((r) => ({ fileId: r.file.fileId, fileName: r.file.name, uniqueName: names.get(r.file.fileId) ?? r.file.name, cycleNumber: r.cycle.cycleNumber, runsInFile: runCounts.get(r.file.fileId) ?? 1, cond: r.cond })));
    out.forEach((r, i) => (r.label = labels[i]));
    return out;
  }, [files, meta, disabledFiles, savedRuns, settings]);

  const valid = useMemo(() => runs.filter((r) => r.result.ok), [runs]);
  const conditions = useMemo(() => runs.map((r) => ({ ...r.cond, fileId: r.file.fileId })), [runs]);
  const pick = useMemo(() => normalizePick(conditions, ls.pick), [conditions, ls.pick]);
  const options = useMemo(() => pickOptions(conditions, pick), [conditions, pick]);
  const picked = useMemo(() => runs.filter((r) => matchesPick(r.cond, pick)), [runs, pick]);
  const selectedAllIds = useMemo(() => new Set(ls.selected ?? valid.map((r) => r.id)), [ls.selected, valid]);
  const selectedAll = useMemo(() => runs.filter((r) => selectedAllIds.has(r.id)), [runs, selectedAllIds]);
  const selected = useMemo(() => picked.filter((r) => selectedAllIds.has(r.id)), [picked, selectedAllIds]);
  const selectedIds = useMemo(() => selected.map((r) => r.id), [selected]);

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
  const setPick = (patch: Partial<ExperimentPick>) => set({ pick: normalizePick(conditions, { ...pick, ...patch }) });
  const setSelected = (ids: string[]) => {
    const inPick = new Set(picked.map((r) => r.id));
    set({ selected: [...selectedAll.filter((r) => !inPick.has(r.id)).map((r) => r.id), ...ids] });
  };

  return { ls, runs, valid, picked, pick, options, setPick, selected, selectedAll, selectedIds, set, setSettings, setMeta, setSelected };
}
