import { groupKey, type AnalysisRow } from '../analysis/adhesionReview';
import { bySubstrate } from '../analysis/substrates';
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
    { label: 'Steady-state force CV (%)', value: (r) => r.cvPct ?? NaN },
    { label: 'Steady-state peel energy (J/m²)', value: (r) => r.normalized },
  ];
  return [
    ...columns,
    { label: mode === 'tack' ? 'Peak nominal tensile stress (kPa)' : 'Apparent nominal lap-shear strength (kPa)', value: (r) => r.normalized },
    { label: 'Apparent work per initial area (J/m²)', value: (r) => r.workPerArea ?? NaN },
  ];
}

const numeric = (value: number) => Number.isFinite(value) ? value : null;
const numberOf = (v: string) => (v === '—' ? null : numeric(Number(v)));

/** Condition order inside each metric: charge ratio, concentration, gel, substrate, dwell time (numbers by value). */
function compareConditions(a: ProcessedRow, b: ProcessedRow): number {
  const num = (x: string, y: string) => (x === '—' || y === '—' ? (x === y ? 0 : x === '—' ? 1 : -1) : Number(x) - Number(y) || x.localeCompare(y));
  return num(a.cond.chargeRatio, b.cond.chargeRatio) || num(a.cond.concentration, b.cond.concentration)
    || (a.gel ?? '').localeCompare(b.gel ?? '', undefined, { numeric: true })
    || bySubstrate(a.cond.substrate.trim(), b.cond.substrate.trim()) || num(a.cond.hold, b.cond.hold);
}

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
    .map((runs) => [...runs].sort((a, b) => a.number - b.number))
    .sort((a, b) => byLabel(a[0].path, b[0].path)))
    .sort((a, b) => compareConditions(a[0][0], b[0][0]));
  const hasGel = rows.some((r) => r.gel?.trim());
  // Conditions as separate, filterable columns (numbers where the value is a number).
  const condHeader = ['Charge ratio', 'Concentration (M)', ...(hasGel ? ['Gel'] : []), 'Substrate', 'Dwell (s)'];
  const condCells = (r: ProcessedRow): CellValue[] => [
    r.cond.chargeRatio === '—' ? 'unknown' : numberOf(r.cond.chargeRatio),
    r.cond.concentration === '—' ? 'unknown' : r.cond.concentrationDefault ? `${r.cond.concentration} (assumed)` : numberOf(r.cond.concentration),
    ...(hasGel ? [r.gel?.trim() || 'unspecified'] : []),
    r.cond.substrate === '—' ? 'unknown' : r.cond.substrate.trim(),
    numberOf(r.cond.hold),
  ];
  const condWidths = [8, 11, ...(hasGel ? [10] : []), 11, 8];
  const sheets: SheetSpec[] = [];
  const add = (key: SummarySheet, header: string[], data: CellValue[][], widths: number[]) => {
    sheets.push({ name: sheetName[key], rows: [header, ...data], headerRows: 1, colWidths: widths, wrap: true, filter: true });
  };
  const partialWork = (runs: ProcessedRow[]) => runs.some((r) => r.incomplete && Number.isFinite(r.workMJ)) ? 'Includes recorded-end work' : null;
  const isWork = (c: { label: string }) => c.label.startsWith('Measured work');

  // Every sheet lists one metric at a time, so its values for all conditions sit together.
  if (selected.includes('run')) add('run', ['Metric', ...condHeader, 'Repeat / source file', 'Run', 'Value', 'Work endpoint'],
    columns.flatMap((c) => conditions.flatMap((files) => files.flatMap((runs) => runs.map((r) => [
      c.label, ...condCells(r), r.path, r.number, numeric(c.value(r)),
      isWork(c) && Number.isFinite(r.workMJ) ? r.incomplete ? 'Recorded end' : 'Failure / detachment' : null,
    ])))), [26, ...condWidths, 28, 6, 12, 14]);

  if (selected.includes('repeat')) add('repeat', ['Metric', ...condHeader, 'Repeat / source file', 'Mean', 'SD', 'Work note'],
    columns.flatMap((c) => conditions.flatMap((files) => files.map((runs) => [
      c.label, ...condCells(runs[0]), runs[0].path, ...stats(runs.map(c.value)), isWork(c) ? partialWork(runs) : null,
    ]))), [26, ...condWidths, 28, 12, 12, 16]);

  if (selected.includes('condition')) add('condition', ['Metric', ...condHeader, 'Mean', 'SD', 'Work note'],
    columns.flatMap((c) => conditions.map((files) => [
      c.label, ...condCells(files[0][0]), ...stats(files.map((runs) => mean(runs.map(c.value)))), isWork(c) ? partialWork(files.flat()) : null,
    ])), [26, ...condWidths, 12, 12, 16]);

  if (selected.includes('gel')) sheets.push(compareSheet(columns, conditions, hasGel, partialWork));
  return sheets;
}

type Column = { label: string; value: (row: ProcessedRow) => number };

/**
 * Compare Gels: condition means (each repeat counts once) for every gel — charge ratio ·
 * concentration, plus a named gel if any — on every substrate and dwell time in the export.
 *   1. A long, filterable table (metric first).
 *   2. Per metric, a small table with one row per gel and one Mean/SD column pair per
 *      substrate (× dwell time), drawn as a clustered bar chart: within each gel the substrates
 *      side by side, across the chart all gels. Error bars are the sample SD of repeat means.
 *   3. When dwell times vary: per metric, each gel on each substrate vs dwell time (lines).
 */
function compareSheet(columns: Column[], conditions: ProcessedRow[][][], hasGel: boolean, partialWork: (runs: ProcessedRow[]) => string | null): SheetSpec {
  const gelOf = (r: ProcessedRow) => [r.cond.chargeRatio === '—' ? 'CR unknown' : `CR ${r.cond.chargeRatio}`, r.cond.concentration === '—' ? '' : `${r.cond.concentration} M${r.cond.concentrationDefault ? ' (assumed)' : ''}`, hasGel ? r.gel?.trim() || '' : ''].filter(Boolean).join(' · ');
  const subOf = (r: ProcessedRow) => (r.cond.substrate === '—' ? 'substrate unknown' : r.cond.substrate.trim());
  const dwellVaries = new Set(conditions.map((f) => f[0][0].cond.hold).filter((h) => h !== '—')).size > 1;
  const seriesOf = (r: ProcessedRow) => (dwellVaries || r.cond.hold !== '—' ? `${subOf(r)} · ${r.cond.hold === '—' ? 'dwell unknown' : `${r.cond.hold} s`}` : subOf(r));
  const stat = (c: Column, files: ProcessedRow[][]) => {
    const means = files.map((runs) => mean(runs.map(c.value)));
    return [numeric(mean(means)), numeric(sampleSD(means))] as const;
  };
  const header = ['Metric', 'Gel', 'Charge ratio', 'Concentration (M)', 'Substrate', 'Dwell (s)', 'Mean', 'SD', 'Work note'];
  const out: CellValue[][] = [header];
  const charts: ChartSpec[] = [];
  const conds = conditions.map((files) => ({ r: files[0][0], files })); // already in condition order
  const plotted = columns.filter((c) => !c.label.endsWith(' (gf)'));

  // 1. Long table; within a gel and substrate the dwell times are consecutive (for the line charts).
  const lineCharts: ChartSpec[] = [];
  for (const c of columns) {
    const series: ChartSpec['series'] = [];
    let last = '';
    for (const { r, files } of conds) {
      const row = out.length;
      const [m, sd] = stat(c, files);
      const dwell = numberOf(r.cond.hold);
      out.push([c.label, gelOf(r), numberOf(r.cond.chargeRatio), r.cond.concentration === '—' ? 'unknown' : r.cond.concentrationDefault ? `${r.cond.concentration} (assumed)` : numberOf(r.cond.concentration),
        subOf(r), dwell, m, sd, c.label.startsWith('Measured work') ? partialWork(files.flat()) : null]);
      if (!dwellVaries || dwell === null || m === null) { last = ''; continue; }
      const key = `${gelOf(r)} · ${subOf(r)}`;
      if (key !== last) {
        last = key;
        series.push({ name: key, markers: true, xRange: [cellRef(5, row), cellRef(5, row)], yRange: [cellRef(6, row), cellRef(6, row)], yErrRange: [cellRef(7, row), cellRef(7, row)], xValues: [], yValues: [], yErrValues: [] });
      }
      const sr = series[series.length - 1];
      sr.xRange[1] = cellRef(5, row); sr.yRange[1] = cellRef(6, row); sr.yErrRange![1] = cellRef(7, row);
      sr.xValues.push(dwell); sr.yValues.push(m); sr.yErrValues!.push(sd);
    }
    if (plotted.includes(c) && series.some((x) => x.xValues.length > 1)) {
      for (const x of series) if (x.xValues.length === 1) { x.markerOnly = true; x.markers = false; }
      lineCharts.push({ title: `${c.label} vs dwell time: each gel on each substrate`, xTitle: 'Dwell time (s)', yTitle: c.label, series, from: { col: 0, row: 0 }, to: { col: 0, row: 0 } });
    }
  }
  const firstTableRows = out.length;

  // 2. Per metric: gels × (substrate · dwell) means and SDs, and a clustered bar chart.
  const gels = [...new Map(conds.map(({ r }) => [gelOf(r), r])).keys()];
  const seriesNames = [...new Map([...conds].sort((a, b) => bySubstrate(subOf(a.r), subOf(b.r)) || numberCmp(a.r.cond.hold, b.r.cond.hold)).map(({ r }) => [seriesOf(r), r])).keys()];
  const barCharts: ChartSpec[] = [];
  let widest = 9;
  for (const c of plotted) {
    out.push([], [`${c.label}: mean and SD of repeat means, one row per gel`]);
    out.push(['Gel', ...seriesNames.flatMap((n) => [`${n} mean`, `${n} SD`])]);
    widest = Math.max(widest, 1 + seriesNames.length * 2);
    const first = out.length;
    for (const g of gels) {
      const cells: CellValue[] = [g];
      for (const n of seriesNames) {
        const hit = conds.find(({ r }) => gelOf(r) === g && seriesOf(r) === n);
        const [m, sd] = hit ? stat(c, hit.files) : [null, null];
        cells.push(m, sd);
      }
      out.push(cells);
    }
    const lastRow = out.length - 1;
    barCharts.push({
      type: 'bar', title: `${c.label}: each gel, substrates side by side`, xTitle: 'Gel', yTitle: c.label,
      series: seriesNames.map((n, k) => ({
        name: n, xRange: [cellRef(0, first), cellRef(0, lastRow)], categories: gels,
        yRange: [cellRef(1 + 2 * k, first), cellRef(1 + 2 * k, lastRow)], yValues: out.slice(first, lastRow + 1).map((row) => (row[1 + 2 * k] as number | null) ?? null),
        yErrRange: [cellRef(2 + 2 * k, first), cellRef(2 + 2 * k, lastRow)], yErrValues: out.slice(first, lastRow + 1).map((row) => (row[2 + 2 * k] as number | null) ?? null),
        xValues: [],
      })),
      from: { col: 0, row: 0 }, to: { col: 0, row: 0 },
    });
  }
  // Charts in a column to the right of the tables: bar charts first, then the dwell-time charts.
  const col = widest + 1;
  [...barCharts, ...lineCharts].forEach((chart, i) => {
    charts.push(chart);
    chart.from = { col, row: i * 22 };
    chart.to = { col: col + 10, row: i * 22 + 20 };
  });
  return { name: sheetName.gel, rows: out, headerRows: 1, filterRows: firstTableRows, colWidths: [26, 22, 8, 11, 12, 8, 12, 12, 14], wrap: true, filter: true, charts };
}

const numberCmp = (x: string, y: string) => (x === '—' || y === '—' ? (x === y ? 0 : x === '—' ? 1 : -1) : Number(x) - Number(y));

export function buildProcessedWorkbook(projectName: string, mode: ExperimentMode, rows: ProcessedRow[], selected: SummarySheet[], graph?: SheetSpec): Uint8Array {
  const sheets = processedSheets(mode, rows, selected);
  if (graph) sheets.push(graph);
  return buildXlsx(sheets, { title: projectName, creator: `Mach-1 Analyzer ${APP_VERSION}` });
}
