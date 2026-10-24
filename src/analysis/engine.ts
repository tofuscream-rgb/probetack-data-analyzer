/**
 * Ties parsing results, user decisions and settings together into derived
 * results. Pure functions: the same inputs and settings always give the same
 * numbers (no randomness, stable ordering).
 */
import type {
  AnalysisSettings,
  Cycle,
  ExperimentMeta,
  GroupKey,
  ManualExclusion,
  ParsedFile,
  ProjectState,
  QCClass,
} from '../types';
import { computeBaseline, computeMetrics, peakValue, referenceLevel, type Metrics } from './cycleMetrics';
import { QC_ORDER, scorePoints, type PointScores } from './pointOutliers';
import { coefficientOfVariation, mean, median, modifiedZScores, resolutionStep, sampleSD } from './stats';

export interface CycleFlag {
  code: 'noData' | 'incomplete' | 'positiveOnly' | 'missingPeak' | 'weak' | 'modZ' | 'smallGroup' | 'repeatDiff' | 'pointFlags' | 'startOffset' | 'notDetached';
  cls: QCClass;
  message: string;
}

export interface CycleResult {
  cycle: Cycle;
  meta: ExperimentMeta;
  file: ParsedFile;
  holdTimeS: number | null;
  baseline: number | null;
  baselineNote: string;
  raw: Metrics;
  processed: Metrics;
  peakRaw: number;
  peakProcessed: number;
  points: PointScores;
  include: Uint8Array; // 1 = retained in processed data
  excludedByRule: number;
  excludedManual: number;
  cycleExcluded: ManualExclusion | null;
  flags: CycleFlag[];
  qc: QCClass;
  cycleScore: number;
  modZ: number | null;
  conditionKey: string;
  travelFraction: number | null;
}

export interface GroupStats {
  key: string;
  label: Record<GroupKey, string>;
  cycleIds: string[];
  nCycles: number;
  mean: number;
  median: number;
  sd: number;
  cv: number;
  nRuns: number;
  runMean: number;
  runSD: number;
  runCV: number;
  mixedConcentration: boolean;
}

export interface Derived {
  files: ParsedFile[];
  results: Map<string, CycleResult>;
  ordered: CycleResult[];
  groups: GroupStats[];
}

export const GROUP_LABEL: Record<GroupKey, string> = {
  chargeRatio: 'Charge ratio',
  concentrationM: 'Concentration (M)',
  gel: 'Gel',
  substrate: 'Substrate',
  holdTimeS: 'Holding time (s)',
  amplitudeMm: 'Move amplitude (mm)',
  velocityMmS: 'Velocity (mm/s)',
};

export function groupValue(r: Pick<CycleResult, 'meta' | 'cycle' | 'holdTimeS'>, k: GroupKey): string {
  switch (k) {
    case 'chargeRatio':
      return r.meta.chargeRatio.value === null ? '—' : String(r.meta.chargeRatio.value);
    case 'concentrationM':
      return r.meta.concentrationM.value === null ? '—' : String(r.meta.concentrationM.value);
    case 'gel':
      return r.meta.gel.value ?? '—';
    case 'substrate':
      return r.meta.substrate.value ?? '—';
    case 'holdTimeS':
      return r.holdTimeS === null ? '—' : String(r.holdTimeS);
    case 'amplitudeMm':
      return r.cycle.amplitudeMm === null ? '—' : String(r.cycle.amplitudeMm);
    case 'velocityMmS':
      return r.cycle.velocityMmS === null ? '—' : String(r.cycle.velocityMmS);
  }
}

const worst = (a: QCClass, b: QCClass): QCClass => (QC_ORDER.indexOf(a) >= QC_ORDER.indexOf(b) ? a : b);

// Cache of point scores keyed by cycle and settings: scoring is the slowest step.
const pointCache = new Map<string, PointScores>();

export function getPointScores(c: Cycle, s: AnalysisSettings): PointScores {
  const key = `${c.cycleId}|${JSON.stringify(s.point)}`;
  let p = pointCache.get(key);
  if (!p) {
    p = scorePoints(c.force_gf, s.point);
    if (pointCache.size > 5000) pointCache.clear();
    pointCache.set(key, p);
  }
  return p;
}

export function computeDerived(
  files: ParsedFile[],
  cyclesByFile: Map<string, Cycle[]>,
  metaByFile: Map<string, ExperimentMeta>,
  project: Pick<ProjectState, 'settings' | 'excludedCycles' | 'excludedPoints' | 'groupBy'>,
): Derived {
  const s = project.settings;
  const results = new Map<string, CycleResult>();
  const ordered: CycleResult[] = [];

  for (const file of files) {
    const meta = metaByFile.get(file.fileId);
    const cycles = cyclesByFile.get(file.fileId) ?? [];
    if (!meta) continue;
    for (const cycle of cycles) {
      const points = getPointScores(cycle, s);
      const n = cycle.force_gf.length;
      const include = new Uint8Array(n);
      const manual = project.excludedPoints[cycle.cycleId] ?? {};
      let byRule = 0;
      let byManual = 0;
      for (let i = 0; i < n; i++) {
        const cls = points.cls[i];
        const ruleOut = (s.exclusionRule === 'excludeRed' && cls === 3) || (s.exclusionRule === 'excludeYellowUp' && cls >= 1);
        const manualOut = manual[String(i)] !== undefined;
        if (ruleOut) byRule++;
        else if (manualOut) byManual++;
        include[i] = ruleOut || manualOut ? 0 : 1;
      }
      const bl = computeBaseline(cycle, s);
      const raw = computeMetrics(cycle, s, bl.value);
      const processed = computeMetrics(cycle, s, bl.value, include as unknown as ArrayLike<boolean>);
      const holdTimeS = cycle.holdTimeS ?? meta.nominalHoldS.value;
      const r: CycleResult = {
        cycle,
        meta,
        file,
        holdTimeS,
        baseline: bl.value,
        baselineNote: bl.note,
        raw,
        processed,
        peakRaw: peakValue(raw, s.peakMetric),
        peakProcessed: peakValue(processed, s.peakMetric),
        points,
        include,
        excludedByRule: byRule,
        excludedManual: byManual,
        cycleExcluded: project.excludedCycles[cycle.cycleId] ?? null,
        flags: [],
        qc: 'green',
        cycleScore: 0,
        modZ: null,
        conditionKey: '',
        travelFraction: null,
      };
      r.conditionKey = s.cycle.compareBy.map((k) => groupValue(r, k)).join(' | ');
      applyIntrinsicFlags(r, s);
      results.set(cycle.cycleId, r);
      ordered.push(r);
    }
  }

  applyGroupFlags(ordered, s);
  applyStartPositionFlags(ordered, s);
  for (const r of ordered) {
    r.qc = r.flags.reduce<QCClass>((acc, f) => worst(acc, f.cls), 'green');
  }
  const groups = computeGroups(ordered, project.groupBy);
  return { files, results, ordered, groups };
}

function severityScore(cls: QCClass): number {
  return { green: 0, yellow: 0.4, orange: 0.7, red: 1 }[cls];
}

function addFlag(r: CycleResult, f: CycleFlag) {
  r.flags.push(f);
  r.cycleScore = Math.max(r.cycleScore, severityScore(f.cls));
}

/** Checks that need only the cycle itself. */
function applyIntrinsicFlags(r: CycleResult, s: AnalysisSettings) {
  const c = r.cycle;
  if (c.force_gf.length === 0) {
    addFlag(r, { code: 'noData', cls: 'red', message: 'No force data in this movement; no peak can be calculated.' });
    return;
  }
  if (c.amplitudeMm !== null && c.z_mm.length > 1 && c.amplitudeMm !== 0) {
    const travel = Math.abs(c.z_mm[c.z_mm.length - 1] - c.z_mm[0]);
    r.travelFraction = travel / Math.abs(c.amplitudeMm);
    if (r.travelFraction < s.cycle.completeFraction) {
      addFlag(r, {
        code: 'incomplete',
        cls: 'red',
        message: `Incomplete measurement: the stage travelled ${travel.toFixed(3)} mm of the commanded ${Math.abs(c.amplitudeMm)} mm (${(r.travelFraction * 100).toFixed(0)}%).`,
      });
    }
  }
  const expectNegative = s.peakMetric === 'min' || s.peakMetric === 'baselineMin';
  const step = resolutionStep(c.force_gf);
  const ref = referenceLevel(c, r.baseline);
  if (expectNegative) {
    if (r.raw.min >= 0) {
      addFlag(r, {
        code: 'positiveOnly',
        cls: 'red',
        message: `Unexpected positive-only response: the force never became negative (minimum ${r.raw.min.toFixed(2)} gf). Possible missed contact or detached specimen.`,
      });
    } else if (Number.isFinite(step) && ref - r.raw.min < s.cycle.noPeakSteps * step) {
      addFlag(r, {
        code: 'missingPeak',
        cls: 'red',
        message: `Missing mechanical peak: the minimum is within ${s.cycle.noPeakSteps} force-resolution steps (${(s.cycle.noPeakSteps * step).toFixed(2)} gf) of the reference level ${ref.toFixed(2)} gf.`,
      });
    }
  }
  // Informational: did the force return to the reference level by the end of the movement?
  if (expectNegative && r.raw.min < 0) {
    const depth = ref - r.raw.min;
    const last = c.force_gf[c.force_gf.length - 1];
    if (depth > 0 && ref - last > 0.25 * depth) {
      addFlag(r, {
        code: 'notDetached',
        cls: 'green',
        message: `Force had not returned to the reference level when the movement ended (last value ${last.toFixed(2)} gf vs peak ${r.raw.min.toFixed(2)} gf). The specimen may still have been attached; the peak is captured, but full detachment is not.`,
      });
    }
  }
  const pc = r.points.counts;
  if (pc[3] > 0 || pc[2] > 0) {
    addFlag(r, {
      code: 'pointFlags',
      cls: 'yellow',
      message: `${pc[3]} red and ${pc[2]} orange point(s) inside this curve (Level A screening).`,
    });
  }
}

/** Checks that compare a cycle with equivalent cycles (same condition key). */
function applyGroupFlags(all: CycleResult[], s: AnalysisSettings) {
  const byCond = new Map<string, CycleResult[]>();
  for (const r of all) {
    if (r.cycleExcluded || !Number.isFinite(r.peakProcessed)) continue;
    const list = byCond.get(r.conditionKey) ?? [];
    list.push(r);
    byCond.set(r.conditionKey, list);
  }
  const expectNegative = s.peakMetric === 'min' || s.peakMetric === 'baselineMin';

  for (const [, list] of byCond) {
    const peaks = list.map((r) => r.peakProcessed);
    const medPeak = median(peaks);

    // Weak response relative to the condition median (depth relative to reference level).
    if (list.length >= 2) {
      const depth = (r: CycleResult) =>
        expectNegative ? referenceLevel(r.cycle, r.baseline) - r.raw.min : Math.abs(r.peakProcessed);
      const medDepth = median(list.map(depth));
      for (const r of list) {
        const d = depth(r);
        if (medDepth > 0 && d >= 0 && d < s.cycle.weakFraction * medDepth && !r.flags.some((f) => f.code === 'positiveOnly' || f.code === 'missingPeak')) {
          addFlag(r, {
            code: 'weak',
            cls: 'orange',
            message: `Weak response: peak depth ${d.toFixed(2)} gf is below ${(s.cycle.weakFraction * 100).toFixed(0)}% of the condition median (${medDepth.toFixed(2)} gf).`,
          });
        }
      }
    }

    if (list.length < s.cycle.minGroupSize) {
      for (const r of list) {
        addFlag(r, {
          code: 'smallGroup',
          cls: 'green',
          message: `Only ${list.length} run(s) in this condition; modified Z-scores need at least ${s.cycle.minGroupSize}.`,
        });
      }
    } else {
      const mz = modifiedZScores(peaks);
      list.forEach((r, i) => {
        const z = mz.z[i];
        r.modZ = Number.isFinite(z) ? z : z > 0 ? 99 : -99;
        const az = Math.abs(z);
        const cls: QCClass = az >= s.cycle.modZRed ? 'red' : az >= s.cycle.modZOrange ? 'orange' : az >= s.cycle.modZYellow ? 'yellow' : 'green';
        if (cls !== 'green') {
          addFlag(r, {
            code: 'modZ',
            cls,
            message: `Peak ${r.peakProcessed.toFixed(2)} gf vs condition median ${medPeak.toFixed(2)} gf: modified Z = ${Number.isFinite(z) ? z.toFixed(2) : '∞'} (${mz.method}, n = ${list.length}).`,
          });
        }
      });
    }

    // Large differences between repeat files within the same condition.
    const byFile = new Map<string, number[]>();
    for (const r of list) {
      const arr = byFile.get(r.file.fileId) ?? [];
      arr.push(r.peakProcessed);
      byFile.set(r.file.fileId, arr);
    }
    if (byFile.size >= 2) {
      const fileMedians = new Map([...byFile].map(([id, v]) => [id, median(v)]));
      for (const r of list) {
        const fm = fileMedians.get(r.file.fileId)!;
        // Compare with the median of the OTHER repeat files in this condition.
        const others = median([...fileMedians].filter(([id]) => id !== r.file.fileId).map(([, v]) => v));
        const rel = others !== 0 ? Math.abs(fm - others) / Math.abs(others) : 0;
        if (rel > s.cycle.repeatDiffFraction) {
          // Informational: a file-level difference should not colour every cycle in both files.
          addFlag(r, {
            code: 'repeatDiff',
            cls: 'green',
            message: `Repeat "${r.file.name}" has median peak ${fm.toFixed(2)} gf, ${(rel * 100).toFixed(0)}% different from the other repeat(s) in this condition (median ${others.toFixed(2)} gf).`,
          });
        }
      }
    }
  }
}

/**
 * A movement that starts displaced from the previous movement's start, in the
 * same direction as the travel (e.g. lower z for a negative amplitude),
 * suggests the probe did not re-approach the specimen. Seen in real data:
 * failed cycles started ~2.2 mm lower, directly after a previous pull.
 * Shifts in the opposite direction (deliberate repositioning) are not flagged.
 */
function applyStartPositionFlags(all: CycleResult[], s: AnalysisSettings) {
  if (!(s.cycle.startOffsetMm > 0)) return;
  const byFile = new Map<string, CycleResult[]>();
  for (const r of all) if (r.cycle.z_mm.length) byFile.set(r.file.fileId, [...(byFile.get(r.file.fileId) ?? []), r]);
  for (const list of byFile.values()) {
    for (let i = 1; i < list.length; i++) {
      const r = list[i];
      const prev = list[i - 1];
      const d = r.cycle.z_mm[0] - prev.cycle.z_mm[0];
      const dir = Math.sign(r.cycle.amplitudeMm ?? 0);
      if (dir !== 0 && Math.sign(d) === dir && Math.abs(d) > s.cycle.startOffsetMm) {
        addFlag(r, {
          code: 'startOffset',
          cls: 'orange',
          message: `Movement started at z = ${r.cycle.z_mm[0].toFixed(3)} mm, ${Math.abs(d).toFixed(2)} mm beyond the previous run's start (${prev.cycle.z_mm[0].toFixed(3)} mm) in the travel direction. The probe may not have re-approached the specimen.`,
        });
      }
    }
  }
}

export function computeGroups(all: CycleResult[], groupBy: GroupKey[]): GroupStats[] {
  // Concentration is always part of the key so different concentrations are never merged silently.
  const keys: GroupKey[] = groupBy.includes('concentrationM') ? groupBy : [...groupBy, 'concentrationM'];
  const map = new Map<string, CycleResult[]>();
  for (const r of all) {
    if (r.cycleExcluded || !Number.isFinite(r.peakProcessed)) continue;
    const key = keys.map((k) => groupValue(r, k)).join(' | ');
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  const out: GroupStats[] = [];
  for (const [key, list] of map) {
    const peaks = list.map((r) => r.peakProcessed);
    const byFile = new Map<string, number[]>();
    for (const r of list) {
      const arr = byFile.get(r.file.fileId) ?? [];
      arr.push(r.peakProcessed);
      byFile.set(r.file.fileId, arr);
    }
    const runMeans = [...byFile.values()].map((v) => mean(v));
    const label = Object.fromEntries(
      (Object.keys(GROUP_LABEL) as GroupKey[]).map((k) => [k, keys.includes(k) ? groupValue(list[0], k) : '(pooled)']),
    ) as Record<GroupKey, string>;
    const concs = new Set(list.map((r) => groupValue(r, 'concentrationM')));
    out.push({
      key,
      label,
      cycleIds: list.map((r) => r.cycle.cycleId),
      nCycles: list.length,
      mean: mean(peaks),
      median: median(peaks),
      sd: sampleSD(peaks),
      cv: coefficientOfVariation(peaks),
      nRuns: byFile.size,
      runMean: mean(runMeans),
      runSD: sampleSD(runMeans),
      runCV: coefficientOfVariation(runMeans),
      mixedConcentration: concs.size > 1,
    });
  }
  out.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
  return out;
}
