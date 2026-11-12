import { conditionTitle, groupKey, type AnalysisRow } from '../analysis/adhesionReview';
import { mean, sampleSD } from '../analysis/stats';
import { APP_VERSION, GF_TO_N, type ExperimentMode } from '../types';
import { buildXlsx, type CellValue, type SheetSpec } from './xlsxWriter';

export type SummarySheet = 'run' | 'repeat' | 'condition';

export interface ProcessedRow extends AnalysisRow {
  workPerArea?: number;
}

const sheetName: Record<SummarySheet, string> = { run: 'Per run', repeat: 'Per repeat', condition: 'Per condition' };

function columnsFor(mode: ExperimentMode): { label: string; value: (row: ProcessedRow) => number }[] {
  const peak = mode === 'tack' ? 'Peak tensile force' : 'Peak load';
  const columns = [
    { label: peak + ' (gf)', value: (r: ProcessedRow) => r.peakN / GF_TO_N },
    { label: peak + ' (N)', value: (r: ProcessedRow) => r.peakN },
    { label: 'Measured work Wadh (mJ)', value: (r: ProcessedRow) => r.workMJ },
  ];
  if (mode === 'peel') return [
    ...columns,
    { label: 'Steady-state peel force (gf)', value: (r) => r.primary / GF_TO_N },
    { label: 'Steady-state peel force (N)', value: (r) => r.primary },
    { label: 'Steady-state peel energy (J/m²)', value: (r) => r.normalized },
  ];
  return [
    ...columns,
    { label: mode === 'tack' ? 'Peak nominal tensile stress (kPa)' : 'Apparent nominal lap-shear strength (kPa)', value: (r) => r.normalized },
    { label: 'Apparent work per initial area (J/m²)', value: (r) => r.workPerArea ?? NaN },
  ];
}

const numeric = (value: number) => Number.isFinite(value) ? value : null;

export function processedSheets(mode: ExperimentMode, rows: ProcessedRow[], selected: SummarySheet[]): SheetSpec[] {
  const columns = columnsFor(mode);
  const byCondition = new Map<string, Map<string, ProcessedRow[]>>();
  for (const row of rows) {
    const key = groupKey(row);
    const repeats = byCondition.get(key) ?? new Map<string, ProcessedRow[]>();
    const repeat = repeats.get(row.fileId) ?? [];
    repeat.push(row);
    repeats.set(row.fileId, repeat);
    byCondition.set(key, repeats);
  }
  const summaryHeaders = columns.flatMap(({ label }) => [label + ' mean', label + ' SD', label + ' n']);
  const stats = (values: number[]): CellValue[] => [numeric(mean(values)), numeric(sampleSD(values)), values.filter(Number.isFinite).length];
  const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const conditions = [...byCondition.values()].map((files) => [...files.values()]
    .sort((a, b) => byLabel(a[0].path, b[0].path)))
    .sort((a, b) => byLabel(conditionTitle(a[0][0]), conditionTitle(b[0][0])));
  const sortedRows = conditions.flatMap((files) => files.flatMap((runs) => [...runs].sort((a, b) => a.number - b.number)));
  const sheets: SheetSpec[] = [];
  const add = (key: SummarySheet, header: string[], data: CellValue[][], widths: number[]) => {
    if (selected.includes(key)) sheets.push({ name: sheetName[key], rows: [header, ...data], headerRows: 1, colWidths: widths });
  };

  if (selected.includes('run')) add('run', ['Condition', 'Repeat / source file', 'Run', ...columns.map((c) => c.label), 'Work endpoint'],
    sortedRows.map((r) => [conditionTitle(r), r.path, r.number, ...columns.map((c) => numeric(c.value(r))),
      !Number.isFinite(r.workMJ) ? null : r.incomplete ? 'Recorded end only' : 'Failure / detachment']),
    [46, 44, 9, ...columns.map(() => 32), 24]);

  if (selected.includes('repeat')) add('repeat', ['Condition', 'Repeat / source file', 'Included runs', 'Work to recorded end (runs)', ...summaryHeaders],
    conditions.flatMap((files) => files.map((runs) => [
      conditionTitle(runs[0]), runs[0].path, runs.length, runs.filter((r) => r.incomplete && Number.isFinite(r.workMJ)).length,
      ...columns.flatMap((c) => stats(runs.map(c.value))),
    ])), [46, 44, 16, 27, ...columns.flatMap(() => [32, 32, 23])]);

  if (selected.includes('condition')) add('condition', ['Condition', 'Included repeats', 'Included runs', 'Work to recorded end (runs)', ...summaryHeaders],
    conditions.map((files) => [
      conditionTitle(files[0][0]), files.length, files.reduce((n, runs) => n + runs.length, 0),
      files.flat().filter((r) => r.incomplete && Number.isFinite(r.workMJ)).length,
      ...columns.flatMap((c) => stats(files.map((runs) => mean(runs.map(c.value))))),
    ]), [46, 18, 16, 27, ...columns.flatMap(() => [32, 32, 23])]);

  return sheets;
}

export function buildProcessedWorkbook(projectName: string, mode: ExperimentMode, rows: ProcessedRow[], selected: SummarySheet[]): Uint8Array {
  return buildXlsx(processedSheets(mode, rows, selected), { title: projectName, creator: `Mach-1 Analyzer ${APP_VERSION}` });
}
