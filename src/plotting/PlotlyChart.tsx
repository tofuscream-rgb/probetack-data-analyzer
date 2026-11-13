import { useEffect, useRef, useState } from 'react';
import type { Config, Data, Layout, PlotlyHTMLElement } from 'plotly.js';

type PlotlyModule = typeof import('plotly.js');
let plotlyPromise: Promise<PlotlyModule> | null = null;
export function loadPlotly(): Promise<PlotlyModule> {
  // Plotly is bundled with the site (no CDN) and loaded on first use.
  plotlyPromise ??= import('plotly.js-dist-min').then((m) => m.default as unknown as PlotlyModule);
  return plotlyPromise;
}

interface Props {
  data: Data[];
  layout: Partial<Layout>;
  config?: Partial<Config>;
  onClick?: (e: { points: { curveNumber: number; pointIndex: number; customdata?: unknown; data: { meta?: unknown } }[] }) => void;
  onReady?: (el: PlotlyHTMLElement) => void;
  /** Layout changes made in the graph, e.g. a dragged shape. */
  onRelayout?: (e: Record<string, unknown>) => void;
  /** Click on a legend entry; return false to stop Plotly's default (hiding the curve). */
  onLegendClick?: (meta: unknown) => boolean;
  className?: string;
}

/** Box and lasso selection are not used anywhere: they are removed from every graph's mode bar. */
const NO_SELECT = ['select2d', 'lasso2d'] as const;

/** Drag mode for a graph: zoom unless the graph asks for pan; never box or lasso selection. */
export function safeDragmode(mode: Layout['dragmode'] | undefined): Layout['dragmode'] {
  return mode === 'pan' || mode === 'zoom' || mode === 'orbit' || mode === 'turntable' || mode === false ? mode : 'zoom';
}

export function PlotlyChart({ data, layout, config, onClick, onReady, onRelayout, onLegendClick, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const handlers = useRef({ onClick, onRelayout, onLegendClick });
  handlers.current = { onClick, onRelayout, onLegendClick };

  useEffect(() => {
    let cancelled = false;
    loadPlotly()
      .then(async (Plotly) => {
        if (cancelled || !ref.current) return;
        const el = (await Plotly.react(ref.current, data, { autosize: true, ...layout, dragmode: safeDragmode(layout.dragmode) }, {
          displaylogo: false,
          responsive: true,
          scrollZoom: true,
          ...config,
          // Applied after any per-graph config, so no graph can bring selection back.
          modeBarButtonsToRemove: [...new Set(['sendDataToCloud', ...NO_SELECT, ...((config?.modeBarButtonsToRemove ?? []) as string[])])] as Config['modeBarButtonsToRemove'],
        })) as PlotlyHTMLElement;
        const anyEl = el as PlotlyHTMLElement & { _m1Bound?: boolean };
        if (!anyEl._m1Bound) {
          anyEl._m1Bound = true;
          el.on('plotly_click', (e) => handlers.current.onClick?.(e as never));
          el.on('plotly_relayout', (e) => handlers.current.onRelayout?.(e as unknown as Record<string, unknown>));
          el.on('plotly_legendclick', ((e: { curveNumber: number; data: { meta?: unknown }[] }) => {
            const h = handlers.current.onLegendClick;
            return h ? h(e.data[e.curveNumber]?.meta) : true;
          }) as never);
        }
        onReady?.(el);
      })
      .catch((e) => setError(String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, layout, config]);

  useEffect(() => {
    const el = ref.current;
    return () => {
      if (el) loadPlotly().then((P) => P.purge(el));
    };
  }, []);

  if (error) return <div className="plot-error">The graph could not be drawn: {error}</div>;
  return (
    <div className={className ?? 'plot'}>
      <div ref={ref} className="plot-inner" />
    </div>
  );
}
