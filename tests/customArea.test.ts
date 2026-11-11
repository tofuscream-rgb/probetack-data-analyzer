import { describe, expect, it } from 'vitest';
import { areaFillXY, areaFromRelayout, areaLimits, integrateRange } from '../src/analysis/customArea';
import { migrateState } from '../src/storage/project';

describe('custom area under the curve', () => {
  it('integrates with linear interpolation at the exact boundaries', () => {
    const x = [0, 1, 2, 3, 4];
    const f = [0, 2, 4, 6, 8]; // F = 2δ
    // ∫_{0.5}^{3.25} 2δ dδ = 3.25² − 0.5² = 10.3125, exact for a straight line
    expect(integrateRange(x, f, 0.5, 3.25).workMJ).toBeCloseTo(10.3125, 12);
    expect(integrateRange(x, f, 0, 4)).toEqual({ workMJ: 16, covered: true });
    const part = integrateRange(x, f, 3, 10); // beyond the recording: only the recorded part
    expect(part.workMJ).toBeCloseTo(7, 12);
    expect(part.covered).toBe(false);
  });

  it('a backward step counts negatively, so back-and-forth cancels', () => {
    expect(integrateRange([0, 2, 1, 2, 3], [1, 1, 1, 1, 1], 0, 3).workMJ).toBeCloseTo(3, 12);
  });

  it('limits: both needed, either order; dragged lines update them; shading follows the curve', () => {
    expect(areaLimits({ fromMm: null, toMm: 2 })).toBeNull();
    expect(areaLimits({ fromMm: 3, toMm: 1 })).toEqual([1, 3]);
    expect(areaFromRelayout({ 'shapes[1].x0': 2.4, 'shapes[1].x1': 2.6 }, { fromMm: 1, toMm: 2 })).toEqual({ fromMm: 1, toMm: 2.5 });
    expect(areaFromRelayout({ 'xaxis.range[0]': 0 }, { fromMm: 1, toMm: 2 })).toBeNull();
    expect(areaFromRelayout({ 'shapes[0].x0': 0.2, 'shapes[0].x1': 0.2 }, { fromMm: 1, toMm: 2 }, (v) => v * 2)).toEqual({ fromMm: 0.4, toMm: 2 }); // strain axis → mm
    expect(areaFillXY([0, 1, 2], [0, 10, 20], 0.5, 1.5)).toEqual({ x: [0.5, 1, 1.5], y: [5, 10, 15] });
  });

  it('limits are saved in projects and default to not set', () => {
    const s = migrateState({ tackMetrics: { area: { fromMm: 0.2, toMm: 'x' } }, lapShear: { view: { area: { fromMm: 1, toMm: 3 } } } } as never);
    expect(s.tackMetrics.area).toEqual({ fromMm: 0.2, toMm: null });
    expect(s.lapShear.view.area).toEqual({ fromMm: 1, toMm: 3 });
    expect(s.peel.view.area).toEqual({ fromMm: null, toMm: null });
  });
});
