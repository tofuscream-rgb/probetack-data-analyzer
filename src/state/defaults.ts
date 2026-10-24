import type { AnalysisSettings, GraphConfig, ProjectState } from '../types';
import { PROJECT_SCHEMA_VERSION } from '../types';

export function defaultSettings(): AnalysisSettings {
  return {
    peakMetric: 'min', // current glass datasets: adhesion appears as a negative peak
    forceUnit: 'gf',
    displacementMode: 'signed',
    baselineMode: 'none', // never assumed automatically
    baselineHoldLastS: 0.5,
    baselineInterval: [0, 0.1],
    point: { halfWindow: 5, scaleFloorGf: 0, zHalf: 5, yellow: 0.3, orange: 0.6, red: 0.8 },
    cycle: {
      modZYellow: 2.5,
      modZOrange: 3.5,
      modZRed: 5,
      minGroupSize: 4,
      weakFraction: 0.25,
      noPeakSteps: 3,
      completeFraction: 0.95,
      repeatDiffFraction: 0.3,
      startOffsetMm: 1.0,
      compareBy: ['chargeRatio', 'concentrationM', 'substrate', 'holdTimeS'],
    },
    exclusionRule: 'keepAll',
  };
}

export function newGraph(n: number, cycleIds: string[] = []): GraphConfig {
  return {
    id: `g${Date.now().toString(36)}${n}`,
    title: `Graph ${n}`,
    x: 'disp_mm',
    y: 'force',
    cycleIds,
    hidden: [],
    showMarkers: true,
  };
}

export function defaultProject(): ProjectState {
  const g = newGraph(1);
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: 'Hydrogel_Analysis_Project',
    settings: defaultSettings(),
    overrides: {},
    excludedCycles: {},
    excludedPoints: {},
    graphs: [g],
    activeGraphId: g.id,
    view: 'raw',
    selection: [],
    groupBy: ['chargeRatio', 'concentrationM', 'substrate', 'holdTimeS'],
  };
}
