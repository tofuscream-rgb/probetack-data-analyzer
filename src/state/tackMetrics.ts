/**
 * Tack metrics tab: per-run metrics for every file (Repeat) of the chosen charge ratio and
 * concentration (all substrates and dwell times), mean ± SD per Repeat and per condition
 * (substrate × dwell), and exclusions of whole Repeats or test sessions.
 */
import { useCallback, useMemo } from 'react';
import { useApp } from './AppContext';
import { uniqueFileNames, useExperiment } from './experiment';
import { groupValue, type CycleResult } from '../analysis/engine';
import { analyzeTack, meanSd, type TackMetrics } from '../analysis/tackMetrics';
import { bySubstrate, canonicalSubstrate } from '../analysis/substrates';
import type { Cycle, DatasetExclusion, ParsedFile, TackMetricsState } from '../types';

export interface TackRun {
  id: string;
  cycle: Cycle;
  m: TackMetrics;
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
  label: string;
  unit: string;
  digits: number;
  get: (m: TackMetrics) => number | null;
}

export const TACK_METRICS: Metric[] = [
  { key: 'fmax', label: 'F_max', unit: 'N', digits: 4, get: (m) => m.fmaxN },
  { key: 'sigma', label: 'σ_max', unit: 'kPa', digits: 2, get: (m) => m.sigmaMaxKPa },
  { key: 'w', label: 'W', unit: 'J/m²', digits: 2, get: (m) => m.wJm2 },
  { key: 'dpeak', label: 'δ_peak', unit: 'mm', digits: 3, get: (m) => m.deltaPeakMm },
  { key: 'dmax', label: 'δ_max', unit: 'mm', digits: 3, get: (m) => m.deltaMaxMm },
  { key: 'eps', label: 'ε_max', unit: '–', digits: 3, get: (m) => m.epsMax },
  { key: 'k', label: 'k', unit: 'N/mm', digits: 4, get: (m) => m.kNmm },
  { key: 'c', label: 'C', unit: 'mm/N', digits: 3, get: (m) => m.complianceMmN },
  { key: 'eapp', label: 'E_app', unit: 'kPa', digits: 2, get: (m) => m.eAppKPa },
  { key: 'plateau', label: 'Plateau stress', unit: 'kPa', digits: 2, get: (m) => m.plateau?.stressKPa ?? null },
  { key: 'plen', label: 'Plateau length', unit: 'mm', digits: 3, get: (m) => m.plateau?.lengthMm ?? null },
  { key: 'dwStart', label: 'Dwell F start', unit: 'N', digits: 4, get: (m) => m.dwell?.startN ?? null },
  { key: 'dwEnd', label: 'Dwell F end', unit: 'N', digits: 4, get: (m) => m.dwell?.endN ?? null },
  { key: 'relax', label: 'Relaxation', unit: '%', digits: 1, get: (m) => m.dwell?.relaxPct ?? null },
];

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
        runs: rs.map((r) => ({ id: r.cycle.cycleId, cycle: r.cycle, m: metricsOf(r.cycle, diameter, h0) })),
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
    () => new Map(repeats.map((rp) => [rp.fileId, Object.fromEntries(TACK_METRICS.map((k) => [k.key, meanSd(rp.runs.filter((r) => r.m.ok).map((r) => k.get(r.m)))]))])),
    [repeats],
  );

  /** Per condition (substrate × dwell): mean ± SD over the Repeat means of the included Repeats. */
  const conditions = useMemo<GroupStat[]>(() => {
    const groups = new Map<string, TackRepeat[]>();
    for (const rp of repeats.filter((x) => x.included)) {
      const key = `${rp.substrateLabel.toLowerCase()}|${rp.dwellS ?? '—'}`;
      groups.set(key, [...(groups.get(key) ?? []), rp]);
    }
    return [...groups.entries()].map(([key, list]) => ({
      key,
      label: `${list[0].substrateLabel} · ${list[0].dwellS !== null ? `${list[0].dwellS} s` : 'dwell unknown'}`,
      substrate: list[0].substrateLabel,
      dwellS: list[0].dwellS,
      nRepeats: list.length,
      nRuns: list.reduce((s, rp) => s + rp.runs.filter((r) => r.m.ok).length, 0),
      stats: Object.fromEntries(TACK_METRICS.map((k) => [k.key, meanSd(list.map((rp) => repeatStats.get(rp.fileId)![k.key].mean))])),
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
  const setSubstrate = useCallback(
    (fileId: string, v: string | null) =>
      update((p) => {
        const ov = { ...(p.overrides[fileId] ?? {}) };
        if (v === null) delete ov.substrate; else ov.substrate = v;
        return { ...p, overrides: { ...p.overrides, [fileId]: ov } };
      }),
    [update],
  );

  return { ex, tm, diameter, repeats, repeatStats, conditions, setH0, excludeRepeat, excludeSession, setSubstrate };
}
