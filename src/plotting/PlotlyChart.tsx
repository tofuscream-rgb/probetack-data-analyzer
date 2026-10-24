import { useEffect, useRef, useState } from 'react';
import type { Config, Data, Layout, PlotlyHTMLElement, PlotSelectionEvent } from 'plotly.js';

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
  onSelected?: (e: PlotSelectionEvent) => void;
  onClick?: (e: { points: { curveNumber: number; pointIndex: number; customdata?: unknown; data: { meta?: unknown } }[] }) => void;
  onReady?: (el: PlotlyHTMLElement) => void;
  className?: string;
}

export function PlotlyChart({ data, layout, config, onSelected, onClick, onReady, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const handlers = useRef({ onSelected, onClick });
  handlers.current = { onSelected, onClick };

  useEffect(() => {
    let cancelled = false;
    loadPlotly()
      .then(async (Plotly) => {
        if (cancelled || !ref.current) return;
        const el = (await Plotly.react(ref.current, data, { autosize: true, ...layout }, {
          displaylogo: false,
          responsive: true,
          scrollZoom: true,
          modeBarButtonsToRemove: ['sendDataToCloud', 'lasso2d'],
          ...config,
        })) as PlotlyHTMLElement;
        const anyEl = el as PlotlyHTMLElement & { _m1Bound?: boolean };
        if (!anyEl._m1Bound) {
          anyEl._m1Bound = true;
          el.on('plotly_selected', (e) => e && handlers.current.onSelected?.(e));
          el.on('plotly_click', (e) => handlers.current.onClick?.(e as never));
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
