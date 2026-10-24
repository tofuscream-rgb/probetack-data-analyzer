/** Assembles the analysis workbook (8 worksheets + native charts). */
import type { GraphConfig, ProjectState } from '../types';
import { ALGORITHM_VERSION, APP_VERSION, GF_TO_N } from '../types';
import type { CycleResult, Derived } from '../analysis/engine';
import { GROUP_LABEL } from '../analysis/engine';
import { PEAK_LABEL, DISPLACEMENT_LABEL, displacement } from '../analysis/cycleMetrics';
import { QC_ORDER, explainPoint } from '../analysis/pointOutliers';
import { axisLabel, axisValues, curveLabel } from '../plotting/axes';
import { buildXlsx, cellRef, type CellValue, type ChartSpec, type SheetSpec } from './xlsxWriter';

const MAX_ROWS = 1_000_000;

export interface ExportOptions {
  cycleIds: string[]; // cycles to include in data sheets
  graphs: GraphConfig[]; // graphs to draw as native charts
  useProcessedForCharts: boolean;
}

const num = (v: number | null | undefined): CellValue => (v === null || v === undefined || !Number.isFinite(v) ? null : v);

/** Split a long table into several sheets if it exceeds the Excel row limit. */
function longSheets(name: string, header: string[], rows: CellValue[][], widths: number[]): SheetSpec[] {
  if (rows.length <= MAX_ROWS) return [{ name, rows: [header, ...rows], headerRows: 1, colWidths: widths }];
  const out: SheetSpec[] = [];
  for (let i = 0, k = 1; i < rows.length; i += MAX_ROWS, k++) {
    out.push({ name: k === 1 ? name : `${name} (${k})`, rows: [header, ...rows.slice(i, i + MAX_ROWS)], headerRows: 1, colWidths: widths });
  }
  return out;
}

export function buildWorkbook(derived: Derived, project: ProjectState, opts: ExportOptions): Uint8Array {
  return buildXlsx(buildWorkbookSheets(derived, project, opts), { title: project.name, creator: `Mach-1 Analyzer ${APP_VERSION}` });
}

export function buildWorkbookSheets(derived: Derived, project: ProjectState, opts: ExportOptions): SheetSpec[] {
  const s = project.settings;
  const uf = s.forceUnit === 'N' ? GF_TO_N : 1;
  const u = s.forceUnit;
  const selected = opts.cycleIds.map((id) => derived.results.get(id)).filter((r): r is CycleResult => !!r);
  const exportedAt = new Date().toISOString();

  // ---- Sheet 1: Experiment Summary -------------------------------------------------
  const files = [...new Map(selected.map((r) => [r.file.fileId, r])).values()];
  const s1: CellValue[][] = [
    ['Project', project.name],
    ['Exported at', exportedAt],
    ['Application version', APP_VERSION],
    ['Algorithm version', ALGORITHM_VERSION],
    ['Peak metric', PEAK_LABEL[s.peakMetric]],
    ['Force unit', u],
    ['Cycles exported', selected.length],
    ['Files exported', files.length],
    [],
    [
      'File path', 'File name', 'Import status', 'Charge ratio', 'Charge ratio source', 'Concentration (M)', 'Concentration source',
      'Gel', 'Substrate', 'Nominal hold (s)', 'Repeat number', 'Cycles in file', 'Test date', 'First cycle time',
      'Load cell', 'Calibration factor', 'Load cell offset', 'Low-pass filter', 'Filter order', 'Filter cutoff (Hz)',
      `Median peak (${u})`, 'SHA-256', 'Notes and warnings',
    ],
  ];
  for (const r of files) {
    const cyc = selected.filter((x) => x.file.fileId === r.file.fileId);
    const peaks = cyc.filter((x) => !x.cycleExcluded).map((x) => x.peakProcessed).filter(Number.isFinite).sort((a, b) => a - b);
    const med = peaks.length ? (peaks.length % 2 ? peaks[peaks.length >> 1] : (peaks[peaks.length / 2 - 1] + peaks[peaks.length / 2]) / 2) : NaN;
    const h = r.file.header;
    const m = r.meta;
    s1.push([
      r.file.path, r.file.name, r.file.status, num(m.chargeRatio.value), m.chargeRatio.source, num(m.concentrationM.value), m.concentrationM.source,
      m.gel.value, m.substrate.value, num(m.nominalHoldS.value), num(m.repeat.value), cyc.length, h['Date'] ?? '', cyc[0]?.cycle.time ?? '',
      h['Load Cell Name'] ?? '', num(Number(h['Load Cell Calibration Factor'])), num(Number(h['Load Cell Offset'])),
      h['Load Cell Low-pass filter'] ?? '', h['Load Cell Low-pass filter Order'] ?? '', h['Load Cell Low-pass filter Cutoff frequency (Hz)'] ?? '',
      num(med * uf), r.file.sha256, [...m.notes, ...r.file.issues.map((i) => `${i.severity}: ${i.message}`)].join(' | '),
    ]);
  }

  const noCycles = derived.files.filter((f) => !derived.ordered.some((r) => r.file.fileId === f.fileId));
  if (noCycles.length) {
    s1.push([], ['Imported files without usable movement cycles (not included in any calculation)']);
    for (const f of noCycles) s1.push([f.path, f.name, f.status, ...Array(20).fill(null), f.issues.map((i) => `${i.severity}: ${i.message}`).join(' | ')]);
  }

  // ---- Sheet 2: Cycle Summary ------------------------------------------------------
  const s2: CellValue[][] = [[
    'Cycle ID', 'Charge ratio', 'Concentration (M)', 'Gel', 'Substrate', 'Holding time (s)', 'File name', 'File path', 'Repeat number',
    'Cycle number', 'Operation', 'Amplitude (mm)', 'Velocity (mm/s)', 'Test date', 'Test time', `Peak (${PEAK_LABEL[s.peakMetric]}) (${u})`,
    `Minimum force (${u})`, `Maximum force (${u})`, `Peak force magnitude (${u})`, `Mean force (${u})`, `SD (${u})`, 'Points',
    'Time at min (s)', 'Time at max (s)', 'Z at min (mm)', 'Z at max (mm)', 'Displacement at min (mm)', 'Displacement at max (mm)',
    `Baseline (${u})`, `Baseline-corrected min (${u})`, `Processed peak (${u})`, 'Processed points', 'Points excluded by rule',
    'Points excluded manually', 'Cycle anomaly score', 'Max point score', 'Modified Z', 'QC classification', 'QC reasons',
    'Exclusion status', 'Exclusion reason',
  ]];
  for (const r of selected) {
    const m = r.meta;
    s2.push([
      r.cycle.cycleId, num(m.chargeRatio.value), num(m.concentrationM.value), m.gel.value, m.substrate.value, num(r.holdTimeS), r.file.name,
      r.file.path, num(m.repeat.value), r.cycle.cycleNumber, r.cycle.operation, num(r.cycle.amplitudeMm), num(r.cycle.velocityMmS),
      r.cycle.date, r.cycle.time, num(r.peakRaw * uf), num(r.raw.min * uf), num(r.raw.max * uf),
      num(r.raw.absPeak * uf), num(r.raw.mean * uf), num(r.raw.sd * uf), r.raw.n, num(r.raw.tAtMin), num(r.raw.tAtMax), num(r.raw.zAtMin),
      num(r.raw.zAtMax), num(r.raw.dispAtMin), num(r.raw.dispAtMax), num(r.baseline === null ? null : r.baseline * uf),
      num(r.raw.baselineMin === null ? null : r.raw.baselineMin * uf), num(r.peakProcessed * uf), r.processed.n, r.excludedByRule,
      r.excludedManual, num(r.cycleScore), num(r.points.maxScore), num(r.modZ), r.qc,
      r.flags.filter((f) => f.cls !== 'green').map((f) => f.message).join(' | '),
      r.cycleExcluded ? 'Excluded (manual)' : 'Included', r.cycleExcluded?.reason ?? '',
    ]);
  }

  // ---- Sheets 3–5: point-level data --------------------------------------------------
  const extraCols = [...new Set(selected.flatMap((r) => Object.keys(r.cycle.extra)))];
  const rawHeader = ['Cycle ID', 'File name', 'Cycle number', 'Point index', 'Time (s)', 'Position z (mm)', 'Displacement (mm)', 'Fz (gf)', 'Fz (N)', ...extraCols];
  const rawRows: CellValue[][] = [];
  const flagRows: CellValue[][] = [];
  const procRows: CellValue[][] = [];
  for (const r of selected) {
    const c = r.cycle;
    const disp = displacement(c.z_mm, s.displacementMode);
    const manual = project.excludedPoints[c.cycleId] ?? {};
    for (let i = 0; i < c.force_gf.length; i++) {
      const common: CellValue[] = [c.cycleId, r.file.name, c.cycleNumber, i, num(c.time_s[i]), num(c.z_mm[i]), num(disp[i]), num(c.force_gf[i]), num(c.force_gf[i] * GF_TO_N)];
      const extras = extraCols.map((k) => num(c.extra[k]?.[i]));
      rawRows.push([...common, ...extras]);
      const cls = QC_ORDER[r.points.cls[i]];
      const exclusion = !r.include[i] ? (manual[String(i)] ? `manual: ${manual[String(i)].reason}` : `rule: ${s.exclusionRule}`) : '';
      flagRows.push([
        ...common, num(r.points.localMedian[i]), num(r.points.z[i]), num(r.points.score[i]), cls,
        cls === 'green' ? '' : explainPoint(r.points, i, c.force_gf, s.point), exclusion,
      ]);
      if (r.include[i] && !r.cycleExcluded) {
        procRows.push([...common, num(r.baseline === null ? null : (c.force_gf[i] - r.baseline) * uf)]);
      }
    }
  }

  // ---- Sheet 6: Statistical Summary --------------------------------------------------
  const s6: CellValue[][] = [
    ['Grouped statistics of the selected peak metric. Manually excluded cycles are omitted. Concentration is always part of the grouping key.'],
    ['Cycle-level statistics treat every movement cycle as one value; cycles from the same specimen are NOT independent replicates.'],
    ['Run-level statistics first average the cycles of each file (repeat run), then summarize across runs.'],
    [],
    [...project.groupBy.map((k) => GROUP_LABEL[k]), ...(project.groupBy.includes('concentrationM') ? [] : [GROUP_LABEL.concentrationM]),
      'Cycles (n)', `Cycle mean (${u})`, `Cycle median (${u})`, `Cycle SD (${u})`, 'Cycle CV', 'Runs (files)', `Run mean (${u})`, `Run SD (${u})`, 'Run CV', 'Warning'],
  ];
  const keys = project.groupBy.includes('concentrationM') ? project.groupBy : [...project.groupBy, 'concentrationM' as const];
  const selectedSet = new Set(opts.cycleIds);
  for (const g of derived.groups) {
    if (!g.cycleIds.some((id) => selectedSet.has(id))) continue;
    s6.push([
      ...keys.map((k) => g.label[k]), g.nCycles, num(g.mean * uf), num(g.median * uf), num(g.sd * uf), num(g.cv), g.nRuns,
      num(g.runMean * uf), num(g.runSD * uf), num(g.runCV), g.nRuns < 2 ? 'Only one run: no between-run variation available' : '',
    ]);
  }

  // ---- Sheet 7: Charts (native scatter charts + their data) --------------------------
  const chartRows: CellValue[][] = [];
  const charts: ChartSpec[] = [];
  const DATA_COL0 = 12; // charts occupy columns A–L; data starts at column M
  let dataCol = DATA_COL0;
  let chartTop = 0;
  chartRows[0] = [];
  chartRows[0][0] = 'Native Excel scatter charts. Each series is linked to the X/Y columns on the right, so the charts can be edited in Excel.';
  for (const g of opts.graphs) {
    const visible = g.cycleIds.filter((id) => !g.hidden.includes(id)).map((id) => derived.results.get(id)).filter((r): r is CycleResult => !!r);
    if (visible.length === 0) continue;
    const series: ChartSpec['series'] = [];
    for (const r of visible) {
      const xs = axisValues(r, g.x, s);
      const ys = axisValues(r, g.y, s);
      if (!xs || !ys) continue;
      const xCol = dataCol;
      const yCol = dataCol + 1;
      const label = curveLabel(r);
      const set = (row: number, col: number, v: CellValue) => {
        chartRows[row] = chartRows[row] ?? [];
        chartRows[row][col] = v;
      };
      set(1, xCol, `${g.title}`);
      set(2, xCol, label);
      set(3, xCol, axisLabel(g.x, s));
      set(3, yCol, axisLabel(g.y, s));
      const xv: (number | null)[] = [];
      const yv: (number | null)[] = [];
      for (let i = 0; i < xs.length; i++) {
        const keep = !opts.useProcessedForCharts || r.include[i] === 1;
        const xval = Number.isFinite(xs[i]) ? xs[i] : null;
        const yval = keep && Number.isFinite(ys[i]) ? ys[i] : null; // gaps stay gaps
        xv.push(xval);
        yv.push(yval);
        set(4 + i, xCol, xval);
        set(4 + i, yCol, yval);
      }
      series.push({
        name: label,
        nameCell: cellRef(xCol, 2),
        xRange: [cellRef(xCol, 4), cellRef(xCol, 3 + xs.length)],
        yRange: [cellRef(yCol, 4), cellRef(yCol, 3 + xs.length)],
        xValues: xv,
        yValues: yv,
      });
      dataCol += 3; // one blank column between curves
    }
    if (series.length === 0) continue;
    charts.push({
      title: g.title + (opts.useProcessedForCharts ? ' (processed)' : ' (raw)'),
      xTitle: axisLabel(g.x, s),
      yTitle: axisLabel(g.y, s),
      series,
      from: { col: 0, row: chartTop + 2 },
      to: { col: 11, row: chartTop + 24 },
    });
    chartTop += 24;
  }

  // ---- Sheet 8: Analysis Settings ----------------------------------------------------
  const p = s.point;
  const cy = s.cycle;
  const s8: CellValue[][] = [
    ['Setting', 'Value', 'Explanation'],
    ['Application version', APP_VERSION, ''],
    ['Algorithm version', ALGORITHM_VERSION, 'Recorded so results can be reproduced.'],
    ['Exported at', exportedAt, ''],
    ['Peak metric', PEAK_LABEL[s.peakMetric], ''],
    ['Force unit', u, `1 gf = ${GF_TO_N} N (unit conversion only; unrelated to the load-cell calibration factor).`],
    ['Displacement definition', DISPLACEMENT_LABEL[s.displacementMode], 'z₀ = first recorded z of each movement.'],
    ['Baseline mode', s.baselineMode, s.baselineMode === 'holdMean' ? `Mean of the last ${s.baselineHoldLastS} s of the preceding hold.` : s.baselineMode === 'moveInterval' ? `Mean of movement interval ${s.baselineInterval[0]}–${s.baselineInterval[1]} s.` : 'No baseline correction.'],
    ['Smoothing / extra filtering', 'None', 'No additional low-pass filter is applied. The instrument filter settings are listed per file on Experiment Summary.'],
    ['Point screening method', 'Hampel-type rolling median / MAD', 'z = |F − rolling median| / max(1.4826·MAD, floor); score = z² / (z² + zHalf²). Severity index, not a probability.'],
    ['Rolling half-window (points)', p.halfWindow, ''],
    ['Scale floor (gf)', p.scaleFloorGf === 0 ? 'auto (force resolution of each cycle)' : p.scaleFloorGf, ''],
    ['zHalf', p.zHalf, 'Robust z at which the score is 0.5.'],
    ['Yellow / orange / red score thresholds', `${p.yellow} / ${p.orange} / ${p.red}`, ''],
    ['Cycle comparison grouping', cy.compareBy.map((k) => GROUP_LABEL[k]).join(', '), 'Cycles are compared only with cycles sharing these values.'],
    ['Modified Z thresholds (yellow / orange / red)', `${cy.modZYellow} / ${cy.modZOrange} / ${cy.modZRed}`, 'Modified Z = 0.6745 (x − median) / MAD.'],
    ['Minimum group size for modified Z', cy.minGroupSize, ''],
    ['Weak-response fraction', cy.weakFraction, ''],
    ['Missing-peak threshold (resolution steps)', cy.noPeakSteps, ''],
    ['Incomplete-travel fraction', cy.completeFraction, ''],
    ['Repeat-difference fraction', cy.repeatDiffFraction, ''],
    ['Start-position difference (mm)', cy.startOffsetMm, 'Start of each movement compared with the previous movement in the same file (travel direction only).'],
    ['Point exclusion rule (processed data)', s.exclusionRule, 'keepAll = no automatic exclusion; excludeRed = red points; excludeYellowUp = yellow, orange and red points.'],
    [],
    ['Manually excluded cycles'],
    ['Cycle ID', 'Reason', 'Decided at'],
    ...Object.entries(project.excludedCycles).map(([id, e]) => [id, e.reason, e.at]),
    [],
    ['Manually excluded points'],
    ['Cycle ID', 'Point index', 'Reason', 'Decided at'],
    ...Object.entries(project.excludedPoints).flatMap(([id, pts]) => Object.entries(pts).map(([i, e]) => [id, Number(i), e.reason, e.at])),
    [],
    ['User corrections to metadata'],
    ['File ID', 'Field', 'Value'],
    ...Object.entries(project.overrides).flatMap(([id, ov]) => Object.entries(ov).map(([k, v]) => [id, k, v as CellValue])),
    [],
    ['Source files'],
    ['File ID', 'Path', 'SHA-256', 'Size (bytes)'],
    ...files.map((r) => [r.file.fileId, r.file.path, r.file.sha256, r.file.sizeBytes]),
  ];

  const sheets: SheetSpec[] = [
    { name: 'Experiment Summary', rows: s1, colWidths: [34, 14, 12, 12, 12, 14, 14, 12, 12, 12, 10, 10, 18, 14] },
    { name: 'Cycle Summary', rows: s2, headerRows: 1, colWidths: [26, 10, 12, 10, 10, 10, 12, 28] },
    ...longSheets('Raw Data', rawHeader, rawRows, [26, 12, 8, 8, 10, 14, 14, 12, 12]),
    ...longSheets('Flagged Data', [...rawHeader.slice(0, 9), 'Rolling median (gf)', 'Robust z', 'Anomaly score', 'Classification', 'Why flagged', 'Excluded from processed'], flagRows, [26, 12, 8, 8, 10, 14, 14, 12, 12, 14, 10, 12, 14, 60, 24]),
    ...longSheets('Processed Data', [...rawHeader.slice(0, 9), `Baseline-corrected Fz (${u})`], procRows, [26, 12, 8, 8, 10, 14, 14, 12, 12, 16]),
    { name: 'Statistical Summary', rows: s6, colWidths: [14, 14, 12, 12, 12, 10, 14, 14, 12, 10, 10, 14, 12, 10, 30] },
    { name: 'Charts', rows: chartRows, charts },
    { name: 'Analysis Settings', rows: s8, colWidths: [42, 40, 80] },
  ];
  return sheets;
}

/** Workbook with only one graph: its plotted data and an editable native chart. */
export function buildGraphWorkbook(derived: Derived, project: ProjectState, graph: GraphConfig, processed: boolean): Uint8Array {
  const full = buildWorkbookSheets(derived, project, { cycleIds: [], graphs: [graph], useProcessedForCharts: processed });
  return buildXlsx(full.filter((sh) => sh.name === 'Charts' || sh.name === 'Analysis Settings'), {
    title: graph.title,
    creator: `Mach-1 Analyzer ${APP_VERSION}`,
  });
}
