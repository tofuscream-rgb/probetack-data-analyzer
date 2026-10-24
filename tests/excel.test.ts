import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildWorkbook } from '../src/export/workbook';
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
    p.excludedCycles[ids[1]] = { reason: 'test exclusion', at: '2026-10-23T00:00:00Z' };
    const d2 = derive(loaded, p);
    const bytes = buildWorkbook(d2, p, { cycleIds: ids, graphs: p.graphs, useProcessedForCharts: false });
    const z = unzipSync(bytes);
    const wb = strFromU8(z['xl/workbook.xml']);
    const names = [...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([
      'Experiment Summary', 'Cycle Summary', 'Raw Data', 'Flagged Data', 'Processed Data', 'Statistical Summary', 'Charts', 'Analysis Settings',
    ]);
    const chart = strFromU8(z['xl/charts/chart1.xml']);
    expect(chart).toContain('<c:scatterChart>');
    expect(chart.match(/<c:ser>/g)).toHaveLength(3);
    expect(chart).toMatch(/<c:xVal><c:numRef><c:f>'Charts'!\$M\$5:\$M\$\d+<\/c:f>/);
    expect(chart).toContain('Relative Z displacement (mm)');
    expect(chart).toContain('Force Fz (gf)');
    expect(strFromU8(z['[Content_Types].xml'])).toContain('drawingml.chart+xml');
    expect(strFromU8(z['xl/worksheets/sheet1.xml'])).toContain('only the Mach-1 header');
    const settings = strFromU8(z['xl/worksheets/sheet8.xml']);
    expect(settings).toContain('test exclusion');
    expect(settings).toContain('Algorithm version');
    const cycleSheet = strFromU8(z['xl/worksheets/sheet2.xml']);
    expect(cycleSheet).toContain('Excluded (manual)');
    // Raw Data rows = header + every point of the exported cycles
    const nPoints = ids.reduce((s, id) => s + d2.results.get(id)!.cycle.force_gf.length, 0);
    const raw = strFromU8(z['xl/worksheets/sheet3.xml']);
    expect(raw.match(/<row /g)).toHaveLength(nPoints + 1);
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
