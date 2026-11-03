/**
 * Publication-style figure layout shared by every graph (on screen and in PNG/SVG
 * downloads): large bold axis titles and tick labels, a thick black frame, outward
 * ticks, no grid, and thicker curves, so figures stay readable in slides and papers.
 */
import type { Layout } from 'plotly.js';

export const FIG_FONT_FAMILY = 'Arial, Helvetica, "IBM Plex Sans", sans-serif';

/** Curve widths: normal, highlighted, faded. */
export const LINE = { normal: 2.6, bold: 3.8, faded: 1.6, raw: 1.4 };

/** Axis with a bold title (`text`) and bold tick labels. */
export function figAxis(text: string, extra: Record<string, unknown> = {}): Partial<Layout['xaxis']> {
  return {
    title: { text: `<b>${text}</b>`, font: { size: 20, color: '#000' }, standoff: 12 },
    tickfont: { size: 17, color: '#000', weight: 'bold' } as never,
    showline: true,
    linecolor: '#000',
    linewidth: 2,
    mirror: true,
    ticks: 'outside',
    ticklen: 7,
    tickwidth: 2,
    tickcolor: '#000',
    showgrid: false,
    zeroline: true,
    zerolinecolor: '#B8C2CE',
    zerolinewidth: 1,
    automargin: true,
    ...extra,
  } as Partial<Layout['xaxis']>;
}

/** Base layout: font, white background, margins with room for the larger labels. */
export function figLayout(extra: Partial<Layout> = {}): Partial<Layout> {
  return {
    font: { family: FIG_FONT_FAMILY, size: 15, color: '#000' },
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    margin: { l: 90, r: 16, t: 20, b: 78 },
    legend: { font: { size: 15, color: '#000' }, bgcolor: 'rgba(255,255,255,0.9)' },
    hoverlabel: { font: { size: 14 } },
    ...extra,
  };
}

/** Peak-value label next to a marker. */
export const peakLabelFont = (color: string) => ({ size: 15, color, weight: 'bold' }) as never;

/**
 * Size of downloaded images. A compact canvas keeps text large relative to the plot
 * (like a journal figure); PNGs are rendered at 4× for print resolution.
 */
export const EXPORT_SIZE = { width: 1000, height: 680 };
