/**
 * Tack metrics tab: per-run metrics for every file (Repeat) of the chosen charge ratio and
 * concentration (all substrates and dwell times), mean ± SD per Repeat and per condition
 * (substrate × dwell), and exclusions of whole Repeats or test sessions.
 */
import { useCallback, useMemo } from 'react';
import { useApp } from './AppContext';
import { uniqueFileNames, useExperiment } from './experiment';
import { groupValue, isIncluded, sessionOf, type CycleResult } from '../analysis/engine';
import { withOverrideReason, withRunInclusion } from './inclusion';
import { LOW_RESOLUTION_STEPS, TACK_DEFAULTS, analyzeTack, meanSd, type TackMetrics } from '../analysis/tackMetrics';
import { bySubstrate, canonicalSubstrate } from '../analysis/substrates';
import type { Cycle, DatasetExclusion, FailureMode, ParsedFile, TackMetricsState, TackMorphology, TackObservation } from '../types';
import { FAILURE_MODES, TACK_MORPHOLOGIES, optionLabel } from '../analysis/observations';

/** Why a run is left out, from the shared Data analysis status. */
export interface RunExclusion {
  /** 'manual': excluded by you (Data analysis or Tack metrics); 'dataset': its whole Repeat/session; 'auto': automatic QC rule. */
  kind: 'manual' | 'dataset' | 'auto';
  reason: string;
}

export interface TackRun {
  id: string;
  cycle: Cycle;
  /** The shared Data analysis result of this run (status, QC, override). */
  result: CycleResult;
  m: TackMetrics;
  /** null = included in the averages (the same decision as in Data analysis). */
  excluded: RunExclusion | null;
  /** Failure mode and notes entered by the user. */
  obs: TackObservation;
}

/** Runs that enter the statistics after exclusion: analysed and included (shared with Data analysis). */
export const usedRuns = (rp: TackRepeat) => rp.runs.filter((r) => r.m.ok && !r.excluded);
/** All analysed runs, before exclusion. */
export const allOkRuns = (rp: TackRepeat) => rp.runs.filter((r) => r.m.ok);

function runExclusion(r: CycleResult): RunExclusion | null {
  if (isIncluded(r)) return null;
  if (r.status === 'excludedAuto') return { kind: 'auto', reason: r.statusReason };
  return { kind: r.override?.action === 'exclude' ? 'manual' : 'dataset', reason: r.statusReason };
}

export interface TackRepeat {
  fileId: string;
  file: ParsedFile;
  name: string;
  /** Substrate as read or corrected, and its standard name (PET, stainless steel, glass) when it is one. */
  substrate: string;
  substrateLabel: string;
  /** Dwell time (s) from the Wait section. */
  dwellS: number | null;
  /** Charge ratio · concentration · gel of the Repeat (part of its condition). */
  group: string;
  session: string;
  h0: number | null;
  runs: TackRun[];
  excluded: DatasetExclusion | null;
  sessionExcluded: DatasetExclusion | null;
  /** Not excluded as a whole Repeat or session. */
  included: boolean;
}

type MS = { mean: number; sd: number; n: number };

export interface Metric {
  key: string;
  /** Plain name (CSV) and name with HTML subscripts (tables). */
  label: string;
  html: string;
  unit: string;
  digits: number;
  get: (m: TackMetrics) => number | null;
}

/** Main results: shown in the per-run, Repeat and Condition tables. */
export const MAIN_METRICS: Metric[] = [
  { key: 'sigma', label: 'σ_max', html: 'σ<sub>max</sub>', unit: 'kPa', digits: 2, get: (m) => m.sigmaMaxKPa },
  { key: 'w', label: 'W_adh', html: 'W<sub>adh</sub>', unit: 'J/m²', digits: 2, get: (m) => m.wJm2 },
  { key: 'eps', label: 'ε_failure', html: 'ε<sub>failure</sub>', unit: '–', digits: 3, get: (m) => m.epsMax },
  { key: 'plateau', label: 'Plateau stress', html: 'Plateau stress', unit: 'kPa', digits: 2, get: (m) => m.plateau?.stressKPa ?? null },
];

export const DIAG_METRICS: Metric[] = [
  { key: 'fmax', label: 'F_max', html: 'F<sub>max</sub>', unit: 'N', digits: 4, get: (m) => m.fmaxN },
  { key: 'dpeak', label: 'δ_peak', html: 'δ<sub>peak</sub>', unit: 'mm', digits: 3, get: (m) => m.deltaPeakMm },
  { key: 'dfail', label: 'δ_failure', html: 'δ<sub>failure</sub>', unit: 'mm', digits: 3, get: (m) => m.failureDispMm },
  { key: 'plen', label: 'Plateau length', html: 'Plateau length', unit: 'mm', digits: 3, get: (m) => m.plateau?.lengthMm ?? null },
  { key: 'dwStart', label: 'Dwell F start', html: 'Dwell F<sub>start</sub>', unit: 'N', digits: 4, get: (m) => m.dwell?.startN ?? null },
  { key: 'dwEnd', label: 'Dwell F end', html: 'Dwell F<sub>end</sub>', unit: 'N', digits: 4, get: (m) => m.dwell?.endN ?? null },
  { key: 'relax', label: 'Relaxation', html: 'Relaxation', unit: '%', digits: 1, get: (m) => m.dwell?.relaxPct ?? null },
];

export const TACK_METRICS: Metric[] = [...MAIN_METRICS, ...DIAG_METRICS];

export { FAILURE_MODES, TACK_MORPHOLOGIES } from '../analysis/observations';
export const failureModeLabel = (m: FailureMode) => optionLabel(FAILURE_MODES, m);
export const morphologyLabel = (m: TackMorphology) => optionLabel(TACK_MORPHOLOGIES, m);
export const EMPTY_OBSERVATION: TackObservation = { locus: 'unspecified', morphology: 'unspecified', note: '', fibrilOnsetMm: null, fibrilMaxMm: null };

/** Data-quality flags: warnings only (never exclude anything). Short label, details for the tooltip. */
export interface TackFlag {
  key: 'error' | 'resolution' | 'incomplete' | 'tared';
  label: string;
  detail: string;
}
export function tackFlags(m: TackMetrics): TackFlag[] {
  if (!m.ok) return [{ key: 'error', label: 'Not analysed', detail: m.error ?? 'The run could not be analysed.' }];
  const f: TackFlag[] = [];
  if (m.peakSteps !== null && m.peakSteps < LOW_RESOLUTION_STEPS)
    f.push({ key: 'resolution', label: 'Low force resolution', detail: `F_max = ${m.peakSteps.toFixed(1)} force steps of ${m.resolutionN!.toFixed(4)} N; plateau and relaxation may be approximate.` });
  if (m.incomplete) f.push({ key: 'incomplete', label: 'Incomplete detachment', detail: `Full detachment was not recorded (F never fell to ≤ ${TACK_DEFAULTS.endFraction * 100}% of F_max before the file ended); W_adh is a lower bound and true failure displacement/strain are left blank.` });
  if (m.zeroedN !== null) f.push({ key: 'tared', label: 'Load tared after dwell', detail: `Load was reset after dwell (${m.zeroedN.toFixed(4)} N removed); pull force is referenced to the new zero. Preload and relaxation interpretation may be affected.` });
  return f;
}

/** "Cohesive 2 · Fibrillation 1 · not set 3" for a list of runs. */
function countLabels(labels: string[]): string {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => (a[0] === 'not set' ? 1 : b[0] === 'not set' ? -1 : 0)).map(([l, n]) => `${l} ${n}`).join(' · ');
}
export function failureModeCounts(runs: TackRun[]): string {
  return countLabels(runs.map((r) => r.obs.locus === 'unspecified' ? 'not set' : failureModeLabel(r.obs.locus)));
}
export function morphologyCounts(runs: TackRun[]): string {
  return countLabels(runs.map((r) => r.obs.morphology === 'unspecified' ? 'not set' : morphologyLabel(r.obs.morphology)));
}

const cache = new WeakMap<Cycle, { key: string; m: TackMetrics }>();
export function metricsOf(c: Cycle, diameterMm: number, h0: number | null, allowMissingArea = false): TackMetrics {
  const key = `${diameterMm}|${h0}|${allowMissingArea && !(diameterMm > 0)}`;
  const hit = cache.get(c);
  if (hit && hit.key === key) return hit.m;
  const m = analyzeTack(c, { diameterMm, h0Mm: h0, allowMissingArea });
  cache.set(c, { key, m });
  return m;
}

export { sessionOf };

export interface GroupStat {
  key: string;
  label: string;
  substrate: string;
  dwellS: number | null;
  /** After exclusion (Repeats with at least one included run; each Repeat counts once). */
  nRepeats: number;
  nRuns: number;
  stats: Record<string, MS>;
  /** Before exclusion: every analysed run of every Repeat. */
  nRepeatsAll: number;
  nRunsAll: number;
  statsAll: Record<string, MS>;
  /** Failure modes of the runs used. */
  modes: string;
}

export function useTackMetrics() {
  const { derived, project, update } = useApp();
  const ex = useExperiment();
  const tm = project.tackMetrics;
  const diameter = project.settings.probe.diameterMm;

  const repeats = useMemo<TackRepeat[]>(() => {
    // The chosen experiment, with every substrate and dwell time (this tab compares them).
    const inScope = derived.ordered.filter((r) => ex.inPick(r, { substrate: null, hold: null }));
    const byFile = new Map<string, CycleResult[]>();
    for (const r of inScope) byFile.set(r.file.fileId, [...(byFile.get(r.file.fileId) ?? []), r]);
    const names = uniqueFileNames([...byFile.values()].map((l) => l[0].file));
    const out: TackRepeat[] = [...byFile.entries()].map(([fileId, rs]) => {
      const first = rs[0];
      const substrate = first.meta.substrate.value ?? '—';
      const h0 = tm.h0[fileId] ?? null;
      const session = sessionOf(first);
      const excluded = tm.excludedRepeats[fileId] ?? null;
      const sessionExcluded = tm.excludedSessions[session] ?? null;
      return {
        fileId,
        file: first.file,
        name: names.get(fileId) ?? first.file.name,
        substrate,
        substrateLabel: canonicalSubstrate(substrate) ?? substrate,
        dwellS: first.holdTimeS,
        group: [`CR ${groupValue(first, 'chargeRatio') === '—' ? 'unknown' : groupValue(first, 'chargeRatio')}`, `${groupValue(first, 'concentrationM')} M`, groupValue(first, 'gel') === '—' ? 'gel unspecified' : groupValue(first, 'gel')].join(' · '),
        session,
        h0,
        runs: rs.map((r) => ({ id: r.cycle.cycleId, cycle: r.cycle, result: r, m: metricsOf(r.cycle, diameter, h0), excluded: runExclusion(r), obs: tm.observations[r.cycle.cycleId] ?? EMPTY_OBSERVATION })),
        excluded,
        sessionExcluded,
        included: !excluded && !sessionExcluded,
      };
    });
    // PET, stainless steel, glass; then dwell time, repeat number and name.
    return out.sort(
      (a, b) =>
        bySubstrate(a.substrateLabel, b.substrateLabel) ||
        (a.dwellS ?? Infinity) - (b.dwellS ?? Infinity) ||
        (derived.results.get(a.runs[0].id)?.meta.repeat.value ?? 1) - (derived.results.get(b.runs[0].id)?.meta.repeat.value ?? 1) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  }, [derived, ex.inPick, tm, diameter]);

  const statsOf = (runs: TackRun[]) => Object.fromEntries(TACK_METRICS.map((k) => [k.key, meanSd(runs.map((r) => k.get(r.m)))])) as Record<string, MS>;
  /** Mean ± SD over the runs of each Repeat: after exclusion (shared with Data analysis). */
  const repeatStats = useMemo(() => new Map(repeats.map((rp) => [rp.fileId, statsOf(usedRuns(rp))])), [repeats]);
  /** Mean ± SD over the runs of each Repeat: before exclusion (all analysed runs). */
  const repeatStatsAll = useMemo(() => new Map(repeats.map((rp) => [rp.fileId, statsOf(allOkRuns(rp))])), [repeats]);

  /** Per condition (substrate × dwell): mean ± SD over the Repeat means, before and after exclusion. */
  const conditions = useMemo<GroupStat[]>(() => {
    const groups = new Map<string, TackRepeat[]>();
    for (const rp of repeats.filter((x) => allOkRuns(x).length > 0)) {
      const key = `${rp.group.toLowerCase()}|${rp.substrateLabel.toLowerCase()}|${rp.dwellS ?? '—'}`;
      groups.set(key, [...(groups.get(key) ?? []), rp]);
    }
    const severalGroups = new Set(repeats.map((rp) => rp.group)).size > 1;
    return [...groups.entries()].map(([key, all]) => {
      const used = all.filter((rp) => usedRuns(rp).length > 0);
      return {
        key,
        label: `${severalGroups ? `${all[0].group} · ` : ''}${all[0].substrateLabel} · ${all[0].dwellS !== null ? `${all[0].dwellS} s` : 'dwell unknown'}`,
        substrate: all[0].substrateLabel,
        dwellS: all[0].dwellS,
        nRepeats: used.length,
        nRuns: used.reduce((s, rp) => s + usedRuns(rp).length, 0),
        stats: Object.fromEntries(TACK_METRICS.map((k) => [k.key, meanSd(used.map((rp) => repeatStats.get(rp.fileId)![k.key].mean))])) as Record<string, MS>,
        nRepeatsAll: all.length,
        nRunsAll: all.reduce((s, rp) => s + allOkRuns(rp).length, 0),
        statsAll: Object.fromEntries(TACK_METRICS.map((k) => [k.key, meanSd(all.map((rp) => repeatStatsAll.get(rp.fileId)![k.key].mean))])) as Record<string, MS>,
        modes: failureModeCounts(used.flatMap(usedRuns)),
      };
    });
  }, [repeats, repeatStats, repeatStatsAll]);

  const setTm = useCallback((f: (t: TackMetricsState) => TackMetricsState) => update((p) => ({ ...p, tackMetrics: f(p.tackMetrics) })), [update]);
  const setH0 = useCallback(
    (fileIds: string[], v: number | null) =>
      setTm((t) => {
        const h0 = { ...t.h0 };
        for (const id of fileIds) if (v !== null && v > 0) h0[id] = v; else delete h0[id];
        return { ...t, h0 };
      }),
    [setTm],
  );
  const now = () => new Date().toISOString();
  const excludeRepeat = useCallback(
    (fileId: string, on: boolean, reason = '') =>
      setTm((t) => {
        const excludedRepeats = { ...t.excludedRepeats };
        if (on) excludedRepeats[fileId] = { reason, at: excludedRepeats[fileId]?.at ?? now() };
        else delete excludedRepeats[fileId];
        return { ...t, excludedRepeats };
      }),
    [setTm],
  );
  const excludeSession = useCallback(
    (session: string, on: boolean, reason = '') =>
      setTm((t) => {
        const excludedSessions = { ...t.excludedSessions };
        if (on) excludedSessions[session] = { reason, at: excludedSessions[session]?.at ?? now() };
        else delete excludedSessions[session];
        return { ...t, excludedSessions };
      }),
    [setTm],
  );
  /** Exclude or re-include one run: the same shared decision as the "In average" box in Data analysis. */
  const excludeRun = useCallback(
    (cycleId: string, on: boolean, reason = '') =>
      update((p) => {
        const r = derived.results.get(cycleId);
        return r ? withRunInclusion(p, r, !on, reason || (on ? 'Left out after review (Tack metrics)' : 'Kept after review (Tack metrics)')) : p;
      }),
    [update, derived],
  );
  /** Custom area-under-curve limits (saved in the project). */
  const setArea = useCallback((area: { fromMm: number | null; toMm: number | null }) => setTm((t) => ({ ...t, area })), [setTm]);
  /** Edit the reason of a manual run decision. */
  const setRunReason = useCallback((cycleId: string, reason: string) => update((p) => withOverrideReason(p, cycleId, reason)), [update]);
  const setObservation = useCallback(
    (cycleId: string, patch: Partial<TackObservation>) =>
      setTm((t) => ({ ...t, observations: { ...t.observations, [cycleId]: { ...(t.observations[cycleId] ?? EMPTY_OBSERVATION), ...patch } } })),
    [setTm],
  );
  /** Several runs at once (bulk assignment), in one update. */
  const setObservations = useCallback(
    (patches: { id: string; patch: Partial<TackObservation> }[]) =>
      setTm((t) => {
        const observations = { ...t.observations };
        for (const { id, patch } of patches) observations[id] = { ...(observations[id] ?? EMPTY_OBSERVATION), ...patch };
        return { ...t, observations };
      }),
    [setTm],
  );
  const setSubstrate = useCallback(
    (fileId: string, v: string | null) =>
      update((p) => {
        const ov = { ...(p.overrides[fileId] ?? {}) };
        if (v === null) delete ov.substrate; else ov.substrate = v;
        return { ...p, overrides: { ...p.overrides, [fileId]: ov } };
      }),
    [update],
  );

  return { ex, tm, project, diameter, repeats, repeatStats, repeatStatsAll, conditions, setH0, excludeRepeat, excludeSession, excludeRun, setRunReason, setArea, setObservation, setObservations, setSubstrate };
}
