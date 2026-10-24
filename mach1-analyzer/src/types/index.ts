/** Shared data types. Raw measurement arrays are never mutated after parsing. */

export const APP_VERSION = '1.0.0';
/** Bump whenever a calculation, scoring rule or default changes results. */
export const ALGORITHM_VERSION = '1.0.0';
export const PROJECT_SCHEMA_VERSION = 1;
export const GF_TO_N = 0.00980665;
export const DEFAULT_CONCENTRATION_M = 2.1;

export type Severity = 'info' | 'warning' | 'error';

export interface ParseIssue {
  severity: Severity;
  message: string;
  line?: number;
}

/** One numerical table (<DATA> ... <END DATA>) with its column headers. */
export interface DataTable {
  columns: string[];
  /** Column-major numeric data; columns[i] -> values[i]. */
  values: Float64Array[];
  rowCount: number;
  malformedRows: number;
}

/** One operation block: <INFO> + <Operation> + parameters + <DATA>. */
export interface OperationBlock {
  index: number;
  type: string; // e.g. "Wait", "Move Relative"
  info: Record<string, string>;
  params: Record<string, string>;
  data: DataTable | null;
  startLine: number;
}

export interface ParsedFile {
  fileId: string;
  path: string;
  name: string;
  sha256: string;
  sizeBytes: number;
  header: Record<string, string>;
  blocks: OperationBlock[];
  issues: ParseIssue[];
  unrecognizedSections: string[];
  status: 'ok' | 'warning' | 'error';
}

export type MetaSource = 'path' | 'filename' | 'file' | 'default' | 'user' | 'unknown';

export interface MetaField<T> {
  value: T | null;
  source: MetaSource;
}

export interface ExperimentMeta {
  chargeRatio: MetaField<number>;
  concentrationM: MetaField<number>;
  gel: MetaField<string>;
  substrate: MetaField<string>;
  nominalHoldS: MetaField<number>;
  repeat: MetaField<number>;
  baseName: string;
  notes: string[];
}

/** A movement cycle: a Move block paired with the hold (Wait) that preceded it. */
export interface Cycle {
  cycleId: string;
  fileId: string;
  cycleNumber: number;
  moveBlockIndex: number;
  holdBlockIndex: number | null;
  operation: string;
  holdTimeS: number | null;
  amplitudeMm: number | null;
  velocityMmS: number | null;
  stageAxis: string | null;
  date: string | null;
  time: string | null;
  timestamp: string | null;
  time_s: Float64Array;
  z_mm: Float64Array;
  force_gf: Float64Array;
  extra: Record<string, Float64Array>;
  holdTime_s: Float64Array | null;
  holdForce_gf: Float64Array | null;
  issues: ParseIssue[];
}

export type PeakMetric = 'min' | 'max' | 'absmax' | 'baselineMin';
export type ForceUnit = 'gf' | 'N';
export type DisplacementMode = 'signed' | 'distance' | 'inverted';
export type BaselineMode = 'none' | 'holdMean' | 'moveInterval';
export type QCClass = 'green' | 'yellow' | 'orange' | 'red';
export type ExclusionRule = 'keepAll' | 'excludeRed' | 'excludeYellowUp';
export type GroupKey =
  | 'chargeRatio'
  | 'concentrationM'
  | 'gel'
  | 'substrate'
  | 'holdTimeS'
  | 'amplitudeMm'
  | 'velocityMmS';

export interface PointOutlierSettings {
  halfWindow: number;
  /** Minimum robust scale in gf. 0 = use the force resolution estimated from each cycle. */
  scaleFloorGf: number;
  zHalf: number;
  yellow: number;
  orange: number;
  red: number;
}

export interface CycleOutlierSettings {
  modZYellow: number;
  modZOrange: number;
  modZRed: number;
  minGroupSize: number;
  weakFraction: number;
  noPeakSteps: number;
  completeFraction: number;
  repeatDiffFraction: number;
  startOffsetMm: number;
  compareBy: GroupKey[];
}

export interface AnalysisSettings {
  peakMetric: PeakMetric;
  forceUnit: ForceUnit;
  displacementMode: DisplacementMode;
  baselineMode: BaselineMode;
  baselineHoldLastS: number;
  baselineInterval: [number, number];
  point: PointOutlierSettings;
  cycle: CycleOutlierSettings;
  exclusionRule: ExclusionRule;
}

export interface MetaOverride {
  chargeRatio?: number | null;
  concentrationM?: number | null;
  gel?: string | null;
  substrate?: string | null;
  nominalHoldS?: number | null;
  repeat?: number | null;
}

export interface ManualExclusion {
  reason: string;
  at: string;
}

export type AxisVar = string;

export interface GraphConfig {
  id: string;
  title: string;
  x: AxisVar;
  y: AxisVar;
  cycleIds: string[];
  hidden: string[];
  showMarkers: boolean;
}

export type ViewMode = 'raw' | 'flagged' | 'processed' | 'compare';

export interface ProjectState {
  schemaVersion: number;
  name: string;
  settings: AnalysisSettings;
  overrides: Record<string, MetaOverride>;
  excludedCycles: Record<string, ManualExclusion>;
  excludedPoints: Record<string, Record<string, ManualExclusion>>;
  graphs: GraphConfig[];
  activeGraphId: string;
  view: ViewMode;
  selection: string[];
  groupBy: GroupKey[];
}

export interface SourceFileRecord {
  fileId: string;
  path: string;
  name: string;
  sha256: string;
  sizeBytes: number;
}
