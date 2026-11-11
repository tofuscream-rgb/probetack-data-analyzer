import type { Data, Shape } from 'plotly.js';
import { areaFillXY, areaLimits, type CustomArea } from '../analysis/customArea';
import { meanSd } from '../analysis/tackMetrics';
import { NumberField } from './lapShear/NumberField';
import { fmt } from './common';

/** The two draggable boundary lines (shape 0 = δ1, shape 1 = δ2), in plot x units. */
export function areaShapes(area: CustomArea, toX: (mm: number) => number = (v) => v): Partial<Shape>[] {
  if (area.fromMm === null || area.toMm === null) return [];
  return [area.fromMm, area.toMm].map((mm) => ({
    type: 'line', xref: 'x', yref: 'paper', x0: toX(mm), x1: toX(mm), y0: 0, y1: 1,
    line: { color: '#18263A', width: 2, dash: 'dash' },
  }) as Partial<Shape>);
}

/** Shaded area under one displayed curve between the boundaries. */
export function areaFillTrace(x: ArrayLike<number>, y: ArrayLike<number>, area: CustomArea, rgba: string, group: string, toX: (mm: number) => number = (v) => v): Data | null {
  const lim = areaLimits(area);
  if (!lim) return null;
  const f = areaFillXY(x, y, toX(lim[0]), toX(lim[1]));
  if (f.x.length < 2) return null;
  return { type: 'scatter', mode: 'lines', x: f.x, y: f.y, fill: 'tozeroy', fillcolor: rgba, line: { width: 0 }, hoverinfo: 'skip', showlegend: false, legendgroup: group } as unknown as Data;
}

/** Plotly config that lets only the boundary lines be dragged (other edits as given). */
export const AREA_EDITS = { shapePosition: true };

export interface AreaRow {
  id: string;
  label: string;
  workMJ: number;
  /** W / A in J/m² (Probe Tack: probe area; Lap Shear: overlap area); undefined = not reported. */
  perAreaJm2?: number;
  covered: boolean;
}

/**
 * Controls and results of the custom area-under-curve tool: From/To inputs, Set/Clear, and the
 * selected work of each run (live), with mean ± SD.
 */
export function AreaTool({ area, setArea, xRangeMm, rows, perAreaLabel, note }: {
  area: CustomArea;
  setArea: (a: CustomArea) => void;
  /** Displacement range of the shown curves (mm), for default limits. */
  xRangeMm: [number, number] | null;
  rows: AreaRow[];
  /** Header of the W/A column; omit to show raw work only. */
  perAreaLabel?: string;
  note?: string;
}) {
  const lim = areaLimits(area);
  const setDefault = () => {
    if (!xRangeMm) return;
    const [a, b] = xRangeMm;
    setArea({ fromMm: +(a + 0.25 * (b - a)).toFixed(3), toMm: +(a + 0.75 * (b - a)).toFixed(3) });
  };
  const w = meanSd(rows.map((r) => r.workMJ));
  const wa = meanSd(rows.map((r) => r.perAreaJm2 ?? null));
  const ms = (s: { mean: number; sd: number; n: number }, d: number) => (s.n ? `${fmt(s.mean, d)} ± ${s.n > 1 ? fmt(s.sd, d) : '—'}` : '—');
  return (
    <div className="area-tool">
      <div className="table-actions">
        <strong>Custom area under the curve</strong>
        <NumberField label="From δ₁ (mm)" value={area.fromMm} allowEmpty placeholder="—" onCommit={(v) => setArea({ ...area, fromMm: v })} />
        <NumberField label="To δ₂ (mm)" value={area.toMm} allowEmpty placeholder="—" onCommit={(v) => setArea({ ...area, toMm: v })} />
        {!lim && <button className="small" disabled={!xRangeMm} onClick={setDefault}>Set boundaries</button>}
        <button className="small" disabled={area.fromMm === null && area.toMm === null} onClick={() => setArea({ fromMm: null, toMm: null })}>Clear</button>
        <span className="note">{lim ? 'Drag the dashed lines on the graph, or type the limits.' : 'Set two boundaries to integrate F dδ between them.'}</span>
      </div>
      {lim && (
        <div className="table-scroll">
          <table className="grid area-table">
            <thead>
              <tr><th>Run</th><th className="num">W<sub>selected</sub> (mJ)</th>{perAreaLabel && <th className="num">{perAreaLabel}</th>}<th>Note</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.label}</td>
                  <td className="num">{fmt(r.workMJ, 4)}</td>
                  {perAreaLabel && <td className="num">{fmt(r.perAreaJm2, 3)}</td>}
                  <td className="note">{r.covered ? '' : 'Recording does not reach both limits: only the recorded part is integrated.'}</td>
                </tr>
              ))}
              {rows.length > 1 && (
                <tr className="mean-row"><td>Mean ± SD (n = {w.n})</td><td className="num">{ms(w, 4)}</td>{perAreaLabel && <td className="num">{ms(wa, 3)}</td>}<td /></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        W<sub>selected</sub> = ∫<sub>δ₁</sub><sup>δ₂</sup> F dδ (trapezoidal rule, force interpolated linearly at δ₁ and δ₂; N·mm = mJ). An additional tool: the automatic results above are not changed.{note ? ` ${note}` : ''}
      </p>
    </div>
  );
}
