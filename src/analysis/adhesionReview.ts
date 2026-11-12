import type { PeelRun } from '../state/peel';
import type { LapShearRun } from '../state/lapShear';
import { modifiedZScores } from './stats';
import type { RunCondition } from './runCompare';
import type { CycleOutlierSettings, QCClass } from '../types';

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
}

export const groupKey = ({ cond: c, gel }: AnalysisRow) => JSON.stringify([
  c.substrate.trim().toLowerCase(), c.chargeRatio, c.concentration, c.hold, gel?.trim().toLowerCase() || null,
]);

export function conditionTitle({ cond: c, gel }: AnalysisRow) {
  return [
    c.substrate === '—' ? 'Substrate unknown' : c.substrate.trim(),
    c.chargeRatio === '—' ? 'Charge ratio unknown' : `CR ${c.chargeRatio}`,
    c.concentration === '—' ? 'Concentration unknown' : `${c.concentration} M${c.concentrationDefault ? ' (assumed)' : ''}`,
    gel,
    c.hold === '—' ? 'Holding time unknown' : `${c.hold} s holding time`,
  ].filter(Boolean).join(' · ');
}

export function reviewGroups(rows: AnalysisRow[], qc: CycleOutlierSettings, exclude: QCClass[]) {
  const grouped = new Map<string, AnalysisRow[]>();
  for (const row of rows) {
    const key = groupKey(row);
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }
  return [...grouped].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })).map(([key, list]) => {
    const valid = list.filter((r) => Number.isFinite(r.primary));
    const result = valid.length >= qc.minGroupSize ? modifiedZScores(valid.map((r) => r.primary)) : null;
    const scores = new Map(valid.map((r, i) => [r.id, result?.z[i] ?? null]));
    return {
      key, title: conditionTitle(list[0]), method: result?.method, valid: valid.length,
      runs: list.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }) || a.number - b.number).map((row) => {
        const z = scores.get(row.id) ?? null;
        const a = Math.abs(z ?? 0);
        const flag: QCClass = a >= qc.modZRed ? 'red' : a >= qc.modZOrange ? 'orange' : a >= qc.modZYellow ? 'yellow' : 'green';
        return { row, z, flag, automatic: Number.isFinite(row.primary) && !exclude.includes(flag) };
      }),
    };
  });
}

export function includedRuns(rows: AnalysisRow[], qc: CycleOutlierSettings, exclude: QCClass[], inclusion: Record<string, boolean>): Set<string> {
  return new Set(reviewGroups(rows, qc, exclude).flatMap((group) => group.runs
    .filter(({ row, automatic }) => Number.isFinite(row.primary) && (inclusion[row.id] ?? automatic))
    .map(({ row }) => row.id)));
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
    incomplete: r.result.ok && r.result.work.toDetachMJ === null,
    note: [r.result.error, ...r.result.warnings].filter(Boolean).join(' · '),
  };
}
