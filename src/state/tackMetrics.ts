/**
 * Tack metrics tab: per-run metrics for every file (Repeat) of the chosen charge ratio and
 * concentration (all substrates and dwell times), mean ± SD per Repeat and per condition
 * (substrate × dwell), and exclusions of whole Repeats or test sessions.
 */
import { useCallback, useMemo } from 'react';
import { useApp } from './AppContext';
import { uniqueFileNames, useExperiment } from './experiment';
import { groupValue, type CycleResult } from '../analysis/engine';
import { LOW_RESOLUTION_STEPS, TACK_DEFAULTS, analyzeTack, meanSd, type TackMetrics } from '../analysis/tackMetrics';
import { bySubstrate, canonicalSubstrate } from '../analysis/substrates';
import type { Cycle, DatasetExclusion, ParsedFile, TackFailureMode, TackMetricsState, TackObservation } from '../types';

export interface TackRun {
  id: string;
  cycle: Cycle;
  m: TackMetrics;
  /** Left out by the user (optional; no run is excluded by default). */
  excluded: DatasetExclusion | null;
  /** Failure mode and notes entered by the user. */
  obs: TackObservation;
}

/** Runs that enter the statistics: analysed and not excluded. */
export const usedRuns = (rp: TackRepeat) => rp.runs.filter((r) => r.m.ok && !r.excluded);

export interface TackRepeat {
  fileId: string;
  file: ParsedFile;
  name: string;
  /** Substrate as read or corrected, and its standard name (PET, stainless steel, glass) when it is one. */
  substrate: string;
  substrateLabel: string;
  /** Dwell time (s) from the Wait section. */
  dwellS: number | null;
  session: string;
  h0: number | null;
  runs: TackRun[];
  excluded: DatasetExclusion | null;
  sessionExcluded: DatasetExclusion | null;
  /** Used in the condition statistics. */
  included: boolean;
}

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
  { key: 'fmax', label: 'F_max', html: 'F<sub>max</sub>', unit: 'N', digits: 4, get: (m) => m.fmaxN },
  { key: 'sigma', label: 'σ_max', html: 'σ<sub>max</sub>', unit: 'kPa', digits: 2, get: (m) => m.sigmaMaxKPa },
  { key: 'w', label: 'W_adh', html: 'W<sub>adh</sub>', unit: 'J/m²', digits: 2, get: (m) => m.wJm2 },
  { key: 'dpeak', label: 'δ_peak', html: 'δ<sub>peak</sub>', unit: 'mm', digits: 3, get: (m) => m.deltaPeakMm },
  { key: 'epsPeak', label: 'ε_peak', html: 'ε<sub>peak</sub>', unit: '–', digits: 3, get: (m) => m.epsPeak },
  { key: 'dmax', label: 'δ_break', html: 'δ<sub>break</sub>', unit: 'mm', digits: 3, get: (m) => m.deltaMaxMm },
  { key: 'eps', label: 'ε_break', html: 'ε<sub>break</sub>', unit: '–', digits: 3, get: (m) => m.epsMax },
  { key: 'plateau', label: 'Plateau stress', html: 'Plateau stress', unit: 'kPa', digits: 2, get: (m) => m.plateau?.stressKPa ?? null },
  { key: 'plen', label: 'Plateau length', html: 'Plateau length', unit: 'mm', digits: 3, get: (m) => m.plateau?.lengthMm ?? null },
];

/** Secondary quantities: Advanced / Diagnostics section only. */
export const DIAG_METRICS: Metric[] = [
  { key: 'k', label: 'k', html: 'k', unit: 'N/mm', digits: 4, get: (m) => m.kNmm },
  { key: 'c', label: 'C', html: 'C', unit: 'mm/N', digits: 3, get: (m) => m.complianceMmN },
  { key: 'eapp', label: 'E_app', html: 'E<sub>app</sub>', unit: 'kPa', digits: 2, get: (m) => m.eAppKPa },
  { key: 'dwStart', label: 'Dwell F start', html: 'Dwell F<sub>start</sub>', unit: 'N', digits: 4, get: (m) => m.dwell?.startN ?? null },
  { key: 'dwEnd', label: 'Dwell F end', html: 'Dwell F<sub>end</sub>', unit: 'N', digits: 4, get: (m) => m.dwell?.endN ?? null },
  { key: 'relax', label: 'Relaxation', html: 'Relaxation', unit: '%', digits: 1, get: (m) => m.dwell?.relaxPct ?? null },
];

export const TACK_METRICS: Metric[] = [...MAIN_METRICS, ...DIAG_METRICS];

export const FAILURE_MODES: { value: TackFailureMode; label: string }[] = [
  { value: '', label: '—' },
  { value: 'interfacial', label: 'Interfacial / adhesive' },
  { value: 'cohesive', label: 'Cohesive' },
  { value: 'cavitation', label: 'Cavitation' },
  { value: 'fibrillation', label: 'Fibrillation' },
  { value: 'cavitation+fibrillation', label: 'Cavitation + fibrillation' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'other', label: 'Other' },
];
export const failureModeLabel = (m: TackFailureMode) => FAILURE_MODES.find((x) => x.value === m)?.label ?? '—';
export const EMPTY_OBSERVATION: TackObservation = { mode: '', note: '', fibrilOnsetMm: null, fibrilMaxMm: null };

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
    f.push({ key: 'resolution', label: 'Low force resolution', detail: `F_max = ${m.peakSteps.toFixed(1)} force steps of ${m.resolutionN!.toFixed(4)} N; stiffness, plateau and relaxation may be approximate.` });
  if (m.incomplete) f.push({ key: 'incomplete', label: 'Incomplete detachment', detail: `Full detachment was not recorded (F never fell to ≤ ${TACK_DEFAULTS.endFraction * 100}% of F_max before the file ended); W_adh is underestimated and δ_break is the end of the data.` });
  if (m.zeroedN !== null) f.push({ key: 'tared', label: 'Load tared after dwell', detail: `Load was reset after dwell (${m.zeroedN.toFixed(4)} N removed); pull force is referenced to the new zero. Preload and relaxation interpretation may be affected.` });
  return f;
}

/** "Cohesive 2 · Fibrillation 1 · not set 3" for a list of runs. */
export function failureModeCounts(runs: TackRun[]): string {
  const counts = new Map<string, number>();
  for (const r of runs) {
    const l = r.obs.mode ? failureModeLabel(r.obs.mode) : 'not set';
    counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (a[0] === 'not set' ? 1 : b[0] === 'not set' ? -1 : 0)).map(([l, n]) => `${l} ${n}`).join(' · ');
}

const cache = new WeakMap<Cycle, { key: string; m: TackMetrics }>();
function metricsOf(c: Cycle, diameterMm: number, h0: number | null): TackMetrics {
  const key = `${diameterMm}|${h0}`;
  const hit = cache.get(c);
  if (hit && hit.key === key) return hit.m;
  const m = analyzeTack(c, { diameterMm, h0Mm: h0 });
  cache.set(c, { key, m });
  return m;
}

/** Test session of a file: its recording date (else its top folder). */
export const sessionOf = (r: CycleResult) => r.cycle.date ?? r.file.path.split('/')[0] ?? '—';

export interface GroupStat {
  key: string;
  label: string;
  substrate: string;
  dwellS: number | null;
  nRepeats: number;
  nRuns: number;
  stats: Record<string, { mean: number; sd: number; n: number }>;
  /** Failure modes of the runs used. */
  modes: string;
}

export function useTackMetrics() {
  const { derived, project, update } = useApp();
  const ex = useExperiment();
  const tm = project.tackMetrics;
  const diameter = project.settings.probe.diameterMm;

  const repeats = useMemo<TackRepeat[]>(() => {
    const inScope = derived.ordered.filter((r) => groupValue(r, 'chargeRatio') === ex.chargeRatio && groupValue(r, 'concentrationM') === ex.concentrationM);
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
        session,
        h0,
        runs: rs.map((r) => ({ id: r.cycle.cycleId, cycle: r.cycle, m: metricsOf(r.cycle, diameter, h0), excluded: tm.excludedRuns[r.cycle.cycleId] ?? null, obs: tm.observations[r.cycle.cycleId] ?? EMPTY_OBSERVATION })),
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
  }, [derived, ex.chargeRatio, ex.concentrationM, tm, diameter]);

  /** Mean ± SD over the runs of each Repeat. */
  const repeatStats = useMemo(
    () => new Map(repeats.map((rp) => [rp.fileId, Object.fromEntries(TACK_METRICS.map((k) => [k.key, meanSd(usedRuns(rp).map((r) => k.get(r.m)))]))])),
    [repeats],
  );

  /** Per condition (substrate × dwell): mean ± SD over the Repeat means of the included Repeats. */
  const conditions = useMemo<GroupStat[]>(() => {
    const groups = new Map<string, TackRepeat[]>();
    for (const rp of repeats.filter((x) => x.included && usedRuns(x).length > 0)) {
      const key = `${rp.substrateLabel.toLowerCase()}|${rp.dwellS ?? '—'}`;
      groups.set(key, [...(groups.get(key) ?? []), rp]);
    }
    return [...groups.entries()].map(([key, list]) => ({
      key,
      label: `${list[0].substrateLabel} · ${list[0].dwellS !== null ? `${list[0].dwellS} s` : 'dwell unknown'}`,
      substrate: list[0].substrateLabel,
      dwellS: list[0].dwellS,
      nRepeats: list.length,
      nRuns: list.reduce((s, rp) => s + usedRuns(rp).length, 0),
      stats: Object.fromEntries(TACK_METRICS.map((k) => [k.key, meanSd(list.map((rp) => repeatStats.get(rp.fileId)![k.key].mean))])),
      modes: failureModeCounts(list.flatMap(usedRuns)),
    }));
  }, [repeats, repeatStats]);

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
  const excludeRun = useCallback(
    (cycleId: string, on: boolean, reason = '') =>
      setTm((t) => {
        const excludedRuns = { ...t.excludedRuns };
        if (on) excludedRuns[cycleId] = { reason, at: excludedRuns[cycleId]?.at ?? now() };
        else delete excludedRuns[cycleId];
        return { ...t, excludedRuns };
      }),
    [setTm],
  );
  const setObservation = useCallback(
    (cycleId: string, patch: Partial<TackObservation>) =>
      setTm((t) => ({ ...t, observations: { ...t.observations, [cycleId]: { ...(t.observations[cycleId] ?? EMPTY_OBSERVATION), ...patch } } })),
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

  return { ex, tm, diameter, repeats, repeatStats, conditions, setH0, excludeRepeat, excludeSession, excludeRun, setObservation, setSubstrate };
}
