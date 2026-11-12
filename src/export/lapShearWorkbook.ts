/**
 * Lap-shear Excel workbook: summary with every run's results, mean ± SD and
 * dimensions; one sheet per run with the original and derived columns; a native
 * editable chart; and the analysis settings.
 */
import { ALGORITHM_VERSION, APP_VERSION, GF_TO_N, type LapShearSettings } from '../types';
import { FAILURE_MODE_LABEL, INTEGRATION_LABEL, SUMMARY_PROPERTIES, describe, type LapShearResult } from '../analysis/lapShear';
import { sourceText } from '../analysis/references';
import { lttbIndices } from '../plotting/downsample';
import { areaLimits, integrateRange, type CustomArea } from '../analysis/customArea';
import { buildXlsx, cellRef, safeSheetName, type CellValue, type ChartSpec, type SheetSpec } from './xlsxWriter';

/** What the workbook needs about one run (decoupled from the React state). */
export interface LapShearExportRun {
  id: string;
  label: string;
  filePath: string;
  fileId?: string;
  condition: string;
  time_s: ArrayLike<number>;
  z_mm: ArrayLike<number>;
  force_gf: ArrayLike<number>;
  failureMode: keyof typeof FAILURE_MODE_LABEL;
  observation?: string;
  result: LapShearResult;
}

export interface LapShearExportOptions {
  projectName: string;
  settings: LapShearSettings;
  runs: LapShearExportRun[];
  includeRunData: boolean;
  includeChart: boolean;
  deselectedFiles?: { path: string; sha256: string }[];
  /** Custom area-under-curve limits (additional tool); null limits = not set. */
  customArea?: CustomArea;
}

const num = (v: number | null | undefined): CellValue => (v === null || v === undefined || !Number.isFinite(v) ? null : v);
const CHART_POINTS = 2000;

export function buildLapShearSheets(o: LapShearExportOptions): SheetSpec[] {
  const s = o.settings;
  const runs = o.runs.filter((r) => r.result.ok);
  const used = new Set<string>();
  const name = (n: string) => {
    const v = safeSheetName(n, used);
    used.add(v.toLowerCase());
    return v;
  };

  // ---- Summary ----------------------------------------------------------------------------
  const summaryName = name('Lap Shear Summary');
  const header = [
    'Run', 'File path', 'Condition (from folder names)', 'Overlap length (mm)', 'Overlap width (mm)', 'Gel thickness (mm)', 'Bonded overlap area (mm²)',
    'Peak force (gf)', 'Peak force (N)', 'Apparent nominal lap-shear strength (kPa)', 'Apparent nominal lap-shear strength (MPa)',
    'Displacement at peak (mm)', 'Time at peak (s)', 'Full-curve work (mJ)', 'Work to peak (mJ)', 'Post-peak work (mJ)',
    `Selected integration work (mJ)`, 'Selected interval from (mm)', 'Selected interval to (mm)', 'Selected work per bonded area (J/m²)',
    'Full-curve work per bonded area (J/m²)', 'Failure mode', 'Failure displacement (mm)', 'Failure point source', 'Work to failure (mJ)',
    'Signed work incl. reversals (mJ)', 'Valid data points', 'Loading force sign in file', 'Baseline offset subtracted (gf)', 'Notes', 'Observation',
  ];
  const s1: CellValue[][] = [
    ['Lap-shear analysis', o.projectName],
    ['Exported at', new Date().toISOString()],
    ['Application / algorithm version', `${APP_VERSION} / ${ALGORITHM_VERSION}`],
    ['Selected integration', `${INTEGRATION_LABEL[s.integration.mode]}${s.integration.mode === 'custom' ? ` ${s.integration.fromMm}–${s.integration.toMm} mm` : ''}`],
    ['Baseline correction', s.baseline.enabled ? 'ON' : 'off'],
    [],
    header,
  ];
  for (const r of o.runs) {
    const x = r.result;
    if (!x.ok) {
      s1.push([r.label, r.filePath, r.condition, ...Array(header.length - 5).fill(null), x.error, r.observation ?? '']);
      continue;
    }
    s1.push([
      r.label, r.filePath, r.condition, x.dims.lengthMm, x.dims.widthMm, x.dims.thicknessMm, num(x.areaMm2),
      num(x.peak?.forceGf), num(x.peak?.forceN), num(x.strengthKPa), num(x.strengthMPa), num(x.peak?.dispMm), num(x.peak?.timeS),
      num(x.work.fullMJ), num(x.work.toPeakMJ), num(x.work.postPeakMJ), num(x.work.selectedMJ), num(x.work.selectedFromMm), num(x.work.selectedToMm),
      num(x.work.selectedPerAreaJm2), num(x.work.fullPerAreaJm2), FAILURE_MODE_LABEL[r.failureMode], num(x.failure.dispMm),
      x.failure.dispMm === null ? 'not identified' : x.failure.source, num(x.work.toFailureMJ), num(x.work.signedMJ), x.nValid,
      x.loadingSign === -1 ? 'negative (shown as positive magnitude)' : 'positive', num(x.baseline.applied ? x.baseline.offsetGf : null),
      [x.directionNote, x.baseline.requested ? x.baseline.note : '', x.failure.note, ...x.warnings].filter(Boolean).join(' | '), r.observation ?? '',
    ]);
  }
  s1.push([], ['Statistics of all exported runs (each run computed with its own bonded area, then averaged)'], ['Property', 'Unit', 'Mean', 'Sample SD', 'n']);
  for (const p of SUMMARY_PROPERTIES) {
    const d = describe(runs.map((r) => p.get(r.result)));
    s1.push([p.label, p.unit, num(d.mean), num(d.sd), d.n]);
  }
  s1.push(['Failure modes', '', (Object.keys(FAILURE_MODE_LABEL) as (keyof typeof FAILURE_MODE_LABEL)[]).map((k) => `${FAILURE_MODE_LABEL[k]}: ${runs.filter((r) => r.failureMode === k).length}`).join(', ')]);
  const byFile = new Map<string, LapShearExportRun[]>();
  for (const run of runs) {
    const key = run.fileId ?? run.filePath;
    const file = byFile.get(key) ?? [];
    file.push(run);
    byFile.set(key, file);
  }
  const repeats = [...byFile.values()];
  for (const file of repeats) {
    s1.push([], [`Statistics per Repeat/file: ${file[0].filePath}`], ['Property', 'Unit', 'Mean', 'Sample SD', 'n']);
    for (const p of SUMMARY_PROPERTIES) {
      const d = describe(file.map((r) => p.get(r.result)));
      s1.push([p.label, p.unit, num(d.mean), num(d.sd), d.n]);
    }
  }
  for (const condition of new Set(runs.map((r) => r.condition))) {
    const files = repeats.filter((file) => file[0].condition === condition);
    s1.push([], [`Statistics over Repeat/file means: ${condition}`], ['Property', 'Unit', 'Mean', 'Sample SD', 'n (files)']);
    for (const p of SUMMARY_PROPERTIES) {
      const d = describe(files.map((file) => describe(file.map((r) => p.get(r.result))).mean));
      s1.push([p.label, p.unit, num(d.mean), num(d.sd), d.n]);
    }
  }
  const sheets: SheetSpec[] = [{ name: summaryName, rows: s1, headerRows: 0, colWidths: [26, 34, 22, ...Array(26).fill(14), 80, 45] }];

  // ---- Chart ------------------------------------------------------------------------------
  if (o.includeChart && runs.length) {
    const chartName = name('Lap Shear Chart');
    const rows: CellValue[][] = [['Native Excel scatter chart of loading force vs displacement. Chart data are downsampled to at most 2000 points per run; full data are on the run sheets.']];
    const series: ChartSpec['series'] = [];
    let col = 12;
    for (const r of runs) {
      const { dispMm, loadGf } = r.result.series;
      const valid: number[] = [];
      for (let i = 0; i < dispMm.length; i++) if (Number.isFinite(dispMm[i]) && Number.isFinite(loadGf[i])) valid.push(i);
      const idx = valid.length > CHART_POINTS ? lttbIndices(Float64Array.from(valid, (i) => dispMm[i]), Float64Array.from(valid, (i) => loadGf[i]), CHART_POINTS).map((k) => valid[k]) : valid;
      const put = (row: number, c: number, v: CellValue) => {
        rows[row] = rows[row] ?? [];
        rows[row][c] = v;
      };
      put(2, col, r.label);
      put(3, col, 'Displacement (mm)');
      put(3, col + 1, 'Loading force (gf)');
      idx.forEach((i, k) => {
        put(4 + k, col, dispMm[i]);
        put(4 + k, col + 1, loadGf[i]);
      });
      series.push({
        name: r.label,
        nameCell: cellRef(col, 2),
        xRange: [cellRef(col, 4), cellRef(col, 3 + idx.length)],
        yRange: [cellRef(col + 1, 4), cellRef(col + 1, 3 + idx.length)],
        xValues: idx.map((i) => dispMm[i]),
        yValues: idx.map((i) => loadGf[i]),
      });
      col += 3;
    }
    sheets.push({
      name: chartName,
      rows,
      charts: [{ title: 'Lap shear: loading force vs displacement', xTitle: 'Displacement (mm)', yTitle: 'Loading force (gf)', series, from: { col: 0, row: 2 }, to: { col: 11, row: 26 } }],
    });
  }

  // ---- One sheet per run ---------------------------------------------------------------------
  if (o.includeRunData) {
    for (const r of runs) {
      const x = r.result;
      const lo = x.work.selectedFromMm;
      const hi = x.work.selectedToMm;
      const rows: CellValue[][] = [[
        'Time (s)', 'Position z, original (mm)', 'Relative displacement |z − z₀| (mm)', 'Fz original signed (gf)', 'Fz original signed (N)',
        x.baseline.applied ? 'Fz baseline-corrected (gf)' : 'Fz baseline-corrected (gf) [correction off]', 'Loading force (gf)', 'Loading force (N)',
        'Valid point', 'Peak (1 = peak)', 'In selected integration interval', 'Cumulative loading work (mJ)', 'Failure point (1)',
      ]];
      const n = Math.min(r.time_s.length, r.z_mm.length, r.force_gf.length);
      for (let i = 0; i < n; i++) {
        const ok = Number.isFinite(x.series.loadGf[i]);
        const d = x.series.dispMm[i];
        rows.push([
          num(r.time_s[i]), num(r.z_mm[i]), num(d), num(r.force_gf[i]), num(r.force_gf[i] * GF_TO_N),
          x.baseline.applied ? num(x.series.forceGf[i]) : null, num(x.series.loadGf[i]), num(x.series.loadGf[i] * GF_TO_N),
          ok ? 1 : 0, x.peak?.index === i ? 1 : null, ok && d >= lo && d <= hi ? 1 : 0, num(x.series.cumWorkMJ[i]), x.failure.index === i ? 1 : null,
        ]);
      }
      sheets.push({ name: name(r.label.replace(/\.txt/i, '')), rows, headerRows: 1, colWidths: [10, 14, 16, 14, 14, 18, 14, 14, 8, 8, 12, 16, 10] });
    }
  }

  // ---- Settings ----------------------------------------------------------------------------
  const set: CellValue[][] = [
    ['Setting', 'Value', 'Explanation'],
    ['Application version', APP_VERSION, ''],
    ['Algorithm version', ALGORITHM_VERSION, ''],
    ['Integration mode', INTEGRATION_LABEL[s.integration.mode], 'Sets the selected integration work and the shaded region. Full, to-peak and post-peak work are always reported.'],
    ['Custom interval (mm)', s.integration.mode === 'custom' ? `${s.integration.fromMm} – ${s.integration.toMm}` : 'not used', 'Force interpolated linearly at the exact limits.'],
    ['Work definition', 'W = ∫ F dδ, trapezoidal rule', '1 N·mm = 1 mJ. Only displacement beyond all earlier displacement is integrated, so reversals neither cancel nor double-count work; steps without displacement change add nothing.'],
    ['Measurement gaps', `time step > ${s.gapFactor} × median step, or skipped invalid rows`, 'Not integrated across.'],
    ['Baseline correction', s.baseline.enabled ? 'ON' : 'OFF', s.baseline.enabled ? `Median of the first ${s.baseline.points} valid points, applied only if their spread ≤ ${s.baseline.maxSpreadGf} gf and |median| ≤ 20% of the largest force.` : 'Raw force used.'],
    ['Failure endpoint', s.failure.auto ? `force < ${s.failure.fraction * 100}% of peak for ${s.failure.consecutive} consecutive valid points after the peak` : 'manual only', 'Left blank when not identifiable; manual values override. End of travel is never taken as separation.'],
    ['Loading direction', s.direction, 'auto: the sign with the larger force magnitude is loading; shown as positive magnitude, original signed values kept.'],
    ['Force conversion', `1 gf = ${GF_TO_N} N`, ''],
    ['Displacement', 'δ = |z − z₀| along the pull direction', 'z₀ = first valid position of each run.'],
    ['Apparent nominal lap-shear strength', 'τ = F_max / (L × W)', `kPa = N/mm² × 1000; MPa = N/mm². Gel thickness does not enter. Average stress over the original bonded area, not the maximum local stress. Source: apparent shear strength of a single-lap joint, ${sourceText(['astmD1002'])} (applied here by analogy to gel joints).`],
    ['Work per bonded area', 'W (mJ) × 1000 / A (mm²) = J/m²', 'Defined by this analyzer. Apparent mechanical work per bonded area; may include elastic, viscoelastic, cohesive, interfacial, frictional and fixture contributions. Not labelled adhesion energy or fracture toughness.'],
    ['Failure mode', 'entered by the user', 'Never inferred from the force curve.'],
    ['Default dimensions (mm)', `${s.defaults.lengthMm} × ${s.defaults.widthMm} × ${s.defaults.thicknessMm}`, 'Each run’s own dimensions are on the summary sheet.'],
    [],
    ['Files deselected by the user (not used)'],
    ...(o.deselectedFiles?.length ? o.deselectedFiles.map((f) => [f.path, f.sha256]) : [['none']]),
  ];
  sheets.push({ name: name('Analysis Settings'), rows: set, headerRows: 1, colWidths: [34, 46, 100] });
  // Custom area under the curve (additional tool), when limits are set.
  const lim = areaLimits(o.customArea);
  if (lim) {
    sheets.push({
      name: name('Custom area'),
      headerRows: 3,
      colWidths: [34, 50, 18, 26, 26],
      rows: [
        ['Custom area under the curve', `δ1 = ${lim[0]} mm`, `δ2 = ${lim[1]} mm`],
        ['W_selected = ∫ F dδ between the limits (trapezoidal rule, force interpolated at the exact limits; N·mm = mJ). Additional tool: the automatic results are not changed. W/A_overlap is an apparent work per bonded area, not fracture toughness.'],
        ['Run', 'File path', 'W_selected (mJ)', 'Apparent W_selected / A_overlap (J/m²)', 'Recording covers both limits'],
        ...runs.map((r) => { const sr = r.result.series; const w = integrateRange(sr.dispMm, Array.from(sr.loadGf, (g) => g * GF_TO_N), lim[0], lim[1]); return [r.label, r.filePath, num(w.workMJ), num((w.workMJ / r.result.areaMm2) * 1000), w.covered ? 'yes' : 'no (recorded part only)']; }),
      ],
    });
  }
  return sheets;
}

export function buildLapShearWorkbook(o: LapShearExportOptions): Uint8Array {
  return buildXlsx(buildLapShearSheets(o), { title: `${o.projectName} – lap shear`, creator: `Mach-1 Analyzer ${APP_VERSION}` });
}
