import type { PeelRun } from '../state/peel';
import type { LapShearRun } from '../state/lapShear';
import type { RunCondition } from './runCompare';

export interface AnalysisRow {
  id: string;
  fileId: string;
  path: string;
  name: string;
  number: number;
  cond: RunCondition;
  gel: string | null;
  primary: number;
  peakN: number;
  normalized: number;
  workMJ: number;
  incomplete: boolean;
  note: string;
  /** 90° Peel: CV of the force in the steady-state window, in % (stick–slip screening). */
  cvPct?: number;
}

export const groupKey = ({ cond: c, gel }: AnalysisRow) => JSON.stringify([
  c.substrate.trim().toLowerCase(), c.chargeRatio, c.concentration, c.hold, gel?.trim().toLowerCase() || null,
]);

export function conditionTitle({ cond: c, gel }: AnalysisRow) {
  return [
    c.substrate === '—' ? 'Substrate unknown' : c.substrate.trim(),
    c.chargeRatio === '—' ? 'Charge ratio unknown' : `CR ${c.chargeRatio}`,
    c.concentration === '—' ? 'Concentration unknown' : `${c.concentration} M${c.concentrationDefault ? ' (assumed)' : ''}`,
    gel?.trim() || null,
    c.hold === '—' ? null : `${c.hold} s dwell`,
  ].filter(Boolean).join(' · ');
}

/**
 * Condition groups of Lap Shear and 90° Peel runs. These tests usually have only one or two
 * runs per file and few repeats, too few for a modified Z-score, so runs are not scored:
 * every valid run is included unless the user leaves it out (In average).
 */
export function reviewGroups(rows: AnalysisRow[]) {
  const grouped = new Map<string, AnalysisRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  return [...grouped].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([key, list]) => ({
    key, title: conditionTitle(list[0]),
    runs: list.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }) || a.number - b.number)
      .map((row) => ({ row, automatic: Number.isFinite(row.primary) })),
  }));
}

export function includedRuns(rows: AnalysisRow[], inclusion: Record<string, boolean>): Set<string> {
  return new Set(rows.filter((row) => Number.isFinite(row.primary) && (inclusion[row.id] ?? true)).map((row) => row.id));
}

export function lapShearAnalysisRow(r: LapShearRun, gel: string | null): AnalysisRow {
  return {
    id: r.id, fileId: r.file.fileId, path: r.file.path, name: r.file.name, number: r.cycle.cycleNumber,
    cond: r.cond.hold === '—' && r.cycle.holdTimeS !== null ? { ...r.cond, hold: String(r.cycle.holdTimeS) } : r.cond,
    gel,
    primary: r.result.peak?.forceN ?? NaN,
    peakN: r.result.peak?.forceN ?? NaN,
    normalized: r.result.strengthKPa,
    workMJ: r.result.work.toFailureMJ ?? r.result.work.fullMJ,
    incomplete: r.result.ok && r.result.work.toFailureMJ === null,
    note: [r.result.error, ...r.result.warnings].filter(Boolean).join(' · '),
  };
}

export function peelAnalysisRow(r: PeelRun, gel: string | null): AnalysisRow {
  return {
    id: r.id, fileId: r.file.fileId, path: r.file.path, name: r.file.name, number: r.cycle.cycleNumber,
    cond: r.cond.hold === '—' && r.cycle.holdTimeS !== null ? { ...r.cond, hold: String(r.cycle.holdTimeS) } : r.cond,
    gel,
    primary: r.result.plateau.meanN,
    peakN: r.result.peak?.forceN ?? NaN,
    normalized: r.result.toughnessJm2,
    workMJ: r.result.work.toDetachMJ ?? r.result.work.fullMJ,
    cvPct: r.result.plateau.cv * 100,
    incomplete: r.result.ok && r.result.work.toDetachMJ === null,
    note: [r.result.error, ...r.result.warnings].filter(Boolean).join(' · '),
  };
}
