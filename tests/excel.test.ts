import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildWorkbook } from '../src/export/workbook';
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
    expect(chart).toContain('Relative Z displacement (mm)');
    expect(chart).toContain('Force Fz (gf)');
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
    for (const h of ['Raw runs (n)', 'Raw run mean (gf)', 'Raw run SD (gf)', 'Raw run median (gf)', 'Raw run CV', 'Processed runs (n)', 'Processed run mean (gf)', 'Processed run SD (gf)', 'Processed run median (gf)', 'Processed run CV', 'Raw repeats (n)', 'Processed repeat mean (gf)']) {
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
