/** 90° peel Excel workbook: summary, editable chart, one sheet per run, analysis settings. */
import { ALGORITHM_VERSION, APP_VERSION, GF_TO_N, type FailureMode, type PeelSettings } from '../types';
import { FAILURE_MODE_LABEL, INTEGRATION_LABEL, describe } from '../analysis/lapShear';
import { PEEL_PROPERTIES, type PeelResult } from '../analysis/peel';
import { lttbIndices } from '../plotting/downsample';
import { buildXlsx, cellRef, safeSheetName, type CellValue, type ChartSpec, type SheetSpec } from './xlsxWriter';

export interface PeelExportRun {
  label: string;
  filePath: string;
  condition: string;
  time_s: ArrayLike<number>;
  z_mm: ArrayLike<number>;
  force_gf: ArrayLike<number>;
  failureMode: FailureMode;
  result: PeelResult;
}

export interface PeelExportOptions {
  projectName: string;
  settings: PeelSettings;
  runs: PeelExportRun[];
  includeRunData: boolean;
  includeChart: boolean;
  deselectedFiles?: { path: string; sha256: string }[];
}

const num = (v: number | null | undefined): CellValue => (v === null || v === undefined || !Number.isFinite(v) ? null : v);

export const PEEL_SUMMARY_HEADER = [
  'Run', 'File path', 'Condition (from folder names)', 'Gel length (mm)', 'Gel width (mm)', 'Gel thickness (mm)', 'Bonded area (mm²)', 'Peel angle (°)',
  'Average (plateau) peel force (N)', 'Average (plateau) peel force (gf)', 'Plateau force median (N)', 'Plateau force SD (N)', 'Plateau force CV (%)',
  'Plateau force min (N)', 'Plateau force max (N)', 'Steady-state window from (mm)', 'Steady-state window to (mm)', 'Points in window',
  'Peel strength F̄/w (N/m)', 'Peel strength F̄/w (N/mm)', 'Apparent interfacial toughness Γ (J/m²)',
  'Peak force (N)', 'Peak force (gf)', 'Peak force per width (N/m)', 'Displacement at peak (mm)', 'Time at peak (s)', 'Initiation peak force (N)',
  'Peeled length (mm)', 'Detachment displacement (mm)', 'Detachment source', 'Work, full curve (mJ)', 'Work to detachment (mJ)',
  'Selected integration work (mJ)', 'Work per peeled area (J/m²)', 'Peel rate (mm/s)', 'Failure mode', 'Valid data points', 'Notes',
];

export function buildPeelSheets(o: PeelExportOptions): SheetSpec[] {
  const s = o.settings;
  const runs = o.runs.filter((r) => r.result.ok);
  const used = new Set<string>();
  const name = (n: string) => {
    const v = safeSheetName(n, used);
    used.add(v.toLowerCase());
    return v;
  };
  const rows: CellValue[][] = [
    ['90° peel analysis', o.projectName],
    ['Exported at', new Date().toISOString()],
    ['Application / algorithm version', `${APP_VERSION} / ${ALGORITHM_VERSION}`],
    ['Steady-state window', s.plateau.mode === 'auto' ? `${s.plateau.startFrac * 100}–${s.plateau.endFrac * 100}% of each run's peeled length` : `${s.plateau.fromMm}–${s.plateau.toMm} mm`],
    ['Baseline correction', s.baseline.enabled ? 'ON' : 'off'],
    [],
    PEEL_SUMMARY_HEADER,
  ];
  for (const r of o.runs) {
    const x = r.result;
    if (!x.ok) {
      rows.push([r.label, r.filePath, r.condition, ...Array(PEEL_SUMMARY_HEADER.length - 4).fill(null), x.error]);
      continue;
    }
    rows.push([
      r.label, r.filePath, r.condition, x.dims.lengthMm, x.dims.widthMm, x.dims.thicknessMm, num(x.dims.lengthMm * x.dims.widthMm), x.dims.angleDeg,
      num(x.plateau.meanN), num(x.plateau.meanGf), num(x.plateau.medianN), num(x.plateau.sdN), num(x.plateau.cv * 100), num(x.plateau.minN), num(x.plateau.maxN),
      num(x.window.fromMm), num(x.window.toMm), x.window.n, num(x.peelStrengthNm), num(x.peelStrengthNmm), num(x.toughnessJm2),
      num(x.peak?.forceN), num(x.peak?.forceGf), num(x.peak?.perWidthNm), num(x.peak?.dispMm), num(x.peak?.timeS), num(x.initiationPeak?.forceN),
      num(x.peeledLengthMm), num(x.detach.dispMm), x.detach.dispMm === null ? 'not found (end of recording used)' : x.detach.source,
      num(x.work.fullMJ), num(x.work.toDetachMJ), num(x.work.selectedMJ), num(x.work.perPeeledAreaJm2), num(x.peelRateMmS),
      FAILURE_MODE_LABEL[r.failureMode], x.curve.nValid, [x.window.note, x.detach.note, x.curve.directionNote, ...x.warnings].filter(Boolean).join(' | '),
    ]);
  }
  rows.push([], ['Statistics of all exported runs'], ['Property', 'Unit', 'Mean', 'Sample SD', 'n']);
  for (const p of PEEL_PROPERTIES) {
    const d = describe(runs.map((r) => p.get(r.result)));
    rows.push([p.label, p.unit, num(d.mean), num(d.sd), d.n]);
  }
  rows.push(['Failure modes', '', (Object.keys(FAILURE_MODE_LABEL) as FailureMode[]).map((k) => `${FAILURE_MODE_LABEL[k]}: ${runs.filter((r) => r.failureMode === k).length}`).join(', ')]);
  const sheets: SheetSpec[] = [{ name: name('Peel Summary'), rows, colWidths: [26, 34, 22, ...Array(34).fill(14), 80] }];

  if (o.includeChart && runs.length) {
    const cr: CellValue[][] = [['Native Excel scatter chart of peel force vs displacement (data downsampled to at most 2000 points per run; full data on the run sheets).']];
    const series: ChartSpec['series'] = [];
    let col = 12;
    for (const r of runs) {
      const { dispMm, loadGf } = r.result.curve.series;
      const valid: number[] = [];
      for (let i = 0; i < dispMm.length; i++) if (Number.isFinite(dispMm[i]) && Number.isFinite(loadGf[i])) valid.push(i);
      const idx = valid.length > 2000 ? lttbIndices(Float64Array.from(valid, (i) => dispMm[i]), Float64Array.from(valid, (i) => loadGf[i]), 2000).map((k) => valid[k]) : valid;
      const put = (row: number, c: number, v: CellValue) => {
        cr[row] = cr[row] ?? [];
        cr[row][c] = v;
      };
      put(2, col, r.label);
      put(3, col, 'Displacement (mm)');
      put(3, col + 1, 'Peel force (gf)');
      idx.forEach((i, k) => {
        put(4 + k, col, dispMm[i]);
        put(4 + k, col + 1, loadGf[i]);
      });
      series.push({ name: r.label, nameCell: cellRef(col, 2), xRange: [cellRef(col, 4), cellRef(col, 3 + idx.length)], yRange: [cellRef(col + 1, 4), cellRef(col + 1, 3 + idx.length)], xValues: idx.map((i) => dispMm[i]), yValues: idx.map((i) => loadGf[i]) });
      col += 3;
    }
    sheets.push({ name: name('Peel Chart'), rows: cr, charts: [{ title: '90° peel: force vs displacement', xTitle: 'Peel displacement (mm)', yTitle: 'Peel force (gf)', series, from: { col: 0, row: 2 }, to: { col: 11, row: 26 } }] });
  }

  if (o.includeRunData) {
    for (const r of runs) {
      const x = r.result;
      const ser = x.curve.series;
      const data: CellValue[][] = [[
        'Time (s)', 'Position z, original (mm)', 'Peel displacement |z − z₀| (mm)', 'Fz original signed (gf)', 'Fz original signed (N)',
        x.curve.baseline.applied ? 'Fz baseline-corrected (gf)' : 'Fz baseline-corrected (gf) [correction off]', 'Peel force (gf)', 'Peel force (N)',
        'Valid point', 'Peak (1 = peak)', 'In steady-state window', 'Cumulative work (mJ)',
      ]];
      const n = Math.min(r.time_s.length, r.z_mm.length, r.force_gf.length);
      for (let i = 0; i < n; i++) {
        const ok = Number.isFinite(ser.loadGf[i]);
        const d = ser.dispMm[i];
        data.push([
          num(r.time_s[i]), num(r.z_mm[i]), num(d), num(r.force_gf[i]), num(r.force_gf[i] * GF_TO_N), x.curve.baseline.applied ? num(ser.forceGf[i]) : null,
          num(ser.loadGf[i]), num(ser.loadGf[i] * GF_TO_N), ok ? 1 : 0, x.curve.peak?.index === i ? 1 : null, ok && d >= x.window.fromMm && d <= x.window.toMm ? 1 : 0, num(ser.cumWorkMJ[i]),
        ]);
      }
      sheets.push({ name: name(r.label.replace(/\.txt/i, '')), rows: data, headerRows: 1, colWidths: [10, 14, 16, 14, 14, 18, 14, 14, 8, 8, 12, 16] });
    }
  }

  sheets.push({
    name: name('Analysis Settings'),
    headerRows: 1,
    colWidths: [34, 46, 100],
    rows: [
      ['Setting', 'Value', 'Explanation'],
      ['Application version', APP_VERSION, ''],
      ['Steady-state window', s.plateau.mode === 'auto' ? `${s.plateau.startFrac * 100}–${s.plateau.endFrac * 100}% of peeled length` : `${s.plateau.fromMm}–${s.plateau.toMm} mm`, 'Average peel force F̄ = mean loading force in this window (initiation peak and final release excluded; cf. ASTM D6862, which disregards the first 25 mm).'],
      ['Peel strength', 'F̄ / w', 'N/m and N/mm.'],
      ['Apparent interfacial toughness', 'Γ = F̄ / w · (1 − cos θ)', 'J/m²; equals F̄ / w at 90°. Elastic stretching of the strip neglected.'],
      ['Work per peeled area', 'W to detachment / (w × peeled length)', 'Energy-based estimate of Γ (J/m²).'],
      ['Detachment', s.detach.auto ? `force < ${s.detach.fraction * 100}% of peak for ${s.detach.consecutive} consecutive points after the peak` : 'manual only', 'Gives the peeled length. Manual values override.'],
      ['Work integration', INTEGRATION_LABEL[s.integration.mode], s.integration.mode === 'custom' ? `${s.integration.fromMm}–${s.integration.toMm} mm` : 'Trapezoidal rule, N·mm = mJ; displacement reversals excluded.'],
      ['Baseline correction', s.baseline.enabled ? 'ON' : 'OFF', s.baseline.enabled ? `Median of the first ${s.baseline.points} points if their spread ≤ ${s.baseline.maxSpreadGf} gf.` : 'Raw force used.'],
      ['Loading direction', s.direction, 'Shown as a positive peel force; original signed values kept.'],
      ['Force conversion', `1 gf = ${GF_TO_N} N`, ''],
      ['Peel rate', 'slope of δ vs t in the window', 'mm/s'],
      [],
      ['Files deselected by the user (not used)'],
      ...(o.deselectedFiles?.length ? o.deselectedFiles.map((f) => [f.path, f.sha256]) : [['none']]),
    ],
  });
  return sheets;
}

export function buildPeelWorkbook(o: PeelExportOptions): Uint8Array {
  return buildXlsx(buildPeelSheets(o), { title: `${o.projectName} – 90° peel`, creator: `Mach-1 Analyzer ${APP_VERSION}` });
}
