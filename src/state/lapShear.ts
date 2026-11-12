/**
 * Lap-shear mode state: every movement (run) of the imported, selected files,
 * its dimensions and failure mode, and its analysis result. Results are cached
 * per run, so editing one run's dimensions recalculates only that run.
 */
import { useCallback, useMemo } from 'react';
import { useApp } from './AppContext';
import { uniqueFileNames } from './experiment';
import { runCondition, runLabels, type RunCondition } from '../analysis/runCompare';
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
        out.push({ id: c.cycleId, file: l.parsed, cycle: c, label: '', condition, cond: runCondition(m), meta: rm, result: cachedResult(c, rm, ls.settings) });
      }
    }
    const labels = runLabels(out.map((r) => ({ fileId: r.file.fileId, fileName: r.file.name, uniqueName: names.get(r.file.fileId) ?? r.file.name, cycleNumber: r.cycle.cycleNumber, runsInFile: r.file.blocks.length ? out.filter((x) => x.file.fileId === r.file.fileId).length : 1, cond: r.cond })));
    out.forEach((r, i) => (r.label = labels[i]));
    return out;
  }, [files, meta, ls]);

  const valid = runs.filter((r) => r.result.ok);
  const conditions = runs.map((r) => r.cond);
  const pick = normalizePick(conditions, ls.pick);
  const options = pickOptions(conditions, pick);
  const picked = runs.filter((r) => matchesPick(r.cond, pick));
  const selectedAllIds = new Set(ls.selected ?? valid.map((r) => r.id));
  const selectedAll = runs.filter((r) => selectedAllIds.has(r.id));
  const selected = picked.filter((r) => selectedAllIds.has(r.id));
  const selectedIds = selected.map((r) => r.id);

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
