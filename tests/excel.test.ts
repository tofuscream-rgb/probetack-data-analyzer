import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildWorkbook, buildWorkbookSheets } from '../src/export/workbook';
import { isIncluded } from '../src/analysis/engine';
import { colName, safeSheetName } from '../src/export/xlsxWriter';
import { defaultProject } from '../src/state/defaults';
import { derive, loadSynthetic } from './helpers';

describe('Excel export', () => {
  it('creates the eight required worksheets and native scatter charts linked to cells', async () => {
    const loaded = await loadSynthetic();
    const p = defaultProject();
    const d = derive(loaded, p);
    const ids = d.ordered.filter((r) => r.file.path.includes('0.25 (2.5M)')).map((r) => r.cycle.cycleId);
    p.graphs[0].cycleIds = ids.slice(0, 3);
    p.graphs[0].title = 'Repeat overlay';
    p.runOverrides[ids[1]] = { action: 'exclude', reason: 'test exclusion', at: '2026-10-23T00:00:00Z' };
    const d2 = derive(loaded, p);
    const bytes = buildWorkbook(d2, p, { cycleIds: ids, graphs: p.graphs, useProcessedForCharts: false });
    const z = unzipSync(bytes);
    const wb = strFromU8(z['xl/workbook.xml']);
    const names = [...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([
      'Experiment Summary', 'Run Summary', 'Raw Data', 'Flagged Data', 'Processed Data', 'Statistical Summary', 'Charts', 'Analysis Settings',
    ]);
    const chart = strFromU8(z['xl/charts/chart1.xml']);
    expect(chart).toContain('<c:scatterChart>');
    expect(chart.match(/<c:ser>/g)).toHaveLength(3);
    expect(chart).toMatch(/<c:xVal><c:numRef><c:f>'Charts'!\$M\$5:\$M\$\d+<\/c:f>/);
    expect(chart).toContain('Displacement from start (mm)');
    expect(chart).toContain('Adhesion force (gf)');
    expect(strFromU8(z['[Content_Types].xml'])).toContain('drawingml.chart+xml');
    const summary = strFromU8(z['xl/worksheets/sheet1.xml']);
    expect(summary).toContain('only the Mach-1 header');
    expect(summary).toContain('Runs exported');
    expect(summary).not.toContain('>Gel<');
    const settings = strFromU8(z['xl/worksheets/sheet8.xml']);
    expect(settings).toContain('test exclusion');
    expect(settings).toContain('Algorithm version');
    const runSheet = strFromU8(z['xl/worksheets/sheet2.xml']);
    expect(runSheet).toContain('Excluded (manual)');
    expect(runSheet).toContain('Run number');
    expect(runSheet).toContain('Maximum force'); // hidden on screen, kept in the export
    expect(runSheet).not.toContain('>Gel<');
    expect(runSheet).toContain('>Status<');
    expect(runSheet).toContain('Status reason');
    expect(runSheet).toContain('Excluded manually: test exclusion');
    const stats = strFromU8(z['xl/worksheets/sheet6.xml']);
    for (const h of ['Raw runs (n)', 'Raw run mean (gf, sign inverted)', 'Raw run SD (gf, sign inverted)', 'Raw run median (gf, sign inverted)', 'Raw run CV', 'Processed runs (n)', 'Processed run mean (gf, sign inverted)', 'Processed run SD (gf, sign inverted)', 'Processed run median (gf, sign inverted)', 'Processed run CV', 'Raw repeats (n)', 'Processed repeat mean (gf, sign inverted)']) {
      expect(stats).toContain(h);
    }
    expect(settings).toContain('Automatic run exclusion (QC classes)');
    expect(settings).toContain('red, orange');
    expect(settings).toContain('Manual run overrides');
    // Processed Data holds only points of runs that are included or kept manually
    const included = ids.filter((id) => isIncluded(d2.results.get(id)!));
    expect(included.length).toBeLessThan(ids.length);
    const nIncluded = included.reduce((s, id) => s + d2.results.get(id)!.processed.n, 0);
    expect(strFromU8(z['xl/worksheets/sheet5.xml']).match(/<row /g)).toHaveLength(nIncluded + 1);
    // Raw Data rows = header + every point of the exported cycles
    const nPoints = ids.reduce((s, id) => s + d2.results.get(id)!.cycle.force_gf.length, 0);
    const raw = strFromU8(z['xl/worksheets/sheet3.xml']);
    expect(raw.match(/<row /g)).toHaveLength(nPoints + 1);
  });

  it('lists deselected files in Analysis Settings', async () => {
    const loaded = await loadSynthetic();
    const p = defaultProject();
    const d = derive(loaded, p);
    const ids = d.ordered.slice(0, 3).map((r) => r.cycle.cycleId);
    const rows = buildWorkbookSheets(d, p, { cycleIds: ids, graphs: [], useProcessedForCharts: true, sheets: ['settings'], deselectedFiles: [{ path: 'A/60s-2.txt', sha256: 'abc' }] })[0].rows;
    const i = rows.findIndex((r) => String(r[0]).startsWith('Files deselected'));
    expect(rows[i + 2]).toEqual(['A/60s-2.txt', 'abc']);
  });

  it('exports only the chosen parts of the workbook', async () => {
    const loaded = await loadSynthetic();
    const p = defaultProject();
    const d = derive(loaded, p);
    const ids = d.ordered.slice(0, 5).map((r) => r.cycle.cycleId);
    const graph = { ...p.graphs[0], cycleIds: ids };
    const names = (sheets: Parameters<typeof buildWorkbook>[2]['sheets']) => {
      const z = unzipSync(buildWorkbook(d, p, { cycleIds: ids, graphs: [graph], useProcessedForCharts: true, sheets }));
      return [...strFromU8(z['xl/workbook.xml']).matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    };
    expect(names(['stats', 'runs'])).toEqual(['Run Summary', 'Statistical Summary']);
    expect(names(['charts', 'stats', 'runs'])).toEqual(['Run Summary', 'Statistical Summary', 'Charts']);
    expect(names(undefined)).toHaveLength(8);
  });

  it('exports adhesion as positive means with positive SDs, and keeps the recorded Fz in point data', async () => {
    const loaded = await loadSynthetic();
    const p = defaultProject();
    const d = derive(loaded, p);
    const ids = d.ordered.map((r) => r.cycle.cycleId);
    const sheets = buildWorkbookSheets(d, p, { cycleIds: ids, graphs: [], useProcessedForCharts: true });
    const stats = sheets.find((x) => x.name === 'Statistical Summary')!.rows;
    const hi = stats.findIndex((row) => row.includes('Raw runs (n)'));
    const head = stats[hi] as string[];
    const meanCol = head.findIndex((h) => typeof h === 'string' && h.startsWith('Raw run mean'));
    const sdCol = head.findIndex((h) => typeof h === 'string' && h.startsWith('Raw run SD'));
    expect(head[meanCol]).toContain('sign inverted');
    const body = stats.slice(hi + 1).filter((row) => typeof row[meanCol] === 'number');
    expect(body.length).toBeGreaterThan(5);
    for (const row of body) {
      expect(row[meanCol] as number).toBeGreaterThan(0);
      expect(row[sdCol] as number).toBeGreaterThanOrEqual(0);
    }
    const raw = sheets.find((x) => x.name === 'Raw Data')!.rows;
    expect(raw[0]).toContain('Fz as recorded (gf)');
    expect(raw[1][7]).toBe(d.results.get(ids[0])!.cycle.force_gf[0]);
  });

  it('builds valid column names and sheet names', () => {
    expect(colName(0)).toBe('A');
    expect(colName(25)).toBe('Z');
    expect(colName(26)).toBe('AA');
    expect(colName(701)).toBe('ZZ');
    const used = new Set<string>();
    expect(safeSheetName('Raw/Data?', used)).toBe('Raw Data');
    expect(safeSheetName('Raw Data', used)).toBe('Raw Data (2)');
  });
});
