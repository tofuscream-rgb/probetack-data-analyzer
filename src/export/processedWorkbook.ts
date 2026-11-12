import { conditionTitle, groupKey, type AnalysisRow } from '../analysis/adhesionReview';
import { mean, sampleSD } from '../analysis/stats';
import { APP_VERSION, GF_TO_N, type ExperimentMode } from '../types';
import { buildXlsx, cellRef, type CellValue, type ChartSpec, type SheetSpec } from './xlsxWriter';

export type SummarySheet = 'run' | 'repeat' | 'condition' | 'gel';

export interface ProcessedRow extends AnalysisRow {
  workPerArea?: number;
}

const sheetName: Record<SummarySheet, string> = { run: 'Per Run', repeat: 'Per Repeat', condition: 'Per Condition', gel: 'Compare Gels' };

function columnsFor(mode: ExperimentMode): { label: string; value: (row: ProcessedRow) => number }[] {
  const peak = mode === 'tack' ? 'Peak adhesion force' : 'Peak load';
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
  const stats = (values: number[]): CellValue[] => [numeric(mean(values)), numeric(sampleSD(values))];
  const byLabel = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const conditions = [...byCondition.values()].map((files) => [...files.values()]
    .sort((a, b) => byLabel(a[0].path, b[0].path)))
    .sort((a, b) => byLabel(conditionTitle(a[0][0]), conditionTitle(b[0][0])));
  const sortedRows = conditions.flatMap((files) => files.flatMap((runs) => [...runs].sort((a, b) => a.number - b.number)));
  const sheets: SheetSpec[] = [];
  const add = (key: SummarySheet, header: string[], data: CellValue[][], widths: number[]) => {
    sheets.push({ name: sheetName[key], rows: [header, ...data], headerRows: 1, colWidths: widths, wrap: true, filter: true });
  };
  const partialWork = (runs: ProcessedRow[]) => runs.some((r) => r.incomplete && Number.isFinite(r.workMJ)) ? 'Includes recorded-end work' : null;

  if (selected.includes('run')) add('run', ['Condition', 'Repeat / source file', 'Run', 'Metric', 'Value', 'Work endpoint'],
    sortedRows.flatMap((r) => columns.map((c) => [
      conditionTitle(r), r.path, r.number, c.label, numeric(c.value(r)),
      c.label.startsWith('Measured work') && Number.isFinite(r.workMJ) ? r.incomplete ? 'Recorded end' : 'Failure / detachment' : null,
    ])), [30, 28, 7, 29, 14, 19]);

  if (selected.includes('repeat')) add('repeat', ['Condition', 'Repeat / source file', 'Metric', 'Mean', 'SD', 'Work note'],
    conditions.flatMap((files) => files.flatMap((runs) => columns.map((c) => [
      conditionTitle(runs[0]), runs[0].path, c.label, ...stats(runs.map(c.value)),
      c.label.startsWith('Measured work') ? partialWork(runs) : null,
    ]))), [30, 28, 29, 13, 13, 18]);

  if (selected.includes('condition')) add('condition', ['Condition', 'Metric', 'Mean', 'SD', 'Work note'],
    conditions.flatMap((files) => columns.map((c) => [
      conditionTitle(files[0][0]), c.label, ...stats(files.map((runs) => mean(runs.map(c.value)))),
      c.label.startsWith('Measured work') ? partialWork(files.flat()) : null,
    ])), [34, 31, 13, 13, 18]);

  if (selected.includes('gel')) {
    const comparison = conditions.map((files) => {
      const { cond, gel } = files[0][0];
      return { files, cond, gel: gel?.trim() || 'Unspecified' };
    }).sort((a, b) =>
      byLabel(a.gel, b.gel) || byLabel(a.cond.substrate, b.cond.substrate) ||
      byLabel(a.cond.concentration, b.cond.concentration) || byLabel(a.cond.hold, b.cond.hold) ||
      byLabel(a.cond.chargeRatio, b.cond.chargeRatio));
    const comparisonRows: CellValue[][] = [[
      'Gel', 'Substrate', 'Charge ratio', 'Concentration (M)', 'Dwell (s)', 'Metric', 'Mean', 'SD', 'Work note',
    ]];
    const charts: ChartSpec[] = [];
    for (const column of columns) {
      const series: ChartSpec['series'] = [];
      let group = '';
      for (const { files, cond, gel } of comparison) {
        const concentration = cond.concentration === '—' ? '—' : cond.concentrationDefault ? cond.concentration + ' (assumed)' : Number(cond.concentration);
        const ratio = cond.chargeRatio === '—' ? null : numeric(Number(cond.chargeRatio));
        const dwell = cond.hold === '—' ? null : numeric(Number(cond.hold));
        const [avg, sd] = stats(files.map((runs) => mean(runs.map(column.value))));
        const row = comparisonRows.length;
        comparisonRows.push([gel, cond.substrate, ratio, concentration, dwell, column.label, avg, sd,
          column.label.startsWith('Measured work') ? partialWork(files.flat()) : null]);
        if (ratio === null || typeof avg !== 'number') {
          group = '';
          continue;
        }
        const label = [gel, cond.substrate, concentration + ' M', dwell === null ? 'dwell unknown' : dwell + ' s'].join(' · ');
        if (label !== group) {
          group = label;
          series.push({ name: label, xRange: [cellRef(2, row), cellRef(2, row)], yRange: [cellRef(6, row), cellRef(6, row)], xValues: [], yValues: [] });
        }
        const line = series[series.length - 1];
        line.xRange[1] = cellRef(2, row);
        line.yRange[1] = cellRef(6, row);
        line.xValues.push(ratio);
        line.yValues.push(avg);
      }
      if (column.label.endsWith(' (gf)') || !series.length) continue;
      for (const line of series) if (line.xValues.length === 1) line.markerOnly = true;
      // Anchors are set after all metric rows are written.
      charts.push({ title: column.label, xTitle: 'Charge ratio', yTitle: column.label, series, from: { col: 0, row: 0 }, to: { col: 8, row: 0 } });
    }
    charts.forEach((chart, i) => {
      chart.from.row = comparisonRows.length + 2 + i * 20;
      chart.to.row = chart.from.row + 18;
    });
    sheets.push({ name: sheetName.gel, rows: comparisonRows, headerRows: 1, colWidths: [17, 13, 11, 13, 9, 29, 12, 12, 13], wrap: true, filter: true, charts });
  }
  return sheets;
}

export function buildProcessedWorkbook(projectName: string, mode: ExperimentMode, rows: ProcessedRow[], selected: SummarySheet[], graph?: SheetSpec): Uint8Array {
  const sheets = processedSheets(mode, rows, selected);
  if (graph) sheets.push(graph);
  return buildXlsx(sheets, { title: projectName, creator: `Mach-1 Analyzer ${APP_VERSION}` });
}
