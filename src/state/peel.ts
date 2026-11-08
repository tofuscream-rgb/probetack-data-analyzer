/**
 * 90° peel mode state: the runs of the peel files, each strip's dimensions,
 * angle and failure mode, and the cached analysis results.
 */
import { useCallback, useMemo } from 'react';
import { useApp } from './AppContext';
import { uniqueFileNames } from './experiment';
import { runCondition, runLabels, type RunCondition } from '../analysis/runCompare';
import { analyzePeelCycle, type PeelResult } from '../analysis/peel';
import { matchesPick, normalizePick, pickOptions } from '../analysis/experimentPick';
import type { Cycle, ExperimentPick, ParsedFile, PeelRunMeta, PeelSettings, PeelState } from '../types';

export interface PeelRun {
  id: string;
  file: ParsedFile;
  cycle: Cycle;
  label: string;
  condition: string;
  /** The same conditions as separate fields (Compare tab). */
  cond: RunCondition;
  meta: PeelRunMeta;
  result: PeelResult;
}

const cache = new WeakMap<Cycle, { key: string; settings: PeelSettings; result: PeelResult }>();

function cachedResult(c: Cycle, meta: PeelRunMeta, s: PeelSettings): PeelResult {
  const key = `${meta.lengthMm}|${meta.widthMm}|${meta.thicknessMm}|${meta.angleDeg}|${meta.manualDetachMm}`;
  const hit = cache.get(c);
  if (hit && hit.key === key && hit.settings === s) return hit.result;
  const result = analyzePeelCycle(c, meta, s);
  cache.set(c, { key, settings: s, result });
  return result;
}

export function peelMeta(ps: PeelState, id: string): PeelRunMeta {
  return ps.runs[id] ?? { ...ps.settings.defaults, failureMode: 'unspecified', manualDetachMm: null };
}

export function usePeel() {
  const { filesByMode, project, update, meta } = useApp();
  const ps = project.peel;
  const files = filesByMode.peel;

  const runs = useMemo<PeelRun[]>(() => {
    const off = new Set(ps.disabledFiles);
    const out: PeelRun[] = [];
    const names = uniqueFileNames(files.filter((l) => !off.has(l.parsed.fileId)).map((l) => l.parsed));
    for (const l of files) {
      if (off.has(l.parsed.fileId)) continue;
      const m = meta.get(l.parsed.fileId);
      const condition = m
        ? [m.chargeRatio.value !== null ? `CR ${m.chargeRatio.value}` : null, m.concentrationM.source === 'default' ? null : `${m.concentrationM.value} M`, m.substrate.value].filter(Boolean).join(' · ') || '(no condition in folder names)'
        : '';
      for (const c of l.cycles) {
        const rm = peelMeta(ps, c.cycleId);
        out.push({ id: c.cycleId, file: l.parsed, cycle: c, label: '', condition, cond: runCondition(m), meta: rm, result: cachedResult(c, rm, ps.settings) });
      }
    }
    const labels = runLabels(out.map((r) => ({ fileId: r.file.fileId, fileName: r.file.name, uniqueName: names.get(r.file.fileId) ?? r.file.name, cycleNumber: r.cycle.cycleNumber, runsInFile: r.file.blocks.length ? out.filter((x) => x.file.fileId === r.file.fileId).length : 1, cond: r.cond })));
    out.forEach((r, i) => (r.label = labels[i]));
    return out;
  }, [files, meta, ps]);

  const valid = runs.filter((r) => r.result.ok);
  // "Choose your experiment": only runs of the chosen charge ratio, concentration and substrate are shown.
  const conds = useMemo(() => runs.map((r) => r.cond), [runs]);
  const pick = useMemo(() => normalizePick(conds, ps.pick), [conds, ps.pick]);
  const options = useMemo(() => pickOptions(conds, pick), [conds, pick]);
  const picked = useMemo(() => runs.filter((r) => matchesPick(r.cond, pick)), [runs, pick]);
  /** Ticked runs of every experiment (used by Compare charge ratios). */
  const selectedAllIds = ps.selected === null ? valid.map((r) => r.id) : ps.selected.filter((id) => runs.some((r) => r.id === id));
  const selectedAll = runs.filter((r) => selectedAllIds.includes(r.id));
  /** Ticked runs of the chosen experiment (graph, results, gel dimensions, export). */
  const selected = picked.filter((r) => selectedAllIds.includes(r.id));
  const selectedIds = selected.map((r) => r.id);

  const set = useCallback((patch: Partial<PeelState>) => update((p) => ({ ...p, peel: { ...p.peel, ...patch } })), [update]);
  const setSettings = useCallback(
    (patch: Partial<PeelSettings>) => update((p) => ({ ...p, peel: { ...p.peel, settings: { ...p.peel.settings, ...patch } } })),
    [update],
  );
  const setMeta = useCallback(
    (ids: string[], patch: Partial<PeelRunMeta>) =>
      update((p) => {
        const next = { ...p.peel.runs };
        for (const id of ids) next[id] = { ...peelMeta(p.peel, id), ...patch };
        return { ...p, peel: { ...p.peel, runs: next } };
      }),
    [update],
  );
  const setSelected = useCallback((ids: string[]) => set({ selected: ids }), [set]);
  /** Tick runs of the chosen experiment; ticks of other experiments are kept. */
  const setPickedSelected = useCallback(
    (ids: string[]) => {
      const inPick = new Set(picked.map((r) => r.id));
      set({ selected: [...selectedAllIds.filter((id) => !inPick.has(id)), ...ids] });
    },
    [picked, selectedAllIds, set],
  );
  const setPick = useCallback((patch: Partial<ExperimentPick>) => set({ pick: normalizePick(conds, { ...pick, ...patch }) }), [conds, pick, set]);

  return { ps, runs, valid, picked, pick, options, setPick, selected, selectedIds, selectedAll, set, setSettings, setMeta, setSelected, setPickedSelected };
}
