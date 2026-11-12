import type { Data, Layout } from 'plotly.js';
import { APP_VERSION } from '../types';
import { buildXlsx, cellRef, type CellValue, type ChartSpec, type SheetSpec } from './xlsxWriter';

export interface PlotExport {
  data: Data[];
  layout: Partial<Layout>;
}

function plain(text: string | undefined, fallback: string): string {
  return text?.replace(/<[^>]+>/g, '').trim() || fallback;
}

export function plotSheet(fallbackTitle: string, { data, layout }: PlotExport): SheetSpec | null {
  const xTitle = plain(layout.xaxis?.title?.text, 'X');
  const yTitle = plain(layout.yaxis?.title?.text, 'Y');
  const title = plain(layout.title?.text, fallbackTitle);
  const chartRows = 23;
  const rows: CellValue[][] = Array.from({ length: chartRows }, () => []);
  rows.push(['Curve', xTitle, yTitle]);
  const series: ChartSpec['series'] = [];
  for (const item of data) {
    const trace = item as Partial<import('plotly.js').PlotData>;
    if (trace.type !== 'scatter' || trace.visible === false || trace.visible === 'legendonly' || !trace.x || !trace.y) continue;
    if (trace.fill && trace.fill !== 'none') continue; // Excel uses the plotted lines and points, without shaded areas.
    const x = Array.from(trace.x as ArrayLike<unknown>, (v) => typeof v === 'number' && Number.isFinite(v) ? v : null);
    const y = Array.from(trace.y as ArrayLike<unknown>, (v) => typeof v === 'number' && Number.isFinite(v) ? v : null);
    if (!x.length || x.length !== y.length || !x.some((v, i) => v !== null && y[i] !== null)) continue;
    const markerOnly = trace.mode === 'markers';
    const label = plain(trace.name, markerOnly ? 'Marker' : 'Curve ' + (series.length + 1));
    const start = rows.length;
    for (let i = 0; i < x.length; i++) rows.push([i === 0 ? label : null, x[i], y[i]]);
    const end = rows.length - 1;
    const color = markerOnly ? trace.marker?.color : trace.line?.color;
    const dash = trace.line?.dash;
    series.push({
      name: label, nameCell: cellRef(0, start),
      xRange: [cellRef(1, start), cellRef(1, end)], yRange: [cellRef(2, start), cellRef(2, end)],
      xValues: x, yValues: y, markerOnly,
      color: typeof color === 'string' ? color.replace(/^#/, '') : undefined,
      dash: dash === 'dash' || dash === 'dot' ? dash : undefined,
    });
  }
  if (!series.length) return null;
  return {
    name: 'Current graph', rows, wrap: true, colWidths: [35, 27, 27],
    charts: [{ title, xTitle, yTitle, series, showLegend: layout.showlegend !== false && series.length <= 15, from: { col: 0, row: 0 }, to: { col: 3, row: chartRows - 1 } }],
  };
}

export function buildPlotWorkbook(title: string, data: Data[], layout: Partial<Layout>): Uint8Array {
  const sheet = plotSheet(title, { data, layout });
  return buildXlsx(sheet ? [sheet] : [{ name: 'Current graph', rows: [['No plottable data']] }], { title, creator: `Mach-1 Analyzer ${APP_VERSION}` });
}
